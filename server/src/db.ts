import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS } from './migrations';
import type { Config } from './config';

export interface Db {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** PostgreSQL via `pg` when DATABASE_URL is set, otherwise embedded Postgres (PGlite) so the app runs with zero setup. */
export async function connect(cfg: Config): Promise<Db> {
  if (cfg.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 10 });
    const wrap = (c: pg.Pool | pg.PoolClient): Db => ({
      query: async (sql, params) => (await c.query(sql, params)).rows,
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const r = await fn(wrap(client));
          await client.query('commit');
          return r;
        } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
      },
      close: async () => { if (c === pool) await pool.end(); },
    });
    return wrap(pool);
  }
  const lite = new PGlite(cfg.PGLITE_DIR);
  await lite.waitReady;
  const wrap = (c: { query: PGlite['query'] }): Db => ({
    query: async (sql, params) => (await c.query(sql, params)).rows as any[],
    tx: async (fn) => lite.transaction(async (t) => fn(wrap(t as any))),
    close: async () => { await lite.close(); },
  });
  return wrap(lite);
}

export async function migrate(db: Db): Promise<void> {
  await db.query('create table if not exists schema_migrations(id text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ id: string }>('select id from schema_migrations')).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.tx(async (t) => {
      for (const stmt of m.sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query('insert into schema_migrations(id) values($1)', [m.id]);
    });
  }
}
