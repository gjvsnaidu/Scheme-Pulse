import { Router } from 'express';
import { z } from 'zod';
import { HttpError, authenticate } from '../auth';
import { answer } from '../ai/assistant';
import { evaluate } from '../engine/eligibility';
import { getScheme, loadSchemes } from '../services/schemes';
import { getWeights, recommend, recommendFrom, simulate } from '../services/recommend';
import { track } from '../services/audit';
import { ah, getUserProfile, pageParams, profileSchema, type Ctx } from './common';
import { STATES, describeDetected } from '../engine/parser';
import type { Profile } from '../engine/types';

export function publicRouter(c: Ctx) {
  const r = Router();
  const opt = authenticate(c.cfg, false);
  const profileFor = async (req: any, body?: unknown): Promise<Profile> => {
    if (body) return profileSchema.parse(body);
    if (req.user) return getUserProfile(c.db, req.user.id);
    return {};
  };

  r.get('/meta', (_req, res) => res.json({ states: STATES }));

  r.post('/profiles/parse', ah(async (req, res) => {
    const { text } = z.object({ text: z.string().min(3).max(2000) }).parse(req.body);
    const profile = await c.ai.extractProfile(text);
    res.json({ profile, detected: describeDetected(profile), provider: c.ai.name, note: 'Nothing is saved until you confirm.' });
  }));

  const list = async (q: { q?: string; category?: string; page?: string; pageSize?: string }, userId?: string) => {
    const { page, pageSize } = pageParams(q as any);
    const all = await loadSchemes(c.db, { status: ['published'], q: q.q?.trim() || undefined, category: q.category || undefined });
    if (q.q) await track(c.db, userId, 'search', { q: q.q.slice(0, 100), results: all.length });
    return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
  };
  r.get('/schemes', opt, ah(async (req, res) => res.json(await list(req.query as any, req.user?.id))));
  r.post('/schemes/search', opt, ah(async (req, res) => res.json(await list(z.object({ q: z.string().max(200).optional(), category: z.string().optional(), page: z.string().optional(), pageSize: z.string().optional() }).parse(req.body), req.user?.id))));
  r.get('/categories', ah(async (_req, res) => {
    res.json(await c.db.query("select category as name, count(*)::int as count from schemes where status='published' group by category order by category"));
  }));

  r.get('/schemes/:slug', opt, ah(async (req, res) => {
    const s = await getScheme(c.db, req.params.slug, ['published']);
    if (!s) throw new HttpError(404, 'not_found', 'We could not find that scheme.');
    await track(c.db, req.user?.id, 'view', { slug: s.slug });
    let evaluation = null; let held: Record<string, string> = {};
    if (req.user) {
      const p = await getUserProfile(c.db, req.user.id);
      const [rec] = recommendFrom([s], p, await getWeights(c.db));
      evaluation = rec;
      const docs = await c.db.query('select lower(doc_type) as t, status from user_documents where user_id=$1', [req.user.id]);
      held = Object.fromEntries(docs.map((d: any) => [d.t, d.status]));
    }
    const documents = s.documents.map((name) => ({ name, held: held[name.toLowerCase()] ?? null }));
    const readiness = documents.length ? Math.round((100 * documents.filter((d) => d.held).length) / documents.length) : 100;
    res.json({ scheme: s, evaluation, documents, readiness, note: 'Document status is self-declared or uploaded by you. It is never officially verified by SchemePulse.' });
  }));

  r.get('/compare', ah(async (req, res) => {
    const slugs = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 4);
    if (slugs.length < 2) throw new HttpError(400, 'validation_error', 'Choose at least two schemes to compare.');
    const all = (await loadSchemes(c.db, { status: ['published'] })).filter((s) => slugs.includes(s.slug));
    res.json({ items: all.map((s) => ({ slug: s.slug, name: s.name, benefit: s.benefitText, benefitValue: s.benefitValue, level: s.level === 'national' ? 'National' : s.states.join(', '), deadline: s.deadline, documents: s.documents.length, verified: !!s.verifiedAt })),
      note: 'Never assume schemes can be combined. Check scheme rules before combining benefits.' });
  }));

  r.post('/recommendations', opt, ah(async (req, res) => {
    const profile = await profileFor(req, req.body?.profile);
    const recs = await recommend(c.db, profile, req.user?.id);
    await track(c.db, req.user?.id, 'recommend', { matches: recs.filter((x) => x.status !== 'not_eligible').length });
    res.json({ profile, items: recs, summary: { eligible: recs.filter((x) => x.status === 'eligible').length, needsInfo: recs.filter((x) => x.status === 'needs_info').length, notEligible: recs.filter((x) => x.status === 'not_eligible').length, closingSoon: recs.filter((x) => x.status !== 'not_eligible' && x.daysLeft !== null && x.daysLeft >= 0 && x.daysLeft <= 30).length } });
  }));
  r.get('/recommendations', authenticate(c.cfg, true), ah(async (req, res) => {
    const recs = await recommend(c.db, await getUserProfile(c.db, req.user!.id), req.user!.id);
    res.json({ items: recs });
  }));
  r.post('/recommendations/:schemeId/feedback', authenticate(c.cfg, true), ah(async (req, res) => {
    const { schemeId, rating } = z.object({
      schemeId: z.string().uuid(),
      rating: z.enum(['helpful', 'not_helpful']),
    }).parse({ ...req.params, ...req.body });
    const [recommendation] = await c.db.query<{ components: unknown }>(
      'select components from recommendations where user_id=$1 and scheme_id=$2 order by created_at desc limit 1',
      [req.user!.id, schemeId],
    );
    if (!recommendation) throw new HttpError(404, 'not_found', 'Run Discover again before rating this recommendation.');
    await c.db.query(
      `insert into recommendation_feedback(user_id,scheme_id,rating,components) values($1,$2,$3,$4::jsonb)
       on conflict(user_id,scheme_id) do update set rating=excluded.rating, components=excluded.components, updated_at=now()`,
      [req.user!.id, schemeId, rating, JSON.stringify(recommendation.components)],
    );
    await track(c.db, req.user!.id, 'recommendation_feedback', { schemeId, rating });
    res.json({ schemeId, rating, learned: true });
  }));

  r.post('/eligibility/check', opt, ah(async (req, res) => {
    const { scheme: key } = z.object({ scheme: z.string() }).parse(req.body);
    const s = await getScheme(c.db, key, ['published']);
    if (!s) throw new HttpError(404, 'not_found', 'We could not find that scheme.');
    res.json(evaluate(s, await profileFor(req, req.body?.profile)));
  }));
  r.post('/eligibility/simulate', opt, ah(async (req, res) => {
    const changes = profileSchema.parse(req.body?.changes ?? {});
    const base = await profileFor(req, req.body?.profile);
    const schemes = await loadSchemes(c.db, { status: ['published'] });
    res.json({ simulated: true, note: 'Simulation only. Your saved profile is unchanged.', items: simulate(schemes, base, changes) });
  }));

  r.post('/ai/chat', opt, ah(async (req, res) => {
    const { message } = z.object({ message: z.string().min(2).max(500) }).parse(req.body);
    const recs = await recommend(c.db, await profileFor(req, req.body?.profile));
    const a = answer(message, recs);
    const text = await c.ai.polish(message, a.facts, a.text);
    await track(c.db, req.user?.id, 'chat', { intent: a.intent });
    res.json({ text, intent: a.intent, provider: c.ai.name, schemes: recs.filter((x) => a.schemeIds.includes(x.scheme.id)),
      disclaimer: 'Answers use stored scheme records and rule checks. Confirm details with the issuing department before applying.' });
  }));
  return r;
}
