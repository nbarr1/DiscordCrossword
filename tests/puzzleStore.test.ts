import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addDays, getPuzzleDate, getPuzzleExpiry } from '../packages/shared/src/index.js';
import { closeDatabase, queryOne, runQuery, setDatabasePath } from '../packages/server/src/db/database.js';
import { runMigrations } from '../packages/server/src/db/migrations.js';
import { createFallbackPuzzle, getFallbackPuzzle } from '../packages/server/src/engine/fallbackPuzzles.js';
import { PuzzlePipeline } from '../packages/server/src/engine/pipeline.js';
import { getPuzzleRowByDate, publishPuzzleForDate, savePuzzle } from '../packages/server/src/engine/puzzleStore.js';
import { escapeMarkdown, formatLeaderboardLines } from '../packages/server/src/leaderboard.js';
import { DailyScheduler } from '../packages/server/src/scheduler/cron.js';

let tmpDir = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossword-store-'));
  setDatabasePath(path.join(tmpDir, 'test.db'));
  await runMigrations();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.REQUIRE_PUZZLE_APPROVAL;
});

/** A buffered puzzle for `date` that is distinguishable from that date's fallback. */
function bufferedPuzzle(date: string) {
  const puzzle = createFallbackPuzzle(date, 3);
  puzzle.id = `generated-${date}`;
  savePuzzle(puzzle, 'buffered');
  return puzzle;
}

describe('Publishing', () => {
  it('publishes the buffered puzzle when approval is not required', () => {
    bufferedPuzzle('2030-01-01');
    expect(publishPuzzleForDate('2030-01-01').id).toBe('generated-2030-01-01');
  });

  it('replaces an unapproved puzzle with a fallback when approval is required', () => {
    process.env.REQUIRE_PUZZLE_APPROVAL = 'true';
    bufferedPuzzle('2030-01-02');
    const published = publishPuzzleForDate('2030-01-02');
    expect(published.id).toBe(getFallbackPuzzle('2030-01-02').id);
    expect(published.status).toBe('published');
  });

  it('publishes an approved puzzle when approval is required', () => {
    process.env.REQUIRE_PUZZLE_APPROVAL = 'true';
    bufferedPuzzle('2030-01-03');
    runQuery(`UPDATE puzzles SET approved_at = datetime('now') WHERE id = ?;`, ['generated-2030-01-03']);
    expect(publishPuzzleForDate('2030-01-03').id).toBe('generated-2030-01-03');
  });

  it('refuses to replace a puzzle that players have attempts on', () => {
    const puzzle = bufferedPuzzle('2030-01-04');
    runQuery(`INSERT INTO players (user_id, username, display_name) VALUES ('p1', 'p1', 'P1');`);
    runQuery(
      `INSERT INTO attempts (id, puzzle_id, user_id, start_time, grid_state_json, wrong_answers_json)
       VALUES ('a1', ?, 'p1', '2030-01-04T00:00:00Z', '[]', '{}');`,
      [puzzle.id]
    );
    expect(() => savePuzzle(getFallbackPuzzle('2030-01-04'), 'buffered')).toThrow(/attempts/);
    expect(getPuzzleRowByDate('2030-01-04')?.id).toBe(puzzle.id);
  });
});

describe('Scheduler', () => {
  it('closes every earlier published puzzle and publishes today\'s', async () => {
    const now = new Date('2030-02-10T00:30:00Z');
    savePuzzle(getFallbackPuzzle('2030-02-07'), 'published');
    savePuzzle(getFallbackPuzzle('2030-02-09'), 'published');

    await new DailyScheduler().runRelease(now);

    expect(getPuzzleRowByDate('2030-02-07')?.status).toBe('archived');
    expect(getPuzzleRowByDate('2030-02-09')?.status).toBe('archived');
    expect(getPuzzleRowByDate('2030-02-10')?.status).toBe('published');
  });

  it('releases even while buffer maintenance is stuck', async () => {
    const stuck = new PuzzlePipeline();
    stuck.maintainBuffer = () => new Promise(() => {});
    const scheduler = new DailyScheduler(stuck);

    void scheduler.runMaintenance();
    await scheduler.runRelease(new Date('2030-03-01T00:01:00Z'));
    expect(queryOne(`SELECT status FROM puzzles WHERE date = '2030-03-01';`)).toEqual({ status: 'published' });
  });
});

describe('Puzzle dates', () => {
  it('rolls over at the release time and closes at the next release', () => {
    expect(getPuzzleDate(new Date('2030-04-01T23:59:59Z'))).toBe('2030-04-01');
    expect(getPuzzleDate(new Date('2030-04-02T00:00:00Z'))).toBe('2030-04-02');
    expect(getPuzzleExpiry('2030-04-01').toISOString()).toBe('2030-04-02T00:00:00.000Z');
    expect(addDays('2030-02-28', 1)).toBe('2030-03-01');
  });
});

describe('Leaderboard formatting', () => {
  it('escapes Discord markdown in display names', () => {
    expect(escapeMarkdown('*star*_name_')).toBe('\\*star\\*\\_name\\_');
    const [line] = formatLeaderboardLines([
      { rank: 1, userId: 'u', username: 'u', displayName: '**bold**', finishTime: '', elapsedSeconds: 90, penaltySeconds: 30, totalScoreSeconds: 120 },
    ]);
    expect(line).toBe('🥇 **\\*\\*bold\\*\\*** — `02:00` (+00:30 penalties)');
  });
});
