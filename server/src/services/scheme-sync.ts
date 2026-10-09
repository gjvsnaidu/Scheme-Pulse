import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db';
import { saveScheme, type SchemeInput } from './schemes';
import { schemeSchema } from './scheme-validation';

const MAX_FEED_BYTES = 2_000_000;
const itemSchema = z.object({
  externalId: z.string().min(1).max(180),
  updatedAt: z.string().optional().refine((value) => value === undefined || value === '' || Number.isFinite(Date.parse(value))),
  sourceUrl: z.string().url(),
  scheme: z.unknown(),
});
const payloadSchema = z.object({ items: z.array(itemSchema).max(500) });

const isOfficialUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(gov\.in|nic\.in)$/.test(url.hostname);
  } catch { return false; }
};

const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  : value;

const contentHash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

interface SyncResult {
  sourceKey: string;
  sourceName: string;
  status: 'succeeded' | 'completed_with_errors' | 'failed' | 'already_running';
  itemsSeen: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  problems: { externalId: string; message: string }[];
  error?: string;
}

async function syncFeed(db: Db, feed: Config['OFFICIAL_SCHEME_FEEDS'][number]): Promise<SyncResult> {
  const leaseId = randomUUID();
  const locked = await db.query(
    `insert into scheme_sync_locks(source_key,lease_id,locked_until) values($1,$2,now()+interval '15 minutes')
     on conflict(source_key) do update set lease_id=excluded.lease_id,locked_until=excluded.locked_until
     where scheme_sync_locks.locked_until < now() returning lease_id`,
    [feed.key, leaseId],
  );
  const result: SyncResult = { sourceKey: feed.key, sourceName: feed.name, status: 'failed', itemsSeen: 0, created: 0, updated: 0, unchanged: 0, rejected: 0, problems: [] };
  if (!locked.length) return { ...result, status: 'already_running' };
  let runId: string | undefined;
  try {
    const [run] = await db.query<{ id: string }>(
      "insert into scheme_sync_runs(source_key,source_name,status) values($1,$2,'running') returning id",
      [feed.key, feed.name],
    );
    runId = run.id;
    let response: Response;
    try {
      response = await fetch(feed.url, {
        headers: { accept: 'application/json', ...(feed.token ? { authorization: `Bearer ${feed.token}` } : {}) },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('The official feed could not be reached.'); }
    if (response.status >= 300 && response.status < 400) throw new Error('The official feed redirected; configure its final HTTPS URL directly.');
    if (!response.ok) throw new Error(`The official feed returned HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_FEED_BYTES) throw new Error('The official feed exceeds the 2 MB limit.');
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_FEED_BYTES) throw new Error('The official feed exceeds the 2 MB limit.');
    let decoded: unknown;
    try { decoded = JSON.parse(body); } catch { throw new Error('The official feed did not return valid JSON.'); }
    const payload = payloadSchema.safeParse(decoded);
    if (!payload.success) throw new Error('The official feed must contain an items array using the SchemePulse normalized feed contract.');
    result.itemsSeen = payload.data.items.length;
    const seenIds = new Set<string>();

    for (const item of payload.data.items) {
      try {
        if (seenIds.has(item.externalId)) throw new Error('Duplicate external ID in feed.');
        seenIds.add(item.externalId);
        if (!isOfficialUrl(item.sourceUrl)) throw new Error('Scheme source URL must be HTTPS on a gov.in or nic.in domain.');
        const parsed = schemeSchema.safeParse(item.scheme);
        if (!parsed.success) throw new Error(`Scheme fields need review: ${parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean).join(', ') || 'invalid record'}.`);
        const scheme = { ...parsed.data, sourceUrl: item.sourceUrl, isDemo: false } as SchemeInput;
        const hash = contentHash({ scheme, sourceUrl: item.sourceUrl });
        const [existing] = await db.query<{ id: string; source_hash: string | null }>(
          'select id,source_hash from schemes where source_key=$1 and source_record_id=$2', [feed.key, item.externalId],
        );
        const updatedAt = item.updatedAt ? new Date(item.updatedAt).toISOString() : null;
        if (existing && existing.source_hash === hash) {
          await db.query('update schemes set source_updated_at=$2,source_synced_at=now() where id=$1', [existing.id, updatedAt]);
          result.unchanged++;
          continue;
        }
        if (!existing) {
          const [slugOwner] = await db.query('select id from schemes where slug=$1', [scheme.slug]);
          if (slugOwner) throw new Error('Scheme slug already belongs to another record.');
        }
        const schemeId = await saveScheme(db, scheme, { id: existing?.id, status: 'draft' });
        await db.query(
          `update schemes set source_key=$2,source_record_id=$3,source_updated_at=$4,source_synced_at=now(),source_hash=$5 where id=$1`,
          [schemeId, feed.key, item.externalId, updatedAt, hash],
        );
        if (existing) result.updated++;
        else result.created++;
      } catch (error) {
        result.rejected++;
        if (result.problems.length < 30) result.problems.push({ externalId: item.externalId, message: error instanceof Error ? error.message : 'Record could not be imported.' });
      }
    }
    result.status = result.rejected ? 'completed_with_errors' : 'succeeded';
    await db.query(
      'update scheme_sync_runs set status=$2,items_seen=$3,created=$4,updated=$5,unchanged=$6,rejected=$7,finished_at=now() where id=$1',
      [runId, result.status, result.itemsSeen, result.created, result.updated, result.unchanged, result.rejected],
    );
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'The official feed sync failed.';
    result.status = 'failed';
    if (runId) await db.query(
      "update scheme_sync_runs set status='failed',error=$2,finished_at=now() where id=$1",
      [runId, result.error],
    );
  } finally {
    await db.query('delete from scheme_sync_locks where source_key=$1 and lease_id=$2', [feed.key, leaseId]);
  }
  return result;
}

export async function syncOfficialSchemes(db: Db, cfg: Config, key?: string) {
  const feeds = key ? cfg.OFFICIAL_SCHEME_FEEDS.filter((feed) => feed.key === key) : cfg.OFFICIAL_SCHEME_FEEDS;
  if (key && !feeds.length) throw new Error('That official feed is not configured.');
  const results: SyncResult[] = [];
  for (const feed of feeds) results.push(await syncFeed(db, feed));
  return { configured: cfg.OFFICIAL_SCHEME_FEEDS.length > 0, results };
}

export async function officialSchemeSyncStatus(db: Db, cfg: Config) {
  const runs = await db.query(
    'select id,source_key,source_name,status,items_seen,created,updated,unchanged,rejected,error,started_at,finished_at from scheme_sync_runs order by started_at desc limit 30',
  );
  return {
    configured: cfg.OFFICIAL_SCHEME_FEEDS.length > 0,
    feeds: cfg.OFFICIAL_SCHEME_FEEDS.map(({ key, name, url }) => ({ key, name, portal: new URL(url).origin })),
    runs,
  };
}