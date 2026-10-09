import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db';
import type { AiProvider } from '../ai/provider';
import type { Mailer } from '../services/mailer';
import type { Storage } from '../services/storage';
import type { Profile } from '../engine/types';

export interface Ctx { db: Db; cfg: Config; ai: AiProvider; mail: Mailer; storage: Storage }

export const ah = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

export const profileSchema = z.object({
  age: z.number().int().min(0).max(120).optional(),
  income: z.number().int().min(0).max(1_000_000_000).optional(),
  state: z.string().max(60).optional(),
  occupation: z.enum(['student', 'farmer', 'entrepreneur', 'jobseeker', 'retired', 'other']).optional(),
  goal: z.string().max(40).optional(),
  gender: z.enum(['female', 'male', 'other']).optional(),
  category: z.string().max(40).optional(),
});

export const rowToProfile = (r: any): Profile =>
  r ? (Object.fromEntries(['age', 'income', 'state', 'occupation', 'goal', 'gender', 'category'].filter((k) => r[k] !== null && r[k] !== undefined).map((k) => [k, r[k]])) as Profile) : {};

export const getUserProfile = async (db: Db, userId: string) =>
  rowToProfile((await db.query('select * from profiles where user_id=$1', [userId]))[0]);

/** Public DTO: the nested rule/document detail stays, internal ids stay, nothing secret is exposed. */
export const pageParams = (q: Request['query']) => {
  const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(String(q.pageSize ?? '20'), 10) || 20));
  return { page, pageSize };
};
