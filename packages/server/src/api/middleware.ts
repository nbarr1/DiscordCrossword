import { NextFunction, Request, Response } from 'express';
import { getSession, UserSession } from '../discord/auth.js';

export interface AuthenticatedRequest extends Request {
  user: UserSession;
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
