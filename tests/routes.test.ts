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

    const submit = await api(token, 'POST', '/api/attempt/submit', { gridState: puzzle.solution });
    expect(submit.status).toBe(200);
    expect(submit.body.success).toBe(true);
    expect(submit.body.totalPenaltySeconds).toBe(0);

    const after = await api(token, 'GET', '/api/puzzle/today');
    expect(after.body.attempt.isCompleted).toBe(true);
    expect(after.body.solution).toEqual(puzzle.solution);

    // Re-submitting after completion still reports penalties (the client adds them to the score).
    const again = await api(token, 'POST', '/api/attempt/submit', { gridState: puzzle.solution });
    expect(again.body.totalPenaltySeconds).toBe(0);
  });

  it('rejects out-of-range reveal coordinates with 400', async () => {
    const token = await login('u-bounds', 'g-1');
    const { body: today } = await api(token, 'GET', '/api/puzzle/today');

    const res = await api(token, 'POST', '/api/attempt/reveal-letter', { row: today.puzzle.height, col: 0 });
    expect(res.status).toBe(400);
  });

  it('does not charge the reveal penalty twice for the same cell', async () => {
    const token = await login('u-reveal', 'g-1');
    const { body: today } = await api(token, 'GET', '/api/puzzle/today');
    const row = 0;
    const col = today.puzzle.grid[0].findIndex((cell: { isBlack: boolean }) => !cell.isBlack);

    const first = await api(token, 'POST', '/api/attempt/reveal-letter', { row, col });
    expect(first.status).toBe(200);
    expect(first.body.totalPenaltySeconds).toBe(60);

    const second = await api(token, 'POST', '/api/attempt/reveal-letter', { row, col });
    expect(second.status).toBe(400);

    const { body: after } = await api(token, 'GET', '/api/puzzle/today');
    expect(after.attempt.penaltySeconds).toBe(60);
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
