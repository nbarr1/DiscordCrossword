import { describe, expect, it } from 'vitest';
import { requireAuth } from '../packages/server/src/api/middleware.js';
import { createSession } from '../packages/server/src/discord/auth.js';

describe('Session Middleware', () => {
  it('allows access with a valid session token', () => {
    const token = createSession({
      userId: '123456789',
      username: 'solver1',
      displayName: 'Solver One',
      avatar: null,
      guildId: '987654321',
    });

    const req: any = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    let nextCalled = false;
    const res: any = {
      status: () => res,
      json: () => res,
    };

    requireAuth(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe('123456789');
    expect(req.user.displayName).toBe('Solver One');
  });

  it('rejects requests with missing Authorization header', () => {
    const req: any = { headers: {} };
    let statusCode = 0;
    let errorBody: any = null;

    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (body: any) => {
        errorBody = body;
        return res;
      },
    };

    let nextCalled = false;
    requireAuth(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(401);
    expect(errorBody?.error).toContain('Missing or malformed');
  });

  it('rejects requests with invalid or forged token', () => {
    const req: any = {
      headers: {
        authorization: 'Bearer forged-random-token-xyz',
      },
    };

    let statusCode = 0;
    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: () => res,
    };

    let nextCalled = false;
    requireAuth(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(401);
  });
});
