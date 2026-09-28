import { FullPuzzleData, getPuzzleDate, getPuzzleExpiry } from '@crossword/shared';
import { queryOne, runQuery, transaction } from '../db/database.js';
import { getFallbackPuzzle } from './fallbackPuzzles.js';

export type PuzzleStatus = 'buffered' | 'published' | 'archived';

export interface PuzzleRow {
  id: string;
  date: string;
  title: string;
  author: string;
  theme: string | null;
  width: number;
  height: number;
  grid_json: string;
  clues_json: string;
  solution_json: string;
  status: PuzzleStatus;
  created_at: string;
  approved_at: string | null;
}

/**
 * With REQUIRE_PUZZLE_APPROVAL=true, a buffered puzzle is published only after `cli approve`;
 * an unapproved one is replaced by a fallback puzzle on its release date.
 */
export function isApprovalRequired(): boolean {
  return /^(1|true|yes)$/i.test(process.env.REQUIRE_PUZZLE_APPROVAL || '');
}

export function rowToPuzzle(row: PuzzleRow, now: Date = new Date()): FullPuzzleData {
  const clues = JSON.parse(row.clues_json);
  const expiresAt = getPuzzleExpiry(row.date);

  return {
    id: row.id,
    date: row.date,
    title: row.title,
    author: row.author,
    theme: row.theme || undefined,
    width: row.width,
    height: row.height,
    grid: JSON.parse(row.grid_json),
    clues: {
      across: (clues.across || []).map(({ answer, ...rest }: any) => rest),
      down: (clues.down || []).map(({ answer, ...rest }: any) => rest),
    },
    cluesWithAnswers: clues,
    solution: JSON.parse(row.solution_json),
    expiresAt: expiresAt.toISOString(),
    isClosed: now.getTime() >= expiresAt.getTime(),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function getPuzzleRowById(id: string): PuzzleRow | null {
  return queryOne<PuzzleRow>(`SELECT * FROM puzzles WHERE id = ?;`, [id]);
}

export function getPuzzleRowByDate(date: string): PuzzleRow | null {
  return queryOne<PuzzleRow>(`SELECT * FROM puzzles WHERE date = ?;`, [date]);
}

/**
 * Stores a puzzle, replacing any other puzzle for the same date (dates are unique). Refuses to
 * replace a puzzle that players have attempts on, since those attempts would be orphaned.
 */
export function savePuzzle(puzzle: FullPuzzleData, status: PuzzleStatus): void {
  transaction(() => {
    const existing = getPuzzleRowByDate(puzzle.date);
    if (existing) {
      const played = queryOne(`SELECT 1 AS played FROM attempts WHERE puzzle_id = ? LIMIT 1;`, [existing.id]);
      if (played) {
        throw new Error(`Refusing to replace puzzle ${existing.id} for ${puzzle.date}: players have attempts on it`);
      }
      runQuery(`DELETE FROM puzzles WHERE id = ?;`, [existing.id]);
    }

    runQuery(
      `INSERT INTO puzzles (
        id, date, title, author, theme, width, height,
        grid_json, clues_json, solution_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        puzzle.id,
        puzzle.date,
        puzzle.title,
        puzzle.author,
        puzzle.theme || null,
        puzzle.width,
        puzzle.height,
        JSON.stringify(puzzle.grid),
        JSON.stringify(puzzle.cluesWithAnswers),
        JSON.stringify(puzzle.solution),
        status,
        puzzle.createdAt,
      ]
    );
  });
}

/**
 * Makes sure a puzzle is published for `date` and returns it: the published puzzle if there is
 * one, else the buffered puzzle (when approval isn't required or it was approved), else a fallback.
 */
export function publishPuzzleForDate(date: string, now: Date = new Date()): FullPuzzleData {
  const row = transaction((): PuzzleRow => {
    const existing = getPuzzleRowByDate(date);

    if (existing?.status === 'published') {
      return existing;
    }

    if (existing?.status === 'buffered' && (existing.approved_at || !isApprovalRequired())) {
      runQuery(`UPDATE puzzles SET status = 'published' WHERE id = ?;`, [existing.id]);
      return { ...existing, status: 'published' };
    }

    if (existing?.status === 'archived' && queryOne(`SELECT 1 AS played FROM attempts WHERE puzzle_id = ? LIMIT 1;`, [existing.id])) {
      // Players already have attempts on it, so keep serving it rather than swapping puzzles mid-day.
      console.error(`[Puzzles] Puzzle ${existing.id} for ${date} was archived while in play; publishing it again.`);
      runQuery(`UPDATE puzzles SET status = 'published' WHERE id = ?;`, [existing.id]);
      return { ...existing, status: 'published' };
    }

    if (existing?.status === 'buffered') {
      console.warn(`[Puzzles] Buffered puzzle ${existing.id} for ${date} was never approved. Publishing a fallback puzzle instead.`);
    } else {
      console.warn(`[Puzzles] No puzzle ready for ${date}. Publishing a fallback puzzle.`);
    }
    savePuzzle(getFallbackPuzzle(date), 'published');
    return getPuzzleRowByDate(date)!;
  });

  return rowToPuzzle(row, now);
}

/**
 * The puzzle that is live right now, published on demand if the scheduler hasn't done it yet.
 */
export function getOrPublishCurrentPuzzle(now: Date = new Date()): FullPuzzleData {
  return publishPuzzleForDate(getPuzzleDate(now), now);
}
