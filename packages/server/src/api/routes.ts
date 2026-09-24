import {
  AttemptState,
  calculateElapsedSeconds,
  calculateTotalScore,
  ClientPuzzlePayload,
  compareLeaderboardEntries,
  evaluateCheckWordPenalty,
  FullPuzzleData,
  GAME_CONFIG,
  LeaderboardEntry,
} from '@crossword/shared';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, runQuery } from '../db/database.js';
import { exchangeDiscordCode } from '../discord/auth.js';
import { defaultBotClient } from '../discord/bot.js';
import { createFallbackPuzzle } from '../engine/fallbackPuzzles.js';
import { PuzzlePipeline } from '../engine/pipeline.js';
import { AuthenticatedRequest, requireAuth } from './middleware.js';
import { rateLimitCheck, rateLimitReveal, rateLimitSubmit } from './rateLimit.js';

export const apiRouter = express.Router();

// Input validation schemas
const TokenExchangeSchema = z.object({
  code: z.string().min(1),
  guildId: z.string().nullable().optional(),
});

const SaveProgressSchema = z.object({
  gridState: z.array(z.array(z.string())),
});

const CheckWordSchema = z.object({
  entryNumber: z.number().int().positive(),
  direction: z.enum(['across', 'down']),
  word: z.string().min(1),
});

const RevealLetterSchema = z.object({
  row: z.number().int().min(0).max(14),
  col: z.number().int().min(0).max(14),
});

const SubmitGridSchema = z.object({
  gridState: z.array(z.array(z.string())),
});

/**
 * POST /api/auth/token
 */
apiRouter.post('/auth/token', async (req: Request, res: Response): Promise<void> => {
  const parse = TokenExchangeSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid request body', details: parse.error.format() });
    return;
  }

  try {
    const { token, session } = await exchangeDiscordCode(parse.data.code, parse.data.guildId);
    res.json({
      token,
      user: {
        id: session.userId,
        username: session.username,
        displayName: session.displayName,
        avatar: session.avatar,
      },
      guildId: session.guildId,
    });
  } catch (err: any) {
    console.error('[API Auth] Error:', err);
    res.status(500).json({ error: err.message || 'Authentication failed' });
  }
});

/**
 * Helper to get or publish today's puzzle.
 */
export async function getOrPublishTodayPuzzle(): Promise<FullPuzzleData> {
  const todayStr = new Date().toISOString().split('T')[0];

  // Check if published puzzle exists for today
  let row = await queryOne<{
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
    status: string;
    created_at: string;
  }>(`SELECT * FROM puzzles WHERE date = ? AND status = 'published';`, [todayStr]);

  if (!row) {
    // Check if there is a buffered puzzle for today
    row = await queryOne(`SELECT * FROM puzzles WHERE date = ? AND status = 'buffered';`, [todayStr]);

    if (row) {
      await runQuery(`UPDATE puzzles SET status = 'published' WHERE id = ?;`, [row.id]);
    } else {
      // Use fallback puzzle
      console.warn(`[API Puzzle] Buffer empty for ${todayStr}. Publishing fallback puzzle.`);
      const fallback = createFallbackPuzzle(todayStr, 0);
      const pipeline = new PuzzlePipeline();
      await pipeline.savePuzzleToDatabase(fallback, 'published');
      return fallback;
    }
  }

  const expiresDate = new Date(`${row.date}T00:00:00Z`);
  expiresDate.setUTCDate(expiresDate.getUTCDate() + 1);

  const clues = JSON.parse(row.clues_json);
  const solution = JSON.parse(row.solution_json);

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
    solution,
    expiresAt: expiresDate.toISOString(),
    isClosed: new Date().getTime() >= expiresDate.getTime(),
    status: 'published',
    createdAt: row.created_at,
  };
}

/**
 * GET /api/puzzle/today
 */
