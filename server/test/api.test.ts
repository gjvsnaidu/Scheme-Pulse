import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from '../src/config';
import { connect, migrate, type Db } from '../src/db';
import { seed } from '../src/seed';
import { createApp } from '../src/app';
import { rulesProvider } from '../src/ai/provider';
import { createStorage } from '../src/services/storage';
import { runDeadlineJob } from '../src/services/jobs';
import type { Config } from '../src/config';

let app: Express; let db: Db; let admin = ''; let user = '';
let cfg: Config;
const sent: string[] = [];
const student = { age: 21, income: 250000, state: 'Andhra Pradesh', occupation: 'student', goal: 'education' };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  cfg = loadConfig({ NODE_ENV: 'test', PGLITE_DIR: 'memory://', RATE_LIMIT_DISABLED: 'true', SEED_DEMO: 'true', OFFICIAL_SCHEME_FEEDS: JSON.stringify([{ key: 'test-ministry', name: 'Test Ministry', url: 'https://schemes.gov.in/feed.json' }]), ADMIN_EMAIL: 'admin@test.dev', ADMIN_PASSWORD: 'admin-pass-123', UPLOAD_DIR: './.data/test-uploads' } as any);
  db = await connect(cfg); await migrate(db); await seed(db, cfg);
  app = createApp({ db, cfg, ai: rulesProvider, mail: async (to, s) => { sent.push(`${to}:${s}`); }, storage: createStorage(cfg) });
  admin = (await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'admin-pass-123' })).body.accessToken;
  user = (await request(app).post('/api/auth/register').send({ email: 'Naidu@Test.dev', password: 'correct-horse-1' })).body.accessToken;
});
afterAll(async () => { await db.close(); });

