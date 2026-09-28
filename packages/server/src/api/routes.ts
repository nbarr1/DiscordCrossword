import {
  ApiErrorCode,
  AttemptState,
  calculateElapsedSeconds,
  calculateTotalScore,
  ClientPuzzlePayload,
  evaluateCheckWordPenalty,
  FullPuzzleData,
  GAME_CONFIG,
} from '@crossword/shared';
import crypto from 'crypto';
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, runQuery, transaction } from '../db/database.js';
import { exchangeDiscordCode } from '../discord/auth.js';
import { defaultBotClient } from '../discord/bot.js';
import { PuzzlePipeline } from '../engine/pipeline.js';
import { getOrPublishCurrentPuzzle } from '../engine/puzzleStore.js';
import { getGuildLeaderboard } from '../leaderboard.js';
import { asyncHandler, AuthenticatedRequest, requireAuth } from './middleware.js';
import { rateLimitCheck, rateLimitReveal, rateLimitSubmit } from './rateLimit.js';

export const apiRouter = express.Router();

// Input validation schemas
const TokenExchangeSchema = z.object({
  code: z.string().min(1),
  guildId: z.string().nullable().optional(),
});

// Every attempt request names the puzzle it was made against (see AttemptRequestBase).
const PuzzleIdField = z.string().min(1);
const GridField = z.array(z.array(z.string().max(1)));

const SaveProgressSchema = z.object({
  puzzleId: PuzzleIdField,
  gridState: GridField,
});

const CheckWordSchema = z.object({
  puzzleId: PuzzleIdField,
  entryNumber: z.number().int().positive(),
  direction: z.enum(['across', 'down']),
  word: z.string().regex(/^[A-Za-z]+$/),
});

const RevealLetterSchema = z.object({
  puzzleId: PuzzleIdField,
  row: z.number().int().min(0),
  col: z.number().int().min(0),
});

const SubmitGridSchema = z.object({
  puzzleId: PuzzleIdField,
  gridState: GridField,
});

interface AttemptRow {
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
}

// Event IDs must be unique; Date.now() alone collides when two events land in the same millisecond.
function newEventId(): string {
  return `ev-${crypto.randomUUID()}`;
}

function sendError(res: Response, status: number, error: string, code?: ApiErrorCode): void {
  res.status(status).json(code ? { error, code } : { error });
}

