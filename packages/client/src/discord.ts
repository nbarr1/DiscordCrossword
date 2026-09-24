import { DiscordSDK } from '@discord/embedded-app-sdk';
import { AuthSessionResponse } from '@crossword/shared';

const CLIENT_ID =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DISCORD_CLIENT_ID) ||
  (typeof process !== 'undefined' && process.env?.VITE_DISCORD_CLIENT_ID) ||
  '';

const formatUrl = (url: string) =>
  typeof window !== 'undefined' || url.startsWith('http://') || url.startsWith('https://')
    ? url
    : `http://localhost:3000${url}`;

export interface ClientSession {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
  };
  guildId: string | null;
  isDiscordIframe: boolean;
}

// In-memory token storage (never stored in cookies or localStorage per Discord iframe rules)
let currentSession: ClientSession | null = null;
let authPromise: Promise<ClientSession> | null = null;

export function getClientSession(): ClientSession | null {
  return currentSession;
}

export function setClientSession(session: ClientSession | null) {
  currentSession = session;
}

export function initializeDiscordAuth(): Promise<ClientSession> {
  if (currentSession) {
    return Promise.resolve(currentSession);
  }
  if (authPromise) {
    return authPromise;
  }

  authPromise = (async () => {
    try {
      const isInsideIframe = typeof window !== 'undefined' && window.self !== window.top;

      if (isInsideIframe && CLIENT_ID) {
        try {
          console.log('[DiscordSDK] Connecting to Discord client...');
          const discordSdk = new DiscordSDK(CLIENT_ID);

          // Add a timeout for the ready() call so non-Discord preview iframes do not hang indefinitely
          await Promise.race([
            discordSdk.ready(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Discord SDK ready handshake timeout')), 3000)
            ),
          ]);

          const { code } = await discordSdk.commands.authorize({
            client_id: CLIENT_ID,
            response_type: 'code',
            state: '',
            prompt: 'none',
            scope: ['identify', 'guilds'],
          });

          // Exchange code through our server proxy
          const res = await fetch(formatUrl('/api/auth/token'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code,
              guildId: discordSdk.guildId,
            }),
          });

          if (!res.ok) {
            throw new Error(`Token exchange failed: ${res.status}`);
          }

          const data: AuthSessionResponse = await res.json();
          const session: ClientSession = {
            token: data.token,
            user: data.user,
            guildId: data.guildId,
            isDiscordIframe: true,
          };

          setClientSession(session);
          return session;
        } catch (err) {
          console.warn('[DiscordSDK] SDK handshake failed or cancelled, using fallback:', err);
        }
      }

      // Standalone dev/browser fallback mode
      console.log('[DiscordSDK] Running in browser preview / dev mode');
      const res = await fetch(formatUrl('/api/auth/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'dev-mock-code',
          guildId: null,
        }),
      });

      if (!res.ok) {
        throw new Error(`Fallback token exchange failed: ${res.status}`);
      }

      const data: AuthSessionResponse = await res.json();
      const session: ClientSession = {
        token: data.token,
        user: data.user,
        guildId: data.guildId,
        isDiscordIframe: false,
      };

      setClientSession(session);
      return session;
    } catch (err) {
      authPromise = null;
      throw err;
    }
  })();

  return authPromise;
}

/**
 * Wrapper for authenticated API requests passing Bearer token in memory.
 */
export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let session = getClientSession();
  if (!session?.token) {
    try {
      session = await initializeDiscordAuth();
    } catch (err) {
      console.warn('[apiFetch] Pending auth failed:', err);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (session?.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }

  const response = await fetch(formatUrl(endpoint), {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `Request failed: ${response.status}`;
    try {
      const errJson = await response.json();
      if (errJson.error) errorMsg = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  return response.json();
}
