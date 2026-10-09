import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { Config } from './config';

export interface AuthUser { id: string; role: 'user' | 'admin'; email: string }
declare global { namespace Express { interface Request { user?: AuthUser } } }

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export const signAccess = (cfg: Config, u: AuthUser) => jwt.sign(u, cfg.JWT_SECRET, { expiresIn: `${cfg.ACCESS_TTL_MIN}m`, issuer: 'schemepulse' });
export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url');
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function authenticate(cfg: Config, required: boolean) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      try {
        const p = jwt.verify(h.slice(7), cfg.JWT_SECRET, { issuer: 'schemepulse' }) as AuthUser;
        req.user = { id: p.id, role: p.role, email: p.email };
      } catch { return next(new HttpError(401, 'invalid_token', 'Your session expired. Please sign in again.')); }
    }
    if (required && !req.user) return next(new HttpError(401, 'unauthorized', 'Please sign in to continue.'));
    next();
  };
}

export const requireAdmin = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.role === 'admin' ? next() : next(new HttpError(403, 'forbidden', 'Admin access required.'));