function logEvent(attempt: AttemptRow, user: AuthenticatedRequest['user'], type: string, payload: unknown): void {
  runQuery(
    `INSERT INTO events (id, attempt_id, puzzle_id, user_id, guild_id, event_type, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [newEventId(), attempt.id, attempt.puzzle_id, user.userId, attempt.guild_id, type, JSON.stringify(payload)]
  );
}

function getAttempt(puzzleId: string, userId: string): AttemptRow | null {
  return queryOne<AttemptRow>(`SELECT * FROM attempts WHERE puzzle_id = ? AND user_id = ?;`, [puzzleId, userId]);
}

/**
 * Returns the live puzzle, or answers 409 PUZZLE_CLOSED when the request was made against a
 * different one (typically a player still on yesterday's puzzle after the daily release), so the
 * action never lands on the new day's attempt.
 */
function requireLivePuzzle(res: Response, puzzleId: string): FullPuzzleData | null {
  const puzzle = getOrPublishCurrentPuzzle();
  if (puzzle.id !== puzzleId) {
    sendError(res, 409, "This puzzle has closed. Load today's puzzle to keep playing.", 'PUZZLE_CLOSED');
    return null;
  }
  return puzzle;
}

/**
 * Checks that a submitted grid has the puzzle's shape and holds only single letters in white
 * squares (black squares may be blank or '#'). Returns the grid uppercased with black squares
 * blank, or null after answering 400.
 */
function validateGrid(res: Response, puzzle: FullPuzzleData, grid: string[][]): string[][] | null {
  const shapeOk =
    grid.length === puzzle.height &&
    grid.every(
      (row, r) =>
        row.length === puzzle.width &&
        row.every((cell, c) => (puzzle.grid[r][c].isBlack ? cell === '' || cell === '#' : /^[A-Za-z]?$/.test(cell)))
    );
  if (!shapeOk) {
    sendError(res, 400, `The grid must be ${puzzle.height} rows of ${puzzle.width} letters or blanks`, 'INVALID_GRID');
    return null;
  }
  return grid.map((row, r) => row.map((cell, c) => (puzzle.grid[r][c].isBlack ? '' : cell.toUpperCase())));
}

/**
 * POST /api/auth/token
 */
apiRouter.post('/auth/token', asyncHandler(async (req: Request, res: Response): Promise<void> => {
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
    res.status(500).json({ error: 'Authentication with Discord failed' });
  }
}));

/**
 * The puzzle that is live right now, published on demand if the scheduler hasn't done it yet.
 */
export async function getOrPublishTodayPuzzle(): Promise<FullPuzzleData> {
  return getOrPublishCurrentPuzzle();
}

/**
 * GET /api/puzzle/today
 */
apiRouter.get('/puzzle/today', requireAuth, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthenticatedRequest).user;
  const puzzle = getOrPublishCurrentPuzzle();

  const attempt = transaction((): AttemptRow => {
    const existing = getAttempt(puzzle.id, user.userId);
    if (existing) return existing;

    // The clock starts the first time the player opens the puzzle.
    const created: AttemptRow = {
      id: `att-${user.userId}-${puzzle.id}-${Date.now().toString(36)}`,
      puzzle_id: puzzle.id,
      user_id: user.userId,
      guild_id: user.guildId, // Tied to the guild where the player first opened it
      start_time: new Date().toISOString(),
      finish_time: null,
      penalty_seconds: 0,
      grid_state_json: JSON.stringify(Array.from({ length: puzzle.height }, () => Array(puzzle.width).fill(''))),
      wrong_answers_json: '{}',
      locked_cells_json: '[]',
    };
    runQuery(
      `INSERT INTO attempts (
        id, puzzle_id, user_id, guild_id, start_time,
        penalty_seconds, grid_state_json, wrong_answers_json, locked_cells_json
      ) VALUES (?, ?, ?, ?, ?, 0, ?, '{}', '[]');`,
      [created.id, created.puzzle_id, created.user_id, created.guild_id, created.start_time, created.grid_state_json]
    );
    logEvent(created, user, 'attempt_started', { startTime: created.start_time });
    return created;
  });

  // Calculate elapsed wall clock seconds
  const elapsed = calculateElapsedSeconds(attempt.start_time, attempt.finish_time);
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
    totalScoreSeconds: calculateTotalScore(elapsed, attempt.penalty_seconds),
    isCompleted,
    gridState: JSON.parse(attempt.grid_state_json),
    lockedCells: JSON.parse(attempt.locked_cells_json || '[]'),
    wrongAnswersPerEntry: JSON.parse(attempt.wrong_answers_json || '{}'),
  };

  res.json({
    puzzle: clientPayload,
    attempt: attemptState,
    // ANTI-CHEAT: the solution is only revealed once the player has finished or the puzzle has closed.
    solution: isCompleted || puzzle.isClosed ? puzzle.solution : undefined,
  });
}));

/**
 * POST /api/attempt/save
 */
apiRouter.post('/attempt/save', requireAuth, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const parse = SaveProgressSchema.safeParse(req.body);
  if (!parse.success) {
    sendError(res, 400, 'Invalid grid state format', 'INVALID_GRID');
    return;
  }

  const user = (req as AuthenticatedRequest).user;
  const puzzle = requireLivePuzzle(res, parse.data.puzzleId);
  if (!puzzle) return;
  const grid = validateGrid(res, puzzle, parse.data.gridState);
  if (!grid) return;

  const attempt = getAttempt(puzzle.id, user.userId);
  if (!attempt) {
    sendError(res, 404, 'Attempt not found', 'ATTEMPT_NOT_FOUND');
    return;
  }
  if (attempt.finish_time) {
    sendError(res, 409, 'This attempt is already finished', 'ATTEMPT_FINISHED');
    return;
  }

  runQuery(`UPDATE attempts SET grid_state_json = ?, updated_at = datetime('now') WHERE id = ?;`, [
    JSON.stringify(grid),
    attempt.id,
  ]);
  res.json({ success: true });
}));

/**
 * POST /api/attempt/check-word
 */
apiRouter.post(
  '/attempt/check-word',
  requireAuth,
  rateLimitCheck,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parse = CheckWordSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid check request', details: parse.error.format() });
      return;
    }

    const user = (req as AuthenticatedRequest).user;
    const { puzzleId, entryNumber, direction, word } = parse.data;
    const puzzle = requireLivePuzzle(res, puzzleId);
    if (!puzzle) return;

    // Locate clue and solution word
    const targetClue = puzzle.cluesWithAnswers[direction].find((c) => c.number === entryNumber);
    if (!targetClue) {
      sendError(res, 404, 'Entry not found');
      return;
    }
    if (word.length !== targetClue.length) {
      sendError(res, 400, `This entry has ${targetClue.length} letters`);
      return;
    }

    const result = transaction(() => {
      const attempt = getAttempt(puzzle.id, user.userId);
      if (!attempt || attempt.finish_time) return null;

      const entryKey = `${entryNumber}-${direction}`;
      const check = evaluateCheckWordPenalty(
        entryKey,
        word,
        targetClue.answer,
        JSON.parse(attempt.wrong_answers_json || '{}')
      );

      const locked: { row: number; col: number }[] = JSON.parse(attempt.locked_cells_json || '[]');
      if (check.isCorrect) {
        // Lock every cell of the entry
        const isAcross = direction === 'across';
        for (let i = 0; i < targetClue.length; i++) {
          const r = isAcross ? targetClue.row : targetClue.row + i;
          const c = isAcross ? targetClue.col + i : targetClue.col;
          if (!locked.some((cell) => cell.row === r && cell.col === c)) {
            locked.push({ row: r, col: c });
          }
        }
      }

      const totalPenalty = attempt.penalty_seconds + check.penaltyAdded;
      runQuery(
        `UPDATE attempts SET
           penalty_seconds = ?,
           wrong_answers_json = ?,
           locked_cells_json = ?,
           updated_at = datetime('now')
         WHERE id = ?;`,
        [totalPenalty, JSON.stringify(check.updatedWrongAnswers), JSON.stringify(locked), attempt.id]
      );
      logEvent(attempt, user, 'check_word', {
        entryKey,
        word,
        correct: check.isCorrect,
        penaltyAdded: check.penaltyAdded,
      });

      return { check, entryKey, locked, totalPenalty };
    });

    if (!result) {
      sendError(res, 409, 'This attempt is already finished or was never started', 'ATTEMPT_FINISHED');
      return;
    }

    res.json({
      correct: result.check.isCorrect,
      entryKey: result.entryKey,
      lockedCells: result.check.isCorrect ? result.locked : undefined,
      penaltyAdded: result.check.penaltyAdded,
      totalPenaltySeconds: result.totalPenalty,
      isFirstTimeWrong: result.check.isFirstTimeWrong,
    });
  })
);

/**
 * POST /api/attempt/reveal-letter
 */
apiRouter.post(
  '/attempt/reveal-letter',
  requireAuth,
  rateLimitReveal,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parse = RevealLetterSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: 'Invalid cell coordinate' });
      return;
    }

    const user = (req as AuthenticatedRequest).user;
    const { puzzleId, row, col } = parse.data;
    const puzzle = requireLivePuzzle(res, puzzleId);
    if (!puzzle) return;

    if (row >= puzzle.height || col >= puzzle.width) {
      res.status(400).json({ error: 'Invalid cell coordinate' });
      return;
    }
    if (puzzle.grid[row][col].isBlack) {
      res.status(400).json({ error: 'Cannot reveal black cell' });
      return;
    }

    const letter = puzzle.solution[row][col];
    const penalty = GAME_CONFIG.REVEAL_LETTER_PENALTY_SECONDS;

    const outcome = transaction((): { error: string; status: number; code?: ApiErrorCode } | { totalPenalty: number } => {
      const attempt = getAttempt(puzzle.id, user.userId);
      if (!attempt || attempt.finish_time) {
        return { status: 409, error: 'This attempt is already finished or was never started', code: 'ATTEMPT_FINISHED' };
      }

      const lockedCells: { row: number; col: number }[] = JSON.parse(attempt.locked_cells_json || '[]');
      if (lockedCells.some((c) => c.row === row && c.col === col)) {
        // Already checked or revealed: don't charge the penalty twice (e.g. on a double click).
        return { status: 400, error: 'This cell is already locked' };
      }
      lockedCells.push({ row, col });

      const gridState: string[][] = JSON.parse(attempt.grid_state_json);
      if (!gridState[row]) gridState[row] = [];
      gridState[row][col] = letter;

      const totalPenalty = attempt.penalty_seconds + penalty;
      runQuery(
        `UPDATE attempts SET
           penalty_seconds = ?,
           grid_state_json = ?,
           locked_cells_json = ?,
           updated_at = datetime('now')
         WHERE id = ?;`,
        [totalPenalty, JSON.stringify(gridState), JSON.stringify(lockedCells), attempt.id]
      );
      logEvent(attempt, user, 'reveal_letter', { row, col, letter, penaltyAdded: penalty });
      return { totalPenalty };
    });

    if ('error' in outcome) {
      sendError(res, outcome.status, outcome.error, outcome.code);
      return;
    }

    res.json({
      row,
      col,
      letter,
      penaltyAdded: penalty,
      totalPenaltySeconds: outcome.totalPenalty,
    });
  })
);

/**
 * POST /api/attempt/submit
 */
apiRouter.post(
  '/attempt/submit',
  requireAuth,
  rateLimitSubmit,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parse = SubmitGridSchema.safeParse(req.body);
    if (!parse.success) {
      sendError(res, 400, 'Invalid submit grid data', 'INVALID_GRID');
      return;
    }

    const user = (req as AuthenticatedRequest).user;
    const puzzle = requireLivePuzzle(res, parse.data.puzzleId);
    if (!puzzle) return;
    const clientGrid = validateGrid(res, puzzle, parse.data.gridState);
    if (!clientGrid) return;

    const isFullyCorrect = puzzle.grid.every((row, r) =>
      row.every((cell, c) => cell.isBlack || clientGrid[r][c] === puzzle.solution[r][c])
    );

    type SubmitOutcome =
      | { kind: 'missing' }
      | { kind: 'finished' | 'solved'; attempt: AttemptRow; finishTime: string; totalScore: number }
      | { kind: 'incorrect'; totalPenalty: number };

    const outcome = transaction((): SubmitOutcome => {
      const attempt = getAttempt(puzzle.id, user.userId);
      if (!attempt) return { kind: 'missing' };

      if (attempt.finish_time) {
        const elapsed = calculateElapsedSeconds(attempt.start_time, attempt.finish_time);
        return {
          kind: 'finished',
          attempt,
          finishTime: attempt.finish_time,
          totalScore: calculateTotalScore(elapsed, attempt.penalty_seconds),
        };
      }

      if (isFullyCorrect) {
        const finishTime = new Date().toISOString();
        const totalScore = calculateTotalScore(
          calculateElapsedSeconds(attempt.start_time, finishTime),
          attempt.penalty_seconds
        );
        runQuery(
          `UPDATE attempts SET finish_time = ?, grid_state_json = ?, updated_at = datetime('now') WHERE id = ?;`,
          [finishTime, JSON.stringify(clientGrid), attempt.id]
        );
        logEvent(attempt, user, 'puzzle_solved', { finishTime, totalScore, penalties: attempt.penalty_seconds });
        return { kind: 'solved', attempt, finishTime, totalScore };
      }

      const penalty = GAME_CONFIG.SUBMIT_INCORRECT_PENALTY_SECONDS;
      const totalPenalty = attempt.penalty_seconds + penalty;
      runQuery(
        `UPDATE attempts SET penalty_seconds = ?, grid_state_json = ?, updated_at = datetime('now') WHERE id = ?;`,
        [totalPenalty, JSON.stringify(clientGrid), attempt.id]
      );
      logEvent(attempt, user, 'submit_incorrect', { penaltyAdded: penalty });
      return { kind: 'incorrect', totalPenalty };
    });

    if (outcome.kind === 'missing') {
      sendError(res, 404, 'Attempt not found', 'ATTEMPT_NOT_FOUND');
      return;
    }

    if (outcome.kind === 'incorrect') {
      res.json({
        success: false,
        penaltyAdded: GAME_CONFIG.SUBMIT_INCORRECT_PENALTY_SECONDS,
        totalPenaltySeconds: outcome.totalPenalty,
        message: 'Your grid contains errors. Keep hunting!',
      });
      return;
    }

    // Announce a new solve in the player's server, if the server turned announcements on
    if (outcome.kind === 'solved' && outcome.attempt.guild_id) {
      defaultBotClient
        .announceSolve(outcome.attempt.guild_id, user.displayName, outcome.totalScore, outcome.attempt.penalty_seconds)
        .catch((err) => console.error('[API Submit] Announce error:', err));
    }

    res.json({
      success: true,
      penaltyAdded: 0,
      totalPenaltySeconds: outcome.attempt.penalty_seconds,
      finishTime: outcome.finishTime,
      totalScoreSeconds: outcome.totalScore,
      solution: puzzle.solution,
    });
  })
);

/**
 * GET /api/leaderboard
 */
apiRouter.get('/leaderboard', requireAuth, asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const user = (req as AuthenticatedRequest).user;
  // Only the guild verified at login; a client-supplied guildId would expose other servers' standings.
  const guildId = user.guildId;
  const puzzle = getOrPublishCurrentPuzzle();

  if (!guildId) {
    // A player who launches the Activity outside a server (in a DM or group DM) can play, but
    // their attempt doesn't appear on any server leaderboard.
    res.json({
      guildId: null,
      leaderboard: [],
      message: 'Leaderboards are tracked per server. Launch from a server to appear on rankings!',
    });
    return;
  }

  res.json({
    guildId,
    date: puzzle.date,
    leaderboard: getGuildLeaderboard(guildId, puzzle.id),
  });
}));
