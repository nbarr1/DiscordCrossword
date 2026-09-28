import express from 'express';
import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery, setDatabasePath } from '../packages/server/src/db/database.js';
import { runMigrations } from '../packages/server/src/db/migrations.js';
import { asyncHandler } from '../packages/server/src/api/middleware.js';
import { apiRouter, getOrPublishTodayPuzzle } from '../packages/server/src/api/routes.js';
import { createSession } from '../packages/server/src/discord/auth.js';

let server: http.Server;
let baseUrl = '';
let tmpDir = '';

async function login(userId: string, guildId: string | null): Promise<string> {
  await runQuery(
    `INSERT OR REPLACE INTO players (user_id, username, display_name, avatar) VALUES (?, ?, ?, NULL);`,
    [userId, userId, `Player ${userId}`]
  );
  return createSession({ userId, username: userId, displayName: `Player ${userId}`, avatar: null, guildId });
}

async function api(token: string, method: string, endpoint: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossword-routes-'));
  setDatabasePath(path.join(tmpDir, 'test.db'));
  await runMigrations();

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.use('/api', (_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Puzzle API', () => {
  it('serves a grid sized to the puzzle and withholds the solution until the attempt is finished', async () => {
    const token = await login('u-sizing', 'g-1');
    const { status, body } = await api(token, 'GET', '/api/puzzle/today');

    expect(status).toBe(200);
    expect(body.solution).toBeUndefined();
    expect(body.attempt.gridState).toHaveLength(body.puzzle.height);
    expect(body.attempt.gridState[0]).toHaveLength(body.puzzle.width);
  });

  it('accepts a correct submission (without crashing) and then returns the solution', async () => {
    const token = await login('u-solver', 'g-1');
    await api(token, 'GET', '/api/puzzle/today');
    const puzzle = await getOrPublishTodayPuzzle();

    const submit = await api(token, 'POST', '/api/attempt/submit', { puzzleId: puzzle.id, gridState: puzzle.solution });
    expect(submit.status).toBe(200);
    expect(submit.body.success).toBe(true);
    expect(submit.body.totalPenaltySeconds).toBe(0);

    const after = await api(token, 'GET', '/api/puzzle/today');
    expect(after.body.attempt.isCompleted).toBe(true);
    expect(after.body.solution).toEqual(puzzle.solution);

    // Re-submitting after completion still reports penalties (the client adds them to the score).
    const again = await api(token, 'POST', '/api/attempt/submit', { puzzleId: puzzle.id, gridState: puzzle.solution });
    expect(again.body.totalPenaltySeconds).toBe(0);
  });

  it('rejects out-of-range reveal coordinates with 400', async () => {
    const token = await login('u-bounds', 'g-1');
    const { body: today } = await api(token, 'GET', '/api/puzzle/today');

    const res = await api(token, 'POST', '/api/attempt/reveal-letter', {
      puzzleId: today.puzzle.id,
      row: today.puzzle.height,
      col: 0,
    });
    expect(res.status).toBe(400);
  });

  it('does not charge the reveal penalty twice for the same cell', async () => {
    const token = await login('u-reveal', 'g-1');
    const { body: today } = await api(token, 'GET', '/api/puzzle/today');
    const row = 0;
    const col = today.puzzle.grid[0].findIndex((cell: { isBlack: boolean }) => !cell.isBlack);

    const first = await api(token, 'POST', '/api/attempt/reveal-letter', { puzzleId: today.puzzle.id, row, col });
    expect(first.status).toBe(200);
    expect(first.body.totalPenaltySeconds).toBe(60);

    const second = await api(token, 'POST', '/api/attempt/reveal-letter', { puzzleId: today.puzzle.id, row, col });
    expect(second.status).toBe(400);

    const { body: after } = await api(token, 'GET', '/api/puzzle/today');
    expect(after.attempt.penaltySeconds).toBe(60);
  });

  it('answers 409 PUZZLE_CLOSED for actions on a puzzle that is no longer live, without touching the current attempt', async () => {
    const token = await login('u-stale', 'g-1');
    const { body: today } = await api(token, 'GET', '/api/puzzle/today');
    const clue = today.puzzle.clues.across[0];
    const blankGrid = today.attempt.gridState;

    const requests: [string, unknown][] = [
      ['/api/attempt/save', { puzzleId: 'puzzle-yesterday', gridState: blankGrid }],
      ['/api/attempt/check-word', { puzzleId: 'puzzle-yesterday', entryNumber: clue.number, direction: 'across', word: 'Z'.repeat(clue.length) }],
      ['/api/attempt/reveal-letter', { puzzleId: 'puzzle-yesterday', row: clue.row, col: clue.col }],
      ['/api/attempt/submit', { puzzleId: 'puzzle-yesterday', gridState: blankGrid }],
    ];
    for (const [endpoint, body] of requests) {
      const res = await api(token, 'POST', endpoint, body);
      expect(res.status, endpoint).toBe(409);
      expect(res.body.code, endpoint).toBe('PUZZLE_CLOSED');
    }

    const { body: after } = await api(token, 'GET', '/api/puzzle/today');
    expect(after.attempt.penaltySeconds).toBe(0);
    expect(after.attempt.lockedCells).toEqual([]);
  });

  it('rejects grids that do not match the puzzle', async () => {
    const token = await login('u-grid', 'g-1');
    const { body: today } = await api(token, 'GET', '/api/puzzle/today');
    const puzzleId = today.puzzle.id;

    const tiny = await api(token, 'POST', '/api/attempt/save', { puzzleId, gridState: [['A']] });
    expect(tiny.status).toBe(400);
    expect(tiny.body.code).toBe('INVALID_GRID');

    const digits = today.attempt.gridState.map((row: string[]) => row.map(() => '7'));
    const bad = await api(token, 'POST', '/api/attempt/submit', { puzzleId, gridState: digits });
    expect(bad.status).toBe(400);

    const ok = await api(token, 'POST', '/api/attempt/save', { puzzleId, gridState: today.attempt.gridState });
    expect(ok.status).toBe(200);
  });

  it('reports a save for a player who never opened the puzzle instead of claiming success', async () => {
    const token = await login('u-never-opened', 'g-1');
    const puzzle = await getOrPublishTodayPuzzle();
    const grid = puzzle.grid.map((row) => row.map(() => ''));
    const res = await api(token, 'POST', '/api/attempt/save', { puzzleId: puzzle.id, gridState: grid });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ATTEMPT_NOT_FOUND');
  });

  it('refuses to check a word of the wrong length without charging a penalty', async () => {
    const token = await login('u-length', 'g-1');
    const { body: today } = await api(token, 'GET', '/api/puzzle/today');
    const clue = today.puzzle.clues.across[0];

    const res = await api(token, 'POST', '/api/attempt/check-word', {
      puzzleId: today.puzzle.id,
      entryNumber: clue.number,
      direction: 'across',
      word: 'Z'.repeat(clue.length + 1),
    });
    expect(res.status).toBe(400);

    const { body: after } = await api(token, 'GET', '/api/puzzle/today');
    expect(after.attempt.penaltySeconds).toBe(0);
  });

  it('ranks the server leaderboard by total time', async () => {
    const puzzle = await getOrPublishTodayPuzzle();
    const fast = await login('u-rank-fast', 'g-rank');
    const slow = await login('u-rank-slow', 'g-rank');
    for (const token of [slow, fast]) {
      await api(token, 'GET', '/api/puzzle/today');
    }
    // The slow player reveals a letter first, so they finish with a 60-second penalty.
    const { body: today } = await api(slow, 'GET', '/api/puzzle/today');
    const col = today.puzzle.grid[0].findIndex((cell: { isBlack: boolean }) => !cell.isBlack);
    await api(slow, 'POST', '/api/attempt/reveal-letter', { puzzleId: puzzle.id, row: 0, col });
    for (const token of [slow, fast]) {
      await api(token, 'POST', '/api/attempt/submit', { puzzleId: puzzle.id, gridState: puzzle.solution });
    }

    const { body } = await api(fast, 'GET', '/api/leaderboard');
    expect(body.leaderboard.map((e: { userId: string }) => e.userId)).toEqual(['u-rank-fast', 'u-rank-slow']);
    expect(body.leaderboard.map((e: { rank: number }) => e.rank)).toEqual([1, 2]);
  });

  it('only returns the leaderboard for the guild verified at login', async () => {
    const token = await login('u-other-guild', 'g-2');
    const { body } = await api(token, 'GET', '/api/leaderboard?guildId=g-1');

    expect(body.guildId).toBe('g-2');
    expect(body.leaderboard).toEqual([]);
  });

  it('refuses mock logins in production', async () => {
    const savedEnv = process.env.NODE_ENV;
    const savedSecret = process.env.DISCORD_CLIENT_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.DISCORD_CLIENT_SECRET;
    try {
      const res = await fetch(`${baseUrl}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'anything', guildId: 'g-1' }),
      });
      expect(res.status).toBe(500);
    } finally {
      process.env.NODE_ENV = savedEnv;
      if (savedSecret !== undefined) process.env.DISCORD_CLIENT_SECRET = savedSecret;
    }
  });
});

describe('asyncHandler', () => {
  it('forwards a rejected handler to next() instead of leaving an unhandled rejection', async () => {
    const error = new Error('boom');
    const forwarded = await new Promise((resolve) => {
      asyncHandler(async () => {
        throw error;
      })({} as any, {} as any, resolve);
    });
    expect(forwarded).toBe(error);
  });
});
