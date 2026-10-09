import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { HttpError, authenticate, hashToken, newRefreshToken, signAccess } from '../auth';
import { audit } from '../services/audit';
import { ah, type Ctx } from './common';

const creds = z.object({ email: z.string().email().max(200).transform((e) => e.toLowerCase()), password: z.string().min(8).max(200) });

export function authRouter(c: Ctx) {
  const r = Router();
  const cookie = { httpOnly: true, sameSite: 'lax' as const, secure: c.cfg.COOKIE_SECURE ? c.cfg.COOKIE_SECURE === 'true' : c.cfg.NODE_ENV === 'production', path: '/api/auth', maxAge: c.cfg.REFRESH_TTL_DAYS * 864e5 };

  const issue = async (res: any, u: { id: string; email: string; role: 'user' | 'admin'; name?: string | null }) => {
    const token = newRefreshToken();
    await c.db.query('insert into refresh_tokens(user_id,token_hash,expires_at) values($1,$2,now() + ($3 || \' days\')::interval)', [u.id, hashToken(token), String(c.cfg.REFRESH_TTL_DAYS)]);
    res.cookie('sp_refresh', token, cookie);
    return { accessToken: signAccess(c.cfg, { id: u.id, email: u.email, role: u.role }), user: { id: u.id, email: u.email, role: u.role, name: u.name ?? null } };
  };

  r.post('/register', ah(async (req, res) => {
    const { email, password } = creds.parse(req.body);
    const name = z.string().max(100).optional().parse(req.body?.name);
    if ((await c.db.query('select 1 from users where email=$1', [email])).length) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
    const hash = await bcrypt.hash(password, 12);
    const [u] = await c.db.query('insert into users(email,password_hash,name) values($1,$2,$3) returning id,email,role,name', [email, hash, name ?? null]);
    await audit(c.db, u.id, 'register', 'user', u.id);
    res.status(201).json(await issue(res, u));
  }));

  r.post('/login', ah(async (req, res) => {
    const { email, password } = creds.parse(req.body);
    const [u] = await c.db.query('select id,email,role,name,password_hash from users where email=$1', [email]);
    // Same message for unknown email and wrong password: do not reveal which accounts exist.
    if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, 'bad_credentials', 'Email or password is incorrect.');
    await audit(c.db, u.id, 'login', 'user', u.id);
    res.json(await issue(res, u));
  }));

  r.post('/refresh', ah(async (req, res) => {
    const token = req.cookies?.sp_refresh as string | undefined;
    if (!token) throw new HttpError(401, 'no_refresh', 'Please sign in again.');
    const [row] = await c.db.query('select rt.id, u.id as uid, u.email, u.role, u.name from refresh_tokens rt join users u on u.id=rt.user_id where rt.token_hash=$1 and rt.expires_at > now()', [hashToken(token)]);
    if (!row) { res.clearCookie('sp_refresh', cookie); throw new HttpError(401, 'bad_refresh', 'Please sign in again.'); }
    await c.db.query('delete from refresh_tokens where id=$1', [row.id]); // rotation: one-time use
    res.json(await issue(res, { id: row.uid, email: row.email, role: row.role, name: row.name }));
  }));

  r.post('/logout', ah(async (req, res) => {
    const token = req.cookies?.sp_refresh as string | undefined;
    if (token) await c.db.query('delete from refresh_tokens where token_hash=$1', [hashToken(token)]);
    res.clearCookie('sp_refresh', cookie).status(204).end();
  }));

  r.get('/me', authenticate(c.cfg, true), ah(async (req, res) => {
    const [u] = await c.db.query('select id,email,role,name,language from users where id=$1', [req.user!.id]);
    if (!u) throw new HttpError(401, 'unauthorized', 'Please sign in again.');
    res.json({ user: u });
  }));
  return r;
}
