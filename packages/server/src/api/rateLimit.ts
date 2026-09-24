import { GAME_CONFIG } from '@crossword/shared';
import { NextFunction, Request, Response } from 'express';

interface RateLimitRecord {
  timestamps: number[];
}

const checkLimits = new Map<string, RateLimitRecord>();
const revealLimits = new Map<string, RateLimitRecord>();
const submitLimits = new Map<string, RateLimitRecord>();

function isRateLimited(store: Map<string, RateLimitRecord>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let record = store.get(key);
  if (!record) {
    record = { timestamps: [] };
    store.set(key, record);
  }

  // Prune older than window
  record.timestamps = record.timestamps.filter((t) => now - t < windowMs);

  if (record.timestamps.length >= max) {
    return true;
  }

  record.timestamps.push(now);
  return false;
}

export function rateLimitCheck(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as any).user?.userId || req.ip;
  if (isRateLimited(checkLimits, userId, GAME_CONFIG.RATE_LIMIT_CHECK_MAX, GAME_CONFIG.RATE_LIMIT_CHECK_WINDOW_MS)) {
    res.status(429).json({ error: 'Too many word check attempts. Please slow down.' });
    return;
  }
  next();
}

export function rateLimitReveal(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as any).user?.userId || req.ip;
  if (isRateLimited(revealLimits, userId, GAME_CONFIG.RATE_LIMIT_REVEAL_MAX, GAME_CONFIG.RATE_LIMIT_REVEAL_WINDOW_MS)) {
    res.status(429).json({ error: 'Too many letter reveal requests. Please slow down.' });
    return;
  }
  next();
}

export function rateLimitSubmit(req: Request, res: Response, next: NextFunction): void {
  const userId = (req as any).user?.userId || req.ip;
  if (isRateLimited(submitLimits, userId, GAME_CONFIG.RATE_LIMIT_SUBMIT_MAX, GAME_CONFIG.RATE_LIMIT_SUBMIT_WINDOW_MS)) {
    res.status(429).json({ error: 'Too many submit attempts. Please wait a moment.' });
    return;
  }
  next();
}
