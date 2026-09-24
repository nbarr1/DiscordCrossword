import { NextFunction, Request, Response } from 'express';
import { getSession, UserSession } from '../discord/auth.js';

export interface AuthenticatedRequest extends Request {
  user: UserSession;
}

/**
 * Wraps an async handler so a rejected promise is passed to Express's error
 * handler. Express 4 doesn't catch async errors, and an unhandled rejection
 * terminates the Node process.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const session = getSession(token);

  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session token' });
    return;
  }

  (req as AuthenticatedRequest).user = session;
  next();
}
