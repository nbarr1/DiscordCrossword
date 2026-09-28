import { getPuzzleDate } from '@crossword/shared';
import { queryAll, runQuery } from '../db/database.js';
import { defaultBotClient } from '../discord/bot.js';
import { PuzzlePipeline } from '../engine/pipeline.js';
import { publishPuzzleForDate } from '../engine/puzzleStore.js';

export class DailyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private pipeline: PuzzlePipeline;
  private lastReleasedDate = '';
  // Release and buffer maintenance are guarded separately: generation can take minutes (or hang on
  // a slow LLM call), and it must never hold up the daily release or the leaderboard posts.
  private releasing = false;
  private maintaining = false;

  constructor(pipeline: PuzzlePipeline = new PuzzlePipeline()) {
    this.pipeline = pipeline;
  }

  public start(): void {
    console.log('[Scheduler] Daily crossword scheduler started.');

    // Run immediate startup check
    this.tick();

    // Poll every 60 seconds to detect the daily release boundary
    this.timer = setInterval(() => this.tick(), 60 * 1000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    this.runRelease().catch((err) => console.error('[Scheduler] Release failed:', err));
    this.runMaintenance().catch((err) => console.warn('[Scheduler] Buffer maintenance warning:', err));
  }

  public async runRelease(now: Date = new Date()): Promise<void> {
    if (this.releasing) return;
    this.releasing = true;
    try {
      await this.releaseDailyPuzzle(now);
    } finally {
      this.releasing = false;
    }
  }

  public async runMaintenance(now: Date = new Date()): Promise<void> {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      await this.pipeline.maintainBuffer(now);
    } finally {
      this.maintaining = false;
    }
  }

  private async releaseDailyPuzzle(now: Date): Promise<void> {
    const todayStr = getPuzzleDate(now);

    if (this.lastReleasedDate === todayStr) {
      return;
    }

    console.log(`[Scheduler] Checking daily release for ${todayStr}...`);

    // 1. Publish today's puzzle from the buffer, or a fallback
    publishPuzzleForDate(todayStr, now);

    // 2. Close earlier puzzles (normally just yesterday's, more if the server was down across a
    // release) and post their final server leaderboards
    const closed = queryAll<{ id: string; date: string }>(
      `SELECT id, date FROM puzzles WHERE date < ? AND status = 'published' ORDER BY date;`,
      [todayStr]
    );

    for (const prevPuzzle of closed) {
      console.log(`[Scheduler] Closing the ${prevPuzzle.date} puzzle and posting leaderboards...`);
      runQuery(`UPDATE puzzles SET status = 'archived' WHERE id = ?;`, [prevPuzzle.id]);
      await defaultBotClient.postDailyLeaderboards(prevPuzzle.id, prevPuzzle.date);
    }

    // Only marked done once both steps succeeded, so a failure is retried on the next tick.
    this.lastReleasedDate = todayStr;
  }
}

export const dailyScheduler = new DailyScheduler();