apiRouter.get('/puzzle/today', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthenticatedRequest).user;
  const puzzle = await getOrPublishTodayPuzzle();

  // Find or create attempt
  let attempt = await queryOne<{
    id: string;
    puzzle_id: string;
    user_id: string;
    guild_id: string | null;
    start_time: string;
    finish_time: string | null;
    penalty_seconds: number;
    grid_state_json: string;
    wrong_answers_json: string;
    locked_cells_json: string;
  }>(`SELECT * FROM attempts WHERE puzzle_id = ? AND user_id = ?;`, [puzzle.id, user.userId]);

  if (!attempt) {
    // Start attempt now!
    const attemptId = `att-${user.userId}-${puzzle.id}-${Date.now().toString(36)}`;
    const startTime = new Date().toISOString();
    // Default empty grid
    const emptyGrid = Array.from({ length: 15 }, () => Array(15).fill(''));

    await runQuery(
      `INSERT INTO attempts (
        id, puzzle_id, user_id, guild_id, start_time,
        penalty_seconds, grid_state_json, wrong_answers_json, locked_cells_json
      ) VALUES (?, ?, ?, ?, ?, 0, ?, '{}', '[]');`,
      [
        attemptId,
        puzzle.id,
        user.userId,
        user.guildId, // Tied to the guild where player first opened it!
        startTime,
        JSON.stringify(emptyGrid),
      ]
    );

    // Audit log
    await runQuery(
      `INSERT INTO events (id, attempt_id, puzzle_id, user_id, guild_id, event_type, payload_json)
       VALUES (?, ?, ?, ?, ?, 'attempt_started', ?);`,
      [`ev-${Date.now().toString(36)}`, attemptId, puzzle.id, user.userId, user.guildId, JSON.stringify({ startTime })]
    );

    attempt = {
      id: attemptId,
      puzzle_id: puzzle.id,
      user_id: user.userId,
      guild_id: user.guildId,
      start_time: startTime,
      finish_time: null,
      penalty_seconds: 0,
      grid_state_json: JSON.stringify(emptyGrid),
      wrong_answers_json: '{}',
      locked_cells_json: '[]',
    };
  }

  // Calculate elapsed wall clock seconds
  const elapsed = calculateElapsedSeconds(attempt.start_time, attempt.finish_time);
  const totalScore = calculateTotalScore(elapsed, attempt.penalty_seconds);
  const isCompleted = !!attempt.finish_time;

  // SANITIZE: client gets NO answers unless already finished
  const clientPayload: ClientPuzzlePayload = PuzzlePipeline.sanitizeForClient(puzzle);

  const attemptState: AttemptState = {
    id: attempt.id,
    puzzleId: puzzle.id,
    userId: user.userId,
    guildId: attempt.guild_id,
    startTime: attempt.start_time,
    finishTime: attempt.finish_time,
    elapsedSeconds: elapsed,
    penaltySeconds: attempt.penalty_seconds,
    totalScoreSeconds: totalScore,
    isCompleted,
    gridState: JSON.parse(attempt.grid_state_json),
    lockedCells: JSON.parse(attempt.locked_cells_json || '[]'),
    wrongAnswersPerEntry: JSON.parse(attempt.wrong_answers_json || '{}'),
  };

  res.json({
    puzzle: clientPayload,
    attempt: attemptState,
    solution: puzzle.solution,
  });
});

/**
 * POST /api/attempt/save
 */
apiRouter.post('/attempt/save', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parse = SaveProgressSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Invalid grid state format' });
    return;
  }

  const user = (req as AuthenticatedRequest).user;
  const puzzle = await getOrPublishTodayPuzzle();

  await runQuery(
    `UPDATE attempts SET grid_state_json = ?, updated_at = datetime('now')
     WHERE puzzle_id = ? AND user_id = ? AND finish_time IS NULL;`,
    [JSON.stringify(parse.data.gridState), puzzle.id, user.userId]
  );

  res.json({ success: true });
});

/**
 * POST /api/attempt/check-word
 */
apiRouter.post(
  '/attempt/check-word',
  requireAuth,
  rateLimitCheck,
  async (req: Request, res: Response): Promise<void> => {
    const parse = CheckWordSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid check request', details: parse.error.format() });
      return;
    }

    const user = (req as AuthenticatedRequest).user;
    const puzzle = await getOrPublishTodayPuzzle();
    const { entryNumber, direction, word } = parse.data;

    const attempt = await queryOne<{
      id: string;
      penalty_seconds: number;
      wrong_answers_json: string;
      locked_cells_json: string;
      finish_time: string | null;
    }>(`SELECT * FROM attempts WHERE puzzle_id = ? AND user_id = ?;`, [puzzle.id, user.userId]);

    if (!attempt || attempt.finish_time) {
      res.status(400).json({ error: 'Attempt already closed or not found' });
      return;
    }

    // Locate clue and solution word
    const clueList = puzzle.cluesWithAnswers[direction];
    const targetClue = clueList.find((c) => c.number === entryNumber);

    if (!targetClue) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    const entryKey = `${entryNumber}-${direction}`;
    const existingWrong = JSON.parse(attempt.wrong_answers_json || '{}');
    const existingLocked: { row: number; col: number }[] = JSON.parse(
      attempt.locked_cells_json || '[]'
    );

    const result = evaluateCheckWordPenalty(
      entryKey,
      word,
      targetClue.answer,
      existingWrong
    );

    let newPenalty = attempt.penalty_seconds + result.penaltyAdded;
    let newLocked = [...existingLocked];

    if (result.isCorrect) {
      // Find all cells for this entry and add them to lockedCells
      const isAcross = direction === 'across';
      for (let i = 0; i < targetClue.length; i++) {
        const r = isAcross ? targetClue.row : targetClue.row + i;
        const c = isAcross ? targetClue.col + i : targetClue.col;
        if (!newLocked.some((cell) => cell.row === r && cell.col === c)) {
          newLocked.push({ row: r, col: c });
        }
      }
    }

    await runQuery(
      `UPDATE attempts SET
         penalty_seconds = ?,
         wrong_answers_json = ?,
         locked_cells_json = ?,
         updated_at = datetime('now')
       WHERE id = ?;`,
      [newPenalty, JSON.stringify(result.updatedWrongAnswers), JSON.stringify(newLocked), attempt.id]
    );

    // Audit event
    await runQuery(
      `INSERT INTO events (id, attempt_id, puzzle_id, user_id, guild_id, event_type, payload_json)
       VALUES (?, ?, ?, ?, ?, 'check_word', ?);`,
      [
        `ev-${Date.now().toString(36)}`,
        attempt.id,
        puzzle.id,
        user.userId,
        user.guildId,
        JSON.stringify({ entryKey, word, correct: result.isCorrect, penaltyAdded: result.penaltyAdded }),
      ]
    );

    res.json({
      correct: result.isCorrect,
      entryKey,
      lockedCells: result.isCorrect ? newLocked : undefined,
      penaltyAdded: result.penaltyAdded,
      totalPenaltySeconds: newPenalty,
      isFirstTimeWrong: result.isFirstTimeWrong,
    });
  }
);

