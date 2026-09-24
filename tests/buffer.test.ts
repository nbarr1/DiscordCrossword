import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryAll, runQuery, setDatabasePath } from '../packages/server/src/db/database.js';
import { runMigrations } from '../packages/server/src/db/migrations.js';
import { PuzzlePipeline } from '../packages/server/src/engine/pipeline.js';

let tmpDir = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossword-buffer-'));
  setDatabasePath(path.join(tmpDir, 'test.db'));
  await runMigrations();
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Puzzle buffer', () => {
  it('targets the upcoming dates, including across a month boundary', () => {
    expect(PuzzlePipeline.getBufferTargetDates(new Date('2026-09-29T12:00:00Z'))).toEqual([
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });

  it('leaves no gaps as buffered puzzles are published day after day', async () => {
    const pipeline = new PuzzlePipeline();
    // Skip the slow generator; the fallback path still writes a buffered row per date.
    pipeline.generatePuzzle = async () => null;

    const start = new Date('2026-01-01T00:05:00Z');
    for (let day = 0; day < 6; day++) {
      const now = new Date(start);
      now.setUTCDate(start.getUTCDate() + day);
      const todayStr = now.toISOString().split('T')[0];

      // What the scheduler does at release time, then buffer maintenance.
      await runQuery(`UPDATE puzzles SET status = 'published' WHERE date = ? AND status = 'buffered';`, [todayStr]);
      await pipeline.maintainBuffer(now);

      const buffered = await queryAll<{ date: string }>(
        `SELECT date FROM puzzles WHERE status = 'buffered' AND date > ? ORDER BY date;`,
        [todayStr]
      );
      expect(buffered.map((r) => r.date)).toEqual(PuzzlePipeline.getBufferTargetDates(now));
    }
  });
});
