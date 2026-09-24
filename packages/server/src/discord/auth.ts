import crypto from 'crypto';
import { runQuery } from '../db/database.js';

export interface UserSession {
  userId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  guildId: string | null;
  createdAt: number;
}

const activeSessions = new Map<string, UserSession>();

export function getSession(token: string): UserSession | undefined {
  const session = activeSessions.get(token);
  if (!session) return undefined;
  // Session TTL: 48 hours
  if (Date.now() - session.createdAt > 48 * 60 * 60 * 1000) {
    activeSessions.delete(token);
    return undefined;
  }
  return session;
}

export function createSession(data: Omit<UserSession, 'createdAt'>): string {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, {
    ...data,
    createdAt: Date.now(),
  });
  return token;
}

export async function exchangeDiscordCode(
  code: string,
  claimedGuildId?: string | null
): Promise<{ token: string; session: UserSession }> {
  const clientId = process.env.VITE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // The mock session trusts the client-supplied guild, so it must never be reachable in production.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Discord OAuth is not configured on the server');
    }
    console.warn('[Auth] Discord credentials missing in env. Generating development mock session.');
    const mockUser: UserSession = {
      userId: `dev-${claimedGuildId ? 'guild' : 'dm'}-user`,
      username: 'CrosswordPlayer',
      displayName: 'Daily Solver',
      avatar: null,
      guildId: claimedGuildId || null,
      createdAt: Date.now(),
    };
    await upsertPlayer(mockUser.userId, mockUser.username, mockUser.displayName, mockUser.avatar);
    const token = createSession(mockUser);
    return { token, session: mockUser };
  }

  // Real OAuth token exchange
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
  });

  const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Failed to exchange code with Discord: ${tokenRes.status} ${errText}`);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Retrieve user identity
  const userRes = await fetch('https://discord.com/api/v10/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userRes.ok) {
    throw new Error('Failed to fetch Discord user profile');
  }

  const userJson = await userRes.json();
  let verifiedGuildId: string | null = null;

  // Verify guild membership if user claims a guild
  if (claimedGuildId) {
    try {
      const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (guildsRes.ok) {
        const guilds: { id: string }[] = await guildsRes.json();
        if (guilds.some((g) => g.id === claimedGuildId)) {
          verifiedGuildId = claimedGuildId;
        } else {
          console.warn(`[Auth] User ${userJson.id} does not belong to claimed guild ${claimedGuildId}`);
        }
      }
    } catch (err) {
      console.warn('[Auth] Guild verification error:', err);
    }
  }

  const session: UserSession = {
    userId: userJson.id,
    username: userJson.username,
    displayName: userJson.global_name || userJson.username,
    avatar: userJson.avatar
      ? `https://cdn.discordapp.com/avatars/${userJson.id}/${userJson.avatar}.png`
      : null,
    guildId: verifiedGuildId,
    createdAt: Date.now(),
  };

  await upsertPlayer(session.userId, session.username, session.displayName, session.avatar);

  const token = createSession(session);
  return { token, session };
}

async function upsertPlayer(userId: string, username: string, displayName: string, avatar: string | null) {
  try {
    await runQuery(
      `INSERT INTO players (user_id, username, display_name, avatar, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         username = excluded.username,
         display_name = excluded.display_name,
         avatar = excluded.avatar,
         updated_at = datetime('now');`,
      [userId, username, displayName, avatar]
    );
  } catch (err) {
    console.error('[Auth] Failed to persist player:', err);
  }
}