/**
 * POST /api/attempt/reveal-letter
 */
apiRouter.post(
  '/attempt/reveal-letter',
  requireAuth,
  rateLimitReveal,
  async (req: Request, res: Response): Promise<void> => {
    const parse = RevealLetterSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid cell coordinate' });
      return;
    }

    const user = (req as AuthenticatedRequest).user;
    const puzzle = await getOrPublishTodayPuzzle();
    const { row, col } = parse.data;

    const attempt = await queryOne<{
      id: string;
      penalty_seconds: number;
      grid_state_json: string;
      locked_cells_json: string;
      finish_time: string | null;
    }>(`SELECT * FROM attempts WHERE puzzle_id = ? AND user_id = ?;`, [puzzle.id, user.userId]);

    if (!attempt || attempt.finish_time) {
      res.status(400).json({ error: 'Attempt closed or not found' });
      return;
    }

    if (puzzle.grid[row][col].isBlack) {
      res.status(400).json({ error: 'Cannot reveal black cell' });
      return;
    }

    const correctLetter = puzzle.solution[row][col];
    const penalty = GAME_CONFIG.REVEAL_LETTER_PENALTY_SECONDS;
    const newPenalty = attempt.penalty_seconds + penalty;

    const gridState: string[][] = JSON.parse(attempt.grid_state_json);
    gridState[row][col] = correctLetter;

    const lockedCells: { row: number; col: number }[] = JSON.parse(attempt.locked_cells_json || '[]');
    if (!lockedCells.some((c) => c.row === row && c.col === col)) {
      lockedCells.push({ row, col });
    }

    await runQuery(
      `UPDATE attempts SET
         penalty_seconds = ?,
         grid_state_json = ?,
         locked_cells_json = ?,
         updated_at = datetime('now')
       WHERE id = ?;`,
      [newPenalty, JSON.stringify(gridState), JSON.stringify(lockedCells), attempt.id]
    );

    // Audit log
    await runQuery(
      `INSERT INTO events (id, attempt_id, puzzle_id, user_id, guild_id, event_type, payload_json)
       VALUES (?, ?, ?, ?, ?, 'reveal_letter', ?);`,
      [
        `ev-${Date.now().toString(36)}`,
        attempt.id,
        puzzle.id,
        user.userId,
        user.guildId,
        JSON.stringify({ row, col, letter: correctLetter, penaltyAdded: penalty }),
      ]
    );

    res.json({
      row,
      col,
      letter: correctLetter,
      penaltyAdded: penalty,
      totalPenaltySeconds: newPenalty,
    });
  }
);

/**
 * POST /api/attempt/submit
 */
