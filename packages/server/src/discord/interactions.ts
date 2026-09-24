import { formatTime } from '@crossword/shared';
import { Request, Response } from 'express';
import { queryAll, runQuery } from '../db/database.js';
import { verifyDiscordSignature } from './signature.js';

export async function handleDiscordInteractions(req: Request, res: Response): Promise<void> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY || '';
  const signature = req.header('X-Signature-Ed25519');
  const timestamp = req.header('X-Signature-Timestamp');

  // Verify signature if public key is configured
  if (publicKey) {
    const isValid = verifyDiscordSignature(req.body, signature, timestamp, publicKey);
    if (!isValid) {
      res.status(401).send('Invalid request signature');
      return;
    }
  }

  const interaction = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  // Type 1: PING
  if (interaction.type === 1) {
    res.json({ type: 1 });
    return;
  }

  // Type 2: APPLICATION_COMMAND or Type 4: PRIMARY_ENTRY_POINT
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

      await runQuery(
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

      const todayStr = new Date().toISOString().split('T')[0];
      const rows = await queryAll<{
        display_name: string;
        username: string;
        start_time: string;
        finish_time: string;
        penalty_seconds: number;
      }>(
        `SELECT p.display_name, p.username, a.start_time, a.finish_time, a.penalty_seconds
         FROM attempts a
         JOIN players p ON a.user_id = p.user_id
         JOIN puzzles pz ON a.puzzle_id = pz.id
         WHERE a.guild_id = ? AND pz.date = ? AND a.finish_time IS NOT NULL;`,
        [guildId, todayStr]
      );

      if (rows.length === 0) {
        res.json({
          type: 4,
          data: {
            content: `📊 No server members have solved today's (${todayStr}) crossword yet! Be the first!`,
            flags: 64,
          },
        });
        return;
      }

      const entries = rows.map((r) => {
        const elapsed = Math.floor(
          (new Date(r.finish_time).getTime() - new Date(r.start_time).getTime()) / 1000
        );
        return {
          displayName: r.display_name,
          total: elapsed + r.penalty_seconds,
          penalties: r.penalty_seconds,
          finishTime: r.finish_time,
        };
      });

      entries.sort((a, b) => {
        if (a.total !== b.total) return a.total - b.total;
        return new Date(a.finishTime).getTime() - new Date(b.finishTime).getTime();
      });

      const medals = ['🥇', '🥈', '🥉'];
      const lines = entries.slice(0, 10).map((e, idx) => {
        const medal = medals[idx] || `**#${idx + 1}**`;
        const penaltyInfo = e.penalties > 0 ? ` (+${formatTime(e.penalties)} penalties)` : '';
        return `${medal} **${e.displayName}** — \`${formatTime(e.total)}\`${penaltyInfo}`;
      });

      res.json({
        type: 4,
        data: {
          embeds: [
            {
              title: `📊 Current Crossword Standings — ${todayStr}`,
              description: lines.join('\n'),
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
      // Entry Point Activity launch
      res.json({
        type: 4,
        data: {
          content: '🎮 Launching Daily Crossword Activity...',
        },
      });
      return;
    }
  }

  // Default handler
  res.json({ type: 1 });
}
