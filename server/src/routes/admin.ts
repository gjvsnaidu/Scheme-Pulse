import { Router } from 'express';
import { z } from 'zod';
import { HttpError, authenticate, requireAdmin } from '../auth';
import { audit } from '../services/audit';
import { runDeadlineJob } from '../services/jobs';
import { officialSchemeSyncStatus, syncOfficialSchemes } from '../services/scheme-sync';
import { getScheme, loadSchemes, saveScheme } from '../services/schemes';
import { schemeSchema } from '../services/scheme-validation';
export { schemeSchema } from '../services/scheme-validation';
import { DEFAULT_WEIGHTS } from '../engine/scoring';
import { ah, type Ctx } from './common';

export function adminRouter(c: Ctx) {
  const r = Router();
  r.use(authenticate(c.cfg, true), requireAdmin);
  const actor = (req: any) => req.user.id as string;

  r.get('/schemes', ah(async (_req, res) => res.json({ items: await loadSchemes(c.db, { status: ['draft', 'pending_review', 'published', 'archived'] }) })));
  r.get('/sources', ah(async (_req, res) => res.json(await officialSchemeSyncStatus(c.db, c.cfg))));
  r.post('/sources/sync', ah(async (req, res) => {
    const { key } = z.object({ key: z.string().min(2).max(40).optional() }).parse(req.body ?? {});
    const report = await syncOfficialSchemes(c.db, c.cfg, key);
    await audit(c.db, actor(req), 'official_scheme_sync', 'source', key ?? 'all', {
      results: report.results.map(({ sourceKey, status, created, updated, unchanged, rejected }) => ({ sourceKey, status, created, updated, unchanged, rejected })),
    });
    res.json(report);
  }));
  r.post('/schemes', ah(async (req, res) => {
    const input = schemeSchema.parse(req.body);
    if ((await c.db.query('select 1 from schemes where slug=$1', [input.slug])).length) throw new HttpError(409, 'slug_taken', 'A scheme with this slug already exists.');
    const id = await saveScheme(c.db, input as any, { actorId: actor(req) });
    await audit(c.db, actor(req), 'scheme_created', 'scheme', id);
    res.status(201).json({ id });
  }));
  r.put('/schemes/:id', ah(async (req, res) => {
    const input = schemeSchema.parse(req.body);
    const cur = await getScheme(c.db, req.params.id);
    if (!cur) throw new HttpError(404, 'not_found', 'Scheme not found.');
    await saveScheme(c.db, input as any, { id: cur.id, actorId: actor(req) });
    await audit(c.db, actor(req), 'scheme_updated', 'scheme', cur.id, { from: cur.version });
    res.json({ id: cur.id, note: cur.status === 'published' ? 'Published schemes return to review after edits, so important changes are never published unchecked.' : undefined });
  }));
  r.get('/schemes/:id/versions', ah(async (req, res) => res.json({ items: await c.db.query('select version,snapshot,created_at,changed_by from scheme_versions where scheme_id=$1::uuid order by version desc', [req.params.id]) })));
  r.post('/schemes/:id/review', ah(async (req, res) => {
    const { decision, note } = z.object({ decision: z.enum(['verified', 'published', 'archived', 'changes_requested']), note: z.string().max(500).optional() }).parse(req.body);
    const s = await getScheme(c.db, req.params.id);
    if (!s) throw new HttpError(404, 'not_found', 'Scheme not found.');
    if (decision === 'verified' && !s.sourceUrl) throw new HttpError(422, 'source_required', 'Add an official source URL before marking a scheme as verified.');
    if (decision === 'published' && s.rules.length === 0) throw new HttpError(422, 'rules_required', 'Add at least one eligibility rule before publishing.');
    const status = decision === 'archived' ? 'archived' : decision === 'changes_requested' ? 'draft' : 'published';
    await c.db.query(`update schemes set status=$2, verified_at=case when $3 then now() else verified_at end, verified_by=case when $3 then $4::uuid else verified_by end, updated_at=now() where id=$1::uuid`, [s.id, status, decision === 'verified', actor(req)]);
    await c.db.query('insert into admin_reviews(scheme_id,reviewer_id,decision,note) values($1,$2,$3,$4)', [s.id, actor(req), decision, note ?? null]);
    await audit(c.db, actor(req), `scheme_${decision}`, 'scheme', s.id, { note });
    res.json({ id: s.id, status });
  }));

  /** Ingestion: normalise -> duplicate detection -> validate -> save as DRAFT. Nothing is auto-published. */
  r.post('/ingest', ah(async (req, res) => {
    const items = z.array(z.unknown()).max(200).parse(req.body?.items);
    const report = { created: 0, duplicates: [] as string[], invalid: [] as { index: number; problems: string[] }[] };
    for (const [i, raw] of items.entries()) {
      const p = schemeSchema.safeParse(raw);
      if (!p.success) { report.invalid.push({ index: i, problems: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`) }); continue; }
      const dup = await c.db.query('select 1 from schemes where slug=$1 or lower(name)=lower($2)', [p.data.slug, p.data.name]);
      if (dup.length) { report.duplicates.push(p.data.slug); continue; }
      await saveScheme(c.db, p.data as any, { actorId: actor(req) }); report.created++;
    }
    await audit(c.db, actor(req), 'ingest', 'scheme', null, { created: report.created });
    res.json(report);
  }));

  r.get('/analytics', ah(async (_req, res) => {
    const q = (sql: string) => c.db.query(sql);
    const [counts] = await q(`select (select count(*)::int from schemes) as schemes, (select count(*)::int from schemes where status='published') as published,
      (select count(*)::int from schemes where status='pending_review') as pending, (select count(*)::int from schemes where verified_at is not null) as verified,
      (select count(*)::int from schemes where status='published' and deadline between current_date and current_date + 30) as expiring,
      (select count(*)::int from schemes where status='published' and (verified_at is null or verified_at < now() - interval '90 days')) as needs_review,
      (select count(*)::int from users) as users`);
    res.json({ counts,
      mostSaved: await q('select s.name, count(*)::int as n from saved_schemes v join schemes s on s.id=v.scheme_id group by s.name order by n desc limit 5'),
      mostRecommended: await q("select s.name, count(*)::int as n from recommendations x join schemes s on s.id=x.scheme_id where x.status<>'not_eligible' group by s.name order by n desc limit 5"),
      topSearches: await q("select payload->>'q' as q, count(*)::int as n from events where kind='search' group by 1 order by n desc limit 5"),
      assistantTopics: await q("select payload->>'intent' as intent, count(*)::int as n from events where kind='chat' group by 1 order by n desc"),
      categoryDemand: await q("select s.category, count(*)::int as n from events e join schemes s on s.slug = e.payload->>'slug' where e.kind='view' group by 1 order by n desc"),
    });
  }));
  r.get('/weights', ah(async (_req, res) => {
    const w = await c.db.query("select value from settings where key='weights'");
    res.json({ weights: w[0]?.value ?? DEFAULT_WEIGHTS });
  }));
  r.put('/weights', ah(async (req, res) => {
    const w = z.object({ eligibility: z.number().min(0), need: z.number().min(0), location: z.number().min(0), benefit: z.number().min(0), deadline: z.number().min(0), preference: z.number().min(0) })
      .refine((x) => Object.values(x).reduce((a, b) => a + b, 0) > 0, { message: 'Weights cannot all be zero' }).parse(req.body);
    await c.db.query(`insert into settings(key,value) values('weights',$1::jsonb) on conflict(key) do update set value=$1::jsonb, updated_at=now()`, [JSON.stringify(w)]);
    await audit(c.db, actor(req), 'weights_updated', 'settings', 'weights', w);
    res.json({ weights: w });
  }));
  r.get('/audit', ah(async (_req, res) => res.json({ items: await c.db.query('select id,actor_id,action,entity,entity_id,meta,created_at from audit_logs order by id desc limit 100') })));
  r.get('/users', ah(async (_req, res) => res.json({ items: await c.db.query('select id,email,name,role,created_at from users order by created_at desc limit 200') })));
  r.post('/jobs/deadlines', ah(async (_req, res) => res.json(await runDeadlineJob(c.db, c.mail))));
  return r;
}