describe('auth', () => {
  it('rejects duplicate email, weak password and bad credentials', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'naidu@test.dev', password: 'correct-horse-1' })).status).toBe(409);
    expect((await request(app).post('/api/auth/register').send({ email: 'x@y.dev', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: 'naidu@test.dev', password: 'wrong-password' })).status).toBe(401);
  });
  it('requires a token and rotates refresh tokens', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(auth(user))).body.user.email).toBe('naidu@test.dev');
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'naidu@test.dev', password: 'correct-horse-1' });
    expect((await agent.post('/api/auth/refresh')).status).toBe(200);
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('recommendations and eligibility', () => {
  it('publishes curated myScheme records with official links and unresolved criteria marked as unknown', async () => {
    const catalog = await request(app).get('/api/schemes');
    const official = catalog.body.items.filter((item: any) => item.sourceUrl && !item.isDemo);
    expect(official).toHaveLength(9);
    expect(official.every((item: any) => item.isDemo === false)).toBe(true);
    const results = await request(app).post('/api/recommendations').send({ profile: student });
    const sourcedResults = results.body.items.filter((item: any) => item.scheme.sourceUrl?.startsWith('https://www.myscheme.gov.in/schemes/'));
    expect(sourcedResults.every((item: any) => item.status === 'needs_info')).toBe(true);
    expect(sourcedResults.every((item: any) => item.checks.some((check: any) => check.status === 'unknown'))).toBe(true);
  });
  it('ranks matches for a guest, hides nothing silently and explains every result', async () => {
    const r = await request(app).post('/api/recommendations').send({ profile: student });
    expect(r.status).toBe(200);
    const top = r.body.items[0];
        expect(top.status).toBe('eligible');
    expect(top.reasons.length).toBeGreaterThan(0);
    expect(Object.keys(top.score.components)).toEqual(['eligibility', 'need', 'location', 'benefit', 'deadline', 'preference']);
    const kisan = r.body.items.find((i: any) => i.scheme.slug === 'kisan-income-support');
    expect(kisan.status).toBe('not_eligible');
    expect(r.body.summary.eligible).toBeGreaterThan(0);
  });
  it('rejects invalid profile input', async () => {
    const r = await request(app).post('/api/recommendations').send({ profile: { age: -3, income: 'lots' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
  });
  it('stores signed-in recommendation feedback and returns it with later results', async () => {
    await request(app).put('/api/profiles/me').set(auth(user)).send(student);
    const run = await request(app).post('/api/recommendations').set(auth(user)).send({ profile: student });
    const schemeId = run.body.items.find((item: any) => item.status !== 'not_eligible').scheme.id;
    expect((await request(app).post(`/api/recommendations/${schemeId}/feedback`).send({ rating: 'helpful' })).status).toBe(401);
    const feedback = await request(app).post(`/api/recommendations/${schemeId}/feedback`).set(auth(user)).send({ rating: 'helpful' });
    expect(feedback.status).toBe(200);
    expect(feedback.body).toMatchObject({ schemeId, rating: 'helpful', learned: true });
    const later = await request(app).get('/api/recommendations').set(auth(user));
    expect(later.body.items.find((item: any) => item.scheme.id === schemeId).feedback).toBe('helpful');
    expect((await db.query('select 1 from recommendation_feedback where user_id=(select id from users where email=$1)', ['naidu@test.dev']))).toHaveLength(1);
  });
  it('simulates changes without altering the stored profile', async () => {
    await request(app).put('/api/profiles/me').set(auth(user)).send(student);
    const r = await request(app).post('/api/eligibility/simulate').set(auth(user)).send({ changes: { income: 900000 } });
    expect(r.body.simulated).toBe(true);
    expect(r.body.items.find((i: any) => i.slug === 'national-merit-scholarship')).toMatchObject({ before: 'eligible', after: 'not_eligible', changed: true });
    expect((await request(app).get('/api/profiles/me').set(auth(user))).body.profile.income).toBe(250000);
  });
  it('parses natural language without saving anything', async () => {
    const r = await request(app).post('/api/profiles/parse').send({ text: "I'm a 29 year old farmer in Telangana earning 1.5 lakh" });
    expect(r.body.profile).toMatchObject({ occupation: 'farmer', state: 'Telangana', income: 150000 });
  });
});

describe('assistant', () => {
  it('answers from stored records and returns scheme cards', async () => {
    const r = await request(app).post('/api/ai/chat').send({ message: 'Which schemes can I apply for?', profile: student });
    expect(r.body.intent).toBe('apply');
    expect(r.body.schemes.length).toBeGreaterThan(0);
    expect(r.body.text).toContain('Confirm current eligibility');
  });
  it('explains why a scheme does not fit', async () => {
    const r = await request(app).post('/api/ai/chat').send({ message: 'Why am I not eligible for the Kisan Income Support Programme?', profile: student });
    expect(r.body.intent).toBe('why_not');
    expect(r.body.text).toContain('Who it is for');
  });
});

describe('saved, documents, applications, notifications', () => {
  let schemeId = '';
  it('saves and unsaves schemes; anonymous users cannot', async () => {
    schemeId = (await request(app).get('/api/schemes/youth-skill-stipend')).body.scheme.id;
    expect((await request(app).post('/api/saved-schemes').send({ schemeId })).status).toBe(401);
    expect((await request(app).post('/api/saved-schemes').set(auth(user)).send({ schemeId })).status).toBe(201);
    expect((await request(app).get('/api/saved-schemes').set(auth(user))).body.items).toHaveLength(1);
  });
  it('computes document readiness from self-declared documents, never "verified"', async () => {
    await request(app).post('/api/documents/declare').set(auth(user)).send({ docType: 'Aadhaar' });
    const r = await request(app).get('/api/schemes/youth-skill-stipend').set(auth(user));
    expect(r.body.readiness).toBe(33);
    expect(r.body.documents[0].held).toBe('self_declared');
  });
  it('rejects wrong file types and spoofed content', async () => {
    const bad = await request(app).post('/api/documents/upload').set(auth(user)).field('docType', 'Income certificate').attach('file', Buffer.from('hello'), { filename: 'a.exe', contentType: 'application/x-msdownload' });
    expect(bad.status).toBe(415);
    const spoof = await request(app).post('/api/documents/upload').set(auth(user)).field('docType', 'Income certificate').attach('file', Buffer.from('not a pdf'), { filename: 'a.pdf', contentType: 'application/pdf' });
    expect(spoof.status).toBe(415);
    const ok = await request(app).post('/api/documents/upload').set(auth(user)).field('docType', 'Income certificate').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'income.pdf', contentType: 'application/pdf' });
    expect(ok.status).toBe(201);
    expect(ok.body.document.status).toBe('uploaded');
  });
  it('tracks applications as a personal record', async () => {
    const a = await request(app).post('/api/applications').set(auth(user)).send({ schemeId });
    expect(a.body.note).toContain('personal tracking record');
    await request(app).patch(`/api/applications/${a.body.application.id}`).set(auth(user)).send({ status: 'submitted' });
    const d = await request(app).get(`/api/applications/${a.body.application.id}`).set(auth(user));
    expect(d.body.events.map((e: any) => e.status)).toEqual(['discovered', 'submitted']);
  });
  it('creates deadline notifications once, even if the job runs twice', async () => {
    const one = await runDeadlineJob(db, async (to, s) => { sent.push(`${to}:${s}`); }, 30);
    const two = await runDeadlineJob(db, async () => undefined, 30);
    expect(one.created).toBe(1);
    expect(two.created).toBe(0);
    const n = await request(app).get('/api/notifications').set(auth(user));
    expect(n.body.unread).toBe(1);
    expect(sent.some((s) => s.includes('naidu@test.dev'))).toBe(true);
  });
});

describe('admin', () => {
  const draft = { slug: 'women-entrepreneur-fund', name: 'Women Entrepreneur Fund', department: 'Ministry of MSME', category: 'Business', benefitText: 'Grant up to ₹2 lakh', benefitValue: 200000, goal: 'business', rules: [{ field: 'gender', op: 'eq', value: 'female', label: 'Gender' }], documents: ['Aadhaar'], isDemo: true };
  it('syncs official feed records idempotently and sends changed published records back to review', async () => {
    const feedItem: any = {
      externalId: 'ministry-student-aid-2026', updatedAt: '2026-10-01T00:00:00Z', sourceUrl: 'https://schemes.gov.in/student-aid',
      scheme: { slug: 'official-student-aid', name: 'Official Student Aid', department: 'Ministry of Education', category: 'Education', summary: 'Student support.', benefitText: 'Up to ₹10,000', benefitValue: 10000, goal: 'education', rules: [{ field: 'age', op: 'gte', value: 18, label: 'Age' }], documents: [] },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [feedItem] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const first = await request(app).post('/api/admin/sources/sync').set(auth(admin)).send({ key: 'test-ministry' });
      expect(first.body.results[0]).toMatchObject({ status: 'succeeded', created: 1, rejected: 0 });
      const [stored] = await db.query<{ id: string; status: string }>("select id,status from schemes where source_key='test-ministry' and source_record_id='ministry-student-aid-2026'");
      expect(stored.status).toBe('draft');
      expect((await request(app).get('/api/schemes/official-student-aid')).status).toBe(404);

      const second = await request(app).post('/api/admin/sources/sync').set(auth(admin)).send({ key: 'test-ministry' });
      expect(second.body.results[0].unchanged).toBe(1);
      await request(app).post(`/api/admin/schemes/${stored.id}/review`).set(auth(admin)).send({ decision: 'published' });
      feedItem.scheme.summary = 'Updated student support.';
      feedItem.updatedAt = '2026-10-08T00:00:00Z';
      const third = await request(app).post('/api/admin/sources/sync').set(auth(admin)).send({ key: 'test-ministry' });
      expect(third.body.results[0].updated).toBe(1);
      expect((await db.query('select status from schemes where id=$1', [stored.id]))[0].status).toBe('pending_review');
      expect((await request(app).get('/api/admin/sources').set(auth(admin))).body.runs.length).toBeGreaterThanOrEqual(3);
    } finally { vi.unstubAllGlobals(); }
  });
  it('disables demo seeding by default and rejects non-government feed hosts', () => {
    expect(loadConfig({}).SEED_DEMO).toBe(false);
    expect(() => loadConfig({ OFFICIAL_SCHEME_FEEDS: '[{"key":"bad-feed","name":"Bad feed","url":"https://example.com/feed"}]' })).toThrow();
  });
  it('blocks non-admins', async () => {
    expect((await request(app).get('/api/admin/analytics').set(auth(user))).status).toBe(403);
    expect((await request(app).get('/api/admin/analytics')).status).toBe(401);
  });
  it('keeps drafts private until reviewed and published, with version history', async () => {
    const c = await request(app).post('/api/admin/schemes').set(auth(admin)).send(draft);
    expect(c.status).toBe(201);
    expect((await request(app).get('/api/schemes/women-entrepreneur-fund')).status).toBe(404);
    expect((await request(app).post(`/api/admin/schemes/${c.body.id}/review`).set(auth(admin)).send({ decision: 'verified' })).status).toBe(422); // no source URL
    expect((await request(app).post(`/api/admin/schemes/${c.body.id}/review`).set(auth(admin)).send({ decision: 'published' })).status).toBe(200);
    expect((await request(app).get('/api/schemes/women-entrepreneur-fund')).status).toBe(200);
    await request(app).put(`/api/admin/schemes/${c.body.id}`).set(auth(admin)).send({ ...draft, benefitText: 'Grant up to ₹3 lakh' });
    expect((await request(app).get('/api/schemes/women-entrepreneur-fund')).status).toBe(404); // back in review
    const v = await request(app).get(`/api/admin/schemes/${c.body.id}/versions`).set(auth(admin));
    expect(v.body.items.map((x: any) => x.version)).toEqual([2, 1]);
  });
  it('validates rules, ingests as drafts only, and reports duplicates', async () => {
    expect((await request(app).post('/api/admin/schemes').set(auth(admin)).send({ ...draft, slug: 'bad-rule-scheme', rules: [{ field: 'age', op: 'between', value: 'x', label: 'Age' }] })).status).toBe(400);
    const r = await request(app).post('/api/admin/ingest').set(auth(admin)).send({ items: [draft, { ...draft, slug: 'new-import-scheme', name: 'Imported Scheme' }, { nope: true }] });
    expect(r.body).toMatchObject({ created: 1, duplicates: ['women-entrepreneur-fund'] });
    expect(r.body.invalid).toHaveLength(1);
  });
  it('lets admins change weights and records analytics and audit logs', async () => {
    expect((await request(app).put('/api/admin/weights').set(auth(admin)).send({ eligibility: 50, need: 10, location: 10, benefit: 10, deadline: 10, preference: 10 })).status).toBe(200);
    const a = await request(app).get('/api/admin/analytics').set(auth(admin));
    expect(a.body.counts.published).toBeGreaterThanOrEqual(9);
    expect(a.body.mostSaved[0].name).toBe('Youth Skill Training Stipend');
    expect((await request(app).get('/api/admin/audit').set(auth(admin))).body.items.length).toBeGreaterThan(3);
  });
});

describe('privacy', () => {
  it('exports and deletes all user data', async () => {
    const ex = await request(app).get('/api/privacy/export').set(auth(user));
    expect(ex.body.profile.income).toBe(250000);
    expect(ex.body.recommendationFeedback).toHaveLength(1);
    expect((await request(app).delete('/api/privacy/account').set(auth(user))).status).toBe(204);
    expect((await db.query("select 1 from users where email='naidu@test.dev'")).length).toBe(0);
    expect((await db.query('select 1 from profiles')).length).toBe(0);
  });
  it('returns consistent errors for unknown routes and bad JSON', async () => {
    expect((await request(app).get('/api/nope')).body.error.code).toBe('not_found');
    expect((await request(app).post('/api/recommendations').set('content-type', 'application/json').send('{bad')).body.error.code).toBe('bad_json');
  });
});
