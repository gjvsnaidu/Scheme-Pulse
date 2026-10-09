import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { HttpError } from './auth';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { userRouter } from './routes/user';
import { adminRouter } from './routes/admin';
import type { Ctx } from './routes/common';

export function createApp(c: Ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'"], connectSrc: ["'self'"], upgradeInsecureRequests: c.cfg.NODE_ENV === 'production' ? [] : null } } }));
  app.use(cors({ origin: c.cfg.CORS_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (!c.cfg.RATE_LIMIT_DISABLED) {
    const rl = (max: number) => rateLimit({ windowMs: 15 * 60_000, max, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'rate_limited', message: 'Too many requests. Please wait a few minutes and try again.' } } });
    app.use('/api', rl(600));
    app.use('/api/auth', rl(40));
    app.use('/api/ai', rl(60));
  }
  app.get('/api/health', async (_req, res) => { await c.db.query('select 1'); res.json({ ok: true }); });
  const api = express.Router();
  api.use('/auth', authRouter(c));
  api.use('/admin', adminRouter(c));
  api.use(publicRouter(c));
  api.use(userRouter(c));
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'That endpoint does not exist.')));

  const dist = resolve(c.cfg.WEB_DIST);
  if (c.cfg.SERVE_WEB && existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: { code: 'validation_error', message: 'Some details are not valid.', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'file_too_large', message: 'Files must be 5 MB or smaller.' } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'The request body is not valid JSON.' } });
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Your data is safe. Please try again.' } });
  };
  app.use(onError);
  return app;
}
