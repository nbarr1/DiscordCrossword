import { queryAll, queryOne, runQuery } from '../db/database.js';
import { defaultBotClient } from '../discord/bot.js';
import { createFallbackPuzzle } from '../engine/fallbackPuzzles.js';
import { PuzzlePipeline } from '../engine/pipeline.js';

export class DailyScheduler {
  private timer: NodeJS.Timeout | null = null;
  private pipeline: PuzzlePipeline;
  private lastCheckedDate: string = '';
  // Generation can outlast the 60s interval; overlapping ticks would generate the same dates twice.
  private running = false;

  constructor() {
    this.pipeline = new PuzzlePipeline();
  }

  public start(): void {
    console.log('[Scheduler] Daily crossword scheduler started.');

    // Run immediate startup check
    this.tick().catch(console.error);

    // Poll every 60 seconds to detect 00:00 UTC boundary
    this.timer = setInterval(() => {
      this.tick().catch(console.error);
    }, 60 * 1000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Release first so the daily rollover isn't delayed by (slow) puzzle generation.
      await this.releaseDailyPuzzle();

      try {
        await this.pipeline.maintainBuffer();
      } catch (err) {
        console.warn('[Scheduler] Buffer maintenance warning:', err);
      }
    } finally {
      this.running = false;
    }
  }

  private async releaseDailyPuzzle(): Promise<void> {
    const todayStr = new Date().toISOString().split('T')[0];

    if (this.lastCheckedDate === todayStr) {
      return;
    }

    // New UTC day detected!
    console.log(`[Scheduler] Checking daily release for ${todayStr}...`);
    this.lastCheckedDate = todayStr;

    // 1. Close yesterday's puzzle and post final server leaderboards
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const prevPuzzle = await queryOne<{ id: string; date: string }>(
      `SELECT id, date FROM puzzles WHERE date = ? AND status = 'published';`,
      [yesterdayStr]
    );

    if (prevPuzzle) {
      console.log(`[Scheduler] Closing yesterday's puzzle (${yesterdayStr}) and posting leaderboards...`);
      await runQuery(`UPDATE puzzles SET status = 'archived' WHERE id = ?;`, [prevPuzzle.id]);
      await defaultBotClient.postDailyLeaderboards(prevPuzzle.id, prevPuzzle.date);
    }

    // 2. Publish today's puzzle from buffer or fallback
    let todayPuzzle = await queryOne<{ id: string }>(
      `SELECT id FROM puzzles WHERE date = ? AND status = 'published';`,
      [todayStr]
    );

    if (!todayPuzzle) {
      const buffered = await queryOne<{ id: string }>(
        `SELECT id FROM puzzles WHERE date = ? AND status = 'buffered';`,
        [todayStr]
      );

      if (buffered) {
        await runQuery(`UPDATE puzzles SET status = 'published' WHERE id = ?;`, [buffered.id]);
        console.log(`[Scheduler] Published buffered puzzle for ${todayStr}.`);
      } else {
        console.warn(`[Scheduler] No buffered puzzle for ${todayStr}. Publishing fallback puzzle.`);
        const fallback = createFallbackPuzzle(todayStr, 0);
        await this.pipeline.savePuzzleToDatabase(fallback, 'published');
      }
    }
  }
}

export const dailyScheduler = new DailyScheduler();
