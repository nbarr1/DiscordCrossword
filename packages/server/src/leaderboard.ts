import { calculateElapsedSeconds, calculateTotalScore, compareLeaderboardEntries, formatTime, LeaderboardEntry } from '@crossword/shared';
import { queryAll } from './db/database.js';

/**
 * Finished attempts for one puzzle in one server, ranked by total time (elapsed plus penalties),
 * with ties going to whoever finished first. The API and the bot both use this, so the
 * Activity and the Discord posts always agree.
 */
export function getGuildLeaderboard(guildId: string, puzzleId: string): LeaderboardEntry[] {
  const rows = queryAll<{
    user_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
    start_time: string;
    finish_time: string;
    penalty_seconds: number;
  }>(
    `SELECT p.user_id, p.username, p.display_name, p.avatar, a.start_time, a.finish_time, a.penalty_seconds
     FROM attempts a
     JOIN players p ON a.user_id = p.user_id
     WHERE a.guild_id = ? AND a.puzzle_id = ? AND a.finish_time IS NOT NULL;`,
    [guildId, puzzleId]
  );

  const entries: LeaderboardEntry[] = rows.map((r) => {
    const elapsed = calculateElapsedSeconds(r.start_time, r.finish_time);
    return {
      rank: 0,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar,
      finishTime: r.finish_time,
      elapsedSeconds: elapsed,
      penaltySeconds: r.penalty_seconds,
      totalScoreSeconds: calculateTotalScore(elapsed, r.penalty_seconds),
    };
  });

  entries.sort(compareLeaderboardEntries);
  entries.forEach((e, idx) => {
    e.rank = idx + 1;
  });
  return entries;
}

/**
 * Escapes Discord markdown so a display name like "*star*" shows as typed.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#[\]()-])/g, '\\$1');
}

export function formatPenalty(penaltySeconds: number): string {
  return penaltySeconds > 0 ? ` (+${formatTime(penaltySeconds)} penalties)` : '';
}

/**
 * Leaderboard lines for a Discord message: medals for the top three, then ranks.
 */
export function formatLeaderboardLines(entries: LeaderboardEntry[], limit = 10): string[] {
  const medals = ['🥇', '🥈', '🥉'];
  return entries.slice(0, limit).map((e, idx) => {
    const place = medals[idx] || `**#${e.rank}**`;
    return `${place} **${escapeMarkdown(e.displayName)}** — \`${formatTime(e.totalScoreSeconds)}\`${formatPenalty(e.penaltySeconds)}`;
  });
}
