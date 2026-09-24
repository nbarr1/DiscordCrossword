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

// One SDK instance per page: constructing another would start a second handshake.
let discordSdk: DiscordSDK | null = null;
let sdkReady: Promise<void> | null = null;

/**
 * Discord launches Activities with a `frame_id` query parameter (the SDK constructor
 * throws without it), so its presence tells us we're inside the Discord client.
 */
export function isRunningInDiscord(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('frame_id');
}

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
      if (isRunningInDiscord()) {
        if (!CLIENT_ID) {
          throw new Error('VITE_DISCORD_CLIENT_ID was not set when the client was built');
        }

        // Inside Discord there is no mock fallback: the server rejects mock logins in production,
        // and a slow handshake (common on mobile) must not be mistaken for "not in Discord".
        if (!discordSdk) {
          discordSdk = new DiscordSDK(CLIENT_ID);
          sdkReady = discordSdk.ready();
        }
        console.log('[DiscordSDK] Connecting to Discord client...');
        try {
          await sdkReady;
        } catch (err) {
          // Let "Retry Connection" start a fresh handshake.
          discordSdk = null;
          sdkReady = null;
          throw err;
        }

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
export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
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

  // Sessions live in server memory, so a server restart invalidates every token.
  // Re-authenticate once and retry instead of leaving the player stuck.
  if (response.status === 401 && session?.token && !isRetry) {
    setClientSession(null);
    authPromise = null;
    return apiFetch<T>(endpoint, options, true);
  }

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
