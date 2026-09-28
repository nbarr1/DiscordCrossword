import { getPuzzleDate } from '@crossword/shared';
import { Request, Response } from 'express';
import { runQuery } from '../db/database.js';
import { getPuzzleRowByDate } from '../engine/puzzleStore.js';
import { formatLeaderboardLines, getGuildLeaderboard } from '../leaderboard.js';
import { verifyDiscordSignature } from './signature.js';

export async function handleDiscordInteractions(req: Request, res: Response): Promise<void> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY || '';
  const signature = req.header('X-Signature-Ed25519');
  const timestamp = req.header('X-Signature-Timestamp');

  // Discord requires every interaction to be verified. Without a public key, reject
  // everything rather than trusting forged payloads (e.g. fake member permissions).
  if (!publicKey) {
    console.error('[Interactions] DISCORD_PUBLIC_KEY is not set; rejecting interaction.');
    res.status(401).send('Invalid request signature');
    return;
  }

  // express.raw() hands us a Buffer; the signature covers the exact raw bytes.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.body === 'string'
      ? Buffer.from(req.body, 'utf-8')
      : null;

  if (!rawBody || !verifyDiscordSignature(rawBody, signature, timestamp, publicKey)) {
    res.status(401).send('Invalid request signature');
    return;
  }

  const interaction = JSON.parse(rawBody.toString('utf-8'));

  // Type 1: PING
  if (interaction.type === 1) {
    res.json({ type: 1 });
    return;
  }

  // Type 2: APPLICATION_COMMAND (Entry Point commands arrive as type 2 too, with data.type 4)
  if (interaction.type === 2) {
    const { name, options } = interaction.data;
    const guildId = interaction.guild_id;

    if (name === 'crossword-setup') {
      if (!guildId) {
        res.json({
          type: 4,
          data: {
            content: 'This command can only be used within a server.',
            flags: 64, // EPHEMERAL
          },
        });
        return;
      }

      // Check permission: Manage Guild is 0x20 (32)
      const memberPerms = BigInt(interaction.member?.permissions || '0');
      const MANAGE_GUILD = BigInt(0x20);
      const ADMINISTRATOR = BigInt(0x8);

      if ((memberPerms & MANAGE_GUILD) !== MANAGE_GUILD && (memberPerms & ADMINISTRATOR) !== ADMINISTRATOR) {
        res.json({
          type: 4,
          data: {
            content: '❌ You need the **Manage Server** permission to configure crossword settings.',
            flags: 64,
          },
        });
        return;
      }

      let channelId = '';
      let announceSolves = 1;

      if (options) {
        for (const opt of options) {
          if (opt.name === 'channel') {
            channelId = opt.value;
          } else if (opt.name === 'announcements') {
            announceSolves = opt.value ? 1 : 0;
          }
        }
      }

      runQuery(
        `INSERT INTO guild_config (guild_id, leaderboard_channel_id, announce_solves, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(guild_id) DO UPDATE SET
           leaderboard_channel_id = excluded.leaderboard_channel_id,
           announce_solves = excluded.announce_solves,
           updated_at = datetime('now');`,
        [guildId, channelId, announceSolves]
      );

      res.json({
        type: 4,
        data: {
          content: `✅ Leaderboard channel successfully set to <#${channelId}>! Daily leaderboards will be posted here when puzzles close.`,
          flags: 64, // EPHEMERAL
        },
      });
      return;
    }

    if (name === 'crossword-leaderboard') {
      if (!guildId) {
        res.json({
          type: 4,
          data: {
            content: 'Leaderboards are tracked per server.',
            flags: 64,
          },
        });
        return;
      }

      const todayStr = getPuzzleDate();
      const puzzle = getPuzzleRowByDate(todayStr);
      const entries = puzzle ? getGuildLeaderboard(guildId, puzzle.id) : [];

      if (entries.length === 0) {
        res.json({
          type: 4,
          data: {
            content: `📊 No server members have solved today's (${todayStr}) crossword yet! Be the first!`,
            flags: 64,
          },
        });
        return;
      }

      res.json({
        type: 4,
        data: {
          embeds: [
            {
              title: `📊 Current Crossword Standings — ${todayStr}`,
              description: formatLeaderboardLines(entries).join('\n'),
              color: 0x5865f2,
              footer: {
                text: 'Leaderboard is spoiler-free • Standings update in real time',
              },
            },
          ],
          flags: 64, // EPHEMERAL: "shows current standings as an ephemeral reply, with no answers or partial grids"
        },
      });
      return;
    }

    if (name === 'crossword') {
      // Entry Point command. With handler DISCORD_LAUNCH_ACTIVITY (2) Discord launches the
      // Activity itself and this branch isn't reached; with APP_HANDLER (1) the app must
      // respond with LAUNCH_ACTIVITY (12).
      res.json({ type: 12 });
      return;
    }

    res.json({
      type: 4,
      data: { content: `Unknown command: /${name}`, flags: 64 },
    });
    return;
  }

  // PONG is only a valid answer to PING; anything else this app doesn't handle is rejected.
  res.status(400).json({ error: `Unsupported interaction type ${interaction.type}` });
}
