import { formatTime, LeaderboardEntry } from '@crossword/shared';
import { queryAll, queryOne, runQuery } from '../db/database.js';

export class DiscordBotClient {
  private botToken: string;
  private clientId: string;

  constructor() {
    this.botToken = process.env.DISCORD_BOT_TOKEN || '';
    this.clientId = process.env.VITE_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || '';
  }

  public isConfigured(): boolean {
    return !!this.botToken;
  }

  /**
   * Registers slash commands with the Discord API.
   */
  public async registerCommands(): Promise<void> {
    if (!this.isConfigured() || !this.clientId) {
      console.log('[DiscordBot] Token or Client ID not provided; skipping command registration.');
      return;
    }

    const commands = [
      {
        name: 'crossword-setup',
        description: 'Set up the daily crossword leaderboard channel',
        default_member_permissions: '32', // MANAGE_GUILD
        options: [
          {
            name: 'channel',
            description: 'Channel where daily leaderboards will be posted',
            type: 7, // CHANNEL
            required: true,
          },
          {
            name: 'announcements',
            description: 'Post a spoiler-free alert when a member solves the crossword',
            type: 5, // BOOLEAN
            required: false,
          },
        ],
      },
      {
        name: 'crossword-leaderboard',
        description: 'View the current leaderboard for today’s daily crossword',
      },
      {
        name: 'crossword',
        description: 'Launch the Daily Crossword Activity',
        type: 4, // Primary Entry Point
        handler: 2, // Discord Activity launch handler
      },
    ];

    try {
      const res = await fetch(`https://discord.com/api/v10/applications/${this.clientId}/commands`, {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[DiscordBot] Failed to register commands: ${res.status} ${errorText}`);
      } else {
        console.log('[DiscordBot] Registered slash commands successfully.');
      }
    } catch (err) {
      console.error('[DiscordBot] Error during command registration:', err);
    }
  }

  /**
   * Posts a message to a Discord channel.
   */
  public async sendMessage(channelId: string, payload: { content?: string; embeds?: any[] }): Promise<boolean> {
    if (!this.isConfigured()) {
      console.log(`[DiscordBot (Mock)] Sending to channel ${channelId}:`, JSON.stringify(payload));
      return true;
    }

    try {
      const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error(`[DiscordBot] Error sending message to ${channelId}: ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[DiscordBot] Network error sending to ${channelId}:`, err);
      return false;
    }
  }

  /**
   * Posts completion announcement if server setting enables it.
   */
  public async announceSolve(guildId: string, playerName: string, finalTimeSeconds: number, penalties: number): Promise<void> {
    const config = await queryOne<{ leaderboard_channel_id: string; announce_solves: number }>(
      `SELECT leaderboard_channel_id, announce_solves FROM guild_config WHERE guild_id = ?;`,
      [guildId]
    );

    if (!config || !config.leaderboard_channel_id || config.announce_solves === 0) {
      return;
    }

    const timeStr = formatTime(finalTimeSeconds);
    const penaltyText = penalties > 0 ? ` (+${penalties}s penalties)` : '';

    await this.sendMessage(config.leaderboard_channel_id, {
      content: `🎉 **${playerName}** just solved today's Daily Crossword in **${timeStr}**${penaltyText}!`,
    });
  }

  /**
   * Posts the final closing leaderboard to all configured servers.
   */
  public async postDailyLeaderboards(puzzleId: string, dateStr: string): Promise<void> {
    const guilds = await queryAll<{ guild_id: string; leaderboard_channel_id: string }>(
      `SELECT guild_id, leaderboard_channel_id FROM guild_config WHERE leaderboard_channel_id IS NOT NULL;`
    );

    for (const g of guilds) {
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
         WHERE a.guild_id = ? AND a.puzzle_id = ? AND a.finish_time IS NOT NULL;`,
        [g.guild_id, puzzleId]
      );

      if (rows.length === 0) {
        continue;
      }

      // Compute and sort
      const entries: LeaderboardEntry[] = rows.map((r, idx) => {
        const elapsed = Math.floor(
          (new Date(r.finish_time).getTime() - new Date(r.start_time).getTime()) / 1000
        );
        const total = elapsed + r.penalty_seconds;
        return {
          rank: 0,
          userId: '',
          username: r.username,
          displayName: r.display_name,
          finishTime: r.finish_time,
          elapsedSeconds: elapsed,
          penaltySeconds: r.penalty_seconds,
          totalScoreSeconds: total,
        };
      });

      entries.sort((a, b) => {
        if (a.totalScoreSeconds !== b.totalScoreSeconds) {
          return a.totalScoreSeconds - b.totalScoreSeconds;
        }
        return new Date(a.finishTime).getTime() - new Date(b.finishTime).getTime();
      });

      const medals = ['🥇', '🥈', '🥉'];
      const lines = entries.slice(0, 10).map((e, idx) => {
        const medal = medals[idx] || `**#${idx + 1}**`;
        const penaltyInfo = e.penaltySeconds > 0 ? ` (${formatTime(e.penaltySeconds)} penalties)` : '';
        return `${medal} **${e.displayName}** — \`${formatTime(e.totalScoreSeconds)}\`${penaltyInfo}`;
      });

      const embed = {
        title: `🏆 Daily Crossword Results — ${dateStr}`,
        description: lines.join('\n'),
        color: 0x5865f2,
        footer: {
          text: `Total solvers: ${entries.length}`,
        },
      };

      await this.sendMessage(g.leaderboard_channel_id, {
        embeds: [embed],
      });
    }
  }
}

export const defaultBotClient = new DiscordBotClient();
