import { formatTime } from '@crossword/shared';
import { queryAll, queryOne } from '../db/database.js';
import { escapeMarkdown, formatPenalty, formatLeaderboardLines, getGuildLeaderboard } from '../leaderboard.js';

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
            channel_types: [0, 5], // GUILD_TEXT, GUILD_ANNOUNCEMENT (channels the bot can post in)
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
        // Messages embed user display names, so never let them trigger @everyone/role/user pings.
        body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
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
    const config = queryOne<{ leaderboard_channel_id: string; announce_solves: number }>(
      `SELECT leaderboard_channel_id, announce_solves FROM guild_config WHERE guild_id = ?;`,
      [guildId]
    );

    if (!config || !config.leaderboard_channel_id || config.announce_solves === 0) {
      return;
    }

    await this.sendMessage(config.leaderboard_channel_id, {
      content: `🎉 **${escapeMarkdown(playerName)}** just solved today's Daily Crossword in **${formatTime(finalTimeSeconds)}**${formatPenalty(penalties)}!`,
    });
  }

  /**
   * Posts the final closing leaderboard to all configured servers.
   */
  public async postDailyLeaderboards(puzzleId: string, dateStr: string): Promise<void> {
    const guilds = queryAll<{ guild_id: string; leaderboard_channel_id: string }>(
      `SELECT guild_id, leaderboard_channel_id FROM guild_config WHERE leaderboard_channel_id IS NOT NULL;`
    );

    for (const g of guilds) {
      const entries = getGuildLeaderboard(g.guild_id, puzzleId);
      if (entries.length === 0) {
        continue;
      }

      await this.sendMessage(g.leaderboard_channel_id, {
        embeds: [
          {
            title: `🏆 Daily Crossword Results — ${dateStr}`,
            description: formatLeaderboardLines(entries).join('\n'),
            color: 0x5865f2,
            footer: {
              text: `Total solvers: ${entries.length}`,
            },
          },
        ],
      });
    }
  }
}

export const defaultBotClient = new DiscordBotClient();