apiRouter.post(
  '/attempt/submit',
  requireAuth,
  rateLimitSubmit,
  async (req: Request, res: Response): Promise<void> => {
    const parse = SubmitGridSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid submit grid data' });
      return;
    }

    const user = (req as AuthenticatedRequest).user;
    const puzzle = await getOrPublishTodayPuzzle();
    const clientGrid = parse.data.gridState;

    const attempt = await queryOne<{
      id: string;
      start_time: string;
      penalty_seconds: number;
      finish_time: string | null;
      guild_id: string | null;
    }>(`SELECT * FROM attempts WHERE puzzle_id = ? AND user_id = ?;`, [puzzle.id, user.userId]);

    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found' });
      return;
    }

    if (attempt.finish_time) {
      const elapsed = calculateElapsedSeconds(attempt.start_time, attempt.finish_time);
      res.json({
        success: true,
        finishTime: attempt.finish_time,
        totalScoreSeconds: calculateTotalScore(elapsed, attempt.penalty_seconds),
        solution: puzzle.solution,
      });
      return;
    }

    // Verify all white cells match the solution
    let isFullyCorrect = true;
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        if (!puzzle.grid[r][c].isBlack) {
          const submittedChar = (clientGrid[r]?.[c] || '').toUpperCase();
          const expectedChar = puzzle.solution[r][c];
          if (submittedChar !== expectedChar) {
            isFullyCorrect = false;
            break;
          }
        }
      }
      if (!isFullyCorrect) break;
    }

    if (isFullyCorrect) {
      const finishTime = new Date().toISOString();
      const elapsed = calculateElapsedSeconds(attempt.start_time, finishTime);
      const totalScore = calculateTotalScore(elapsed, attempt.penalty_seconds);

      await runQuery(
        `UPDATE attempts SET
           finish_time = ?,
           grid_state_json = ?,
           updated_at = datetime('now')
         WHERE id = ?;`,
        [finishTime, JSON.stringify(clientGrid), attempt.id]
      );

      // Audit log
      await runQuery(
        `INSERT INTO events (id, attempt_id, puzzle_id, user_id, guild_id, event_type, payload_json)
         VALUES (?, ?, ?, ?, ?, 'puzzle_solved', ?);`,
        [
          `ev-${Date.now().toString(36)}`,
          attempt.id,
          puzzle.id,
          user.userId,
          attempt.guild_id,
          JSON.stringify({ finishTime, totalScore, penalties: attempt.penalty_seconds }),
        ]
      );

      // Trigger Discord solve announcement if configured!
      if (attempt.guild_id) {
        defaultBotClient
          .announceSolve(attempt.guild_id, user.displayName, totalScore, attempt.penalty_seconds)
          .catch((err) => console.error('[API Submit] Announce error:', err));
      }

      res.json({
        success: true,
        penaltyAdded: 0,
        totalPenaltySeconds: attempt.penalty_seconds,
        finishTime,
        totalScoreSeconds: totalScore,
        solution: puzzle.solution,
      });
      return;
    }

    // Incorrect submission: add 30s penalty
    const penalty = GAME_CONFIG.SUBMIT_INCORRECT_PENALTY_SECONDS;
    const newPenalty = attempt.penalty_seconds + penalty;

    await runQuery(
      `UPDATE attempts SET
         penalty_seconds = ?,
         grid_state_json = ?,
         updated_at = datetime('now')
       WHERE id = ?;`,
      [newPenalty, JSON.stringify(clientGrid), attempt.id]
    );

    await runQuery(
      `INSERT INTO events (id, attempt_id, puzzle_id, user_id, guild_id, event_type, payload_json)
       VALUES (?, ?, ?, ?, ?, 'submit_incorrect', ?);`,
      [
        `ev-${Date.now().toString(36)}`,
        attempt.id,
        puzzle.id,
        user.userId,
        attempt.guild_id,
        JSON.stringify({ penaltyAdded: penalty }),
      ]
    );

    res.json({
      success: false,
      penaltyAdded: penalty,
      totalPenaltySeconds: newPenalty,
      message: 'Your grid contains errors. Keep hunting!',
    });
  }
);

/**
 * GET /api/leaderboard
 */
apiRouter.get('/leaderboard', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthenticatedRequest).user;
  const guildId = (req.query.guildId as string) || user.guildId;
  const puzzle = await getOrPublishTodayPuzzle();

  if (!guildId) {
    // "A player who launches the Activity outside a server (in a DM or group DM) can play, but their attempt doesn't appear on any server leaderboard."
    res.json({
      guildId: null,
      leaderboard: [],
      message: 'Leaderboards are tracked per server. Launch from a server to appear on rankings!',
    });
    return;
  }

  const rows = await queryAll<{
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
    [guildId, puzzle.id]
  );

  const entries: LeaderboardEntry[] = rows.map((r) => {
    const elapsed = Math.floor(
      (new Date(r.finish_time).getTime() - new Date(r.start_time).getTime()) / 1000
    );
    const totalScore = elapsed + r.penalty_seconds;

    return {
      rank: 0,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      avatarUrl: r.avatar,
      finishTime: r.finish_time,
      elapsedSeconds: elapsed,
      penaltySeconds: r.penalty_seconds,
      totalScoreSeconds: totalScore,
    };
  });

  entries.sort(compareLeaderboardEntries);

  entries.forEach((e, idx) => {
    e.rank = idx + 1;
  });

  res.json({
    guildId,
    date: puzzle.date,
    leaderboard: entries,
  });
});
