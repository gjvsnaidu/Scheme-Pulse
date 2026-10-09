import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { z } from 'zod';
import { HttpError, authenticate } from '../auth';
import { audit } from '../services/audit';
import { getScheme, loadSchemes } from '../services/schemes';
import { ah, getUserProfile, profileSchema, rowToProfile, type Ctx } from './common';

const MAGIC: Record<string, number[]> = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] };
const STATUSES = ['discovered', 'eligibility_checked', 'documents_ready', 'started', 'submitted', 'under_review', 'approved', 'rejected'] as const;
const docType = z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N} .'-]+$/u, 'Use letters and numbers only');

export function userRouter(c: Ctx) {
  const r = Router();
  r.use(['/profiles', '/saved-schemes', '/applications', '/documents', '/notifications', '/privacy'], authenticate(c.cfg, true));
  const uid = (req: any) => req.user.id as string;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (_q, f, cb) => (MAGIC[f.mimetype] ? cb(null, true) : cb(new HttpError(415, 'bad_file_type', 'Upload a PDF, PNG or JPEG file.') as any)) });

  /* Profile: saved only when the user confirms it */
  r.get('/profiles/me', ah(async (req, res) => res.json({ profile: await getUserProfile(c.db, uid(req)) })));
  const putProfile = ah(async (req, res) => {
    const p = profileSchema.parse(req.body);
    await c.db.query(`insert into profiles(user_id,age,occupation,state,income,goal,gender,category) values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict(user_id) do update set age=$2,occupation=$3,state=$4,income=$5,goal=$6,gender=$7,category=$8,updated_at=now()`,
      [uid(req), p.age ?? null, p.occupation ?? null, p.state ?? null, p.income ?? null, p.goal ?? null, p.gender ?? null, p.category ?? null]);
    res.json({ profile: p });
  });
  r.put('/profiles/me', putProfile);
  r.post('/profiles', putProfile);
  r.patch('/profiles/me', ah(async (req, res) => {
    const merged = { ...(await getUserProfile(c.db, uid(req))), ...profileSchema.partial().parse(req.body) };
    req.body = merged; await putProfile(req, res, () => undefined);
  }));

  /* Saved schemes */
  r.get('/saved-schemes', ah(async (req, res) => {
    const rows = await c.db.query(`select sv.scheme_id, sv.created_at from saved_schemes sv join schemes s on s.id=sv.scheme_id
      where sv.user_id=$1 and s.status='published' order by sv.created_at desc`, [uid(req)]);
    const schemes = rows.length ? await loadSchemes(c.db, { ids: rows.map((x: any) => x.scheme_id), status: ['published'] }) : [];
    res.json({ items: rows.map((x: any) => ({ savedAt: x.created_at, scheme: schemes.find((s) => s.id === x.scheme_id) })).filter((x: any) => x.scheme) });
  }));
  r.post('/saved-schemes', ah(async (req, res) => {
    const { schemeId } = z.object({ schemeId: z.string() }).parse(req.body);
    const s = await getScheme(c.db, schemeId, ['published']);
    if (!s) throw new HttpError(404, 'not_found', 'We could not find that scheme.');
    await c.db.query('insert into saved_schemes(user_id,scheme_id) values($1,$2) on conflict do nothing', [uid(req), s.id]);
    res.status(201).json({ saved: true, schemeId: s.id });
  }));
  r.delete('/saved-schemes/:id', ah(async (req, res) => {
    await c.db.query('delete from saved_schemes where user_id=$1 and scheme_id=$2::uuid', [uid(req), req.params.id]);
    res.status(204).end();
  }));

  /* Applications: a personal tracking record. SchemePulse has no official integration with application authorities. */
  const TRACKING_NOTE = 'This is your personal tracking record. SchemePulse is not connected to any application authority and cannot see your official status.';
  r.get('/applications', ah(async (req, res) => {
    const items = await c.db.query(`select a.id, a.status, a.notes, a.updated_at, s.slug, s.name from applications a join schemes s on s.id=a.scheme_id where a.user_id=$1 order by a.updated_at desc`, [uid(req)]);
    res.json({ items, note: TRACKING_NOTE });
  }));
  r.post('/applications', ah(async (req, res) => {
    const { schemeId } = z.object({ schemeId: z.string() }).parse(req.body);
    const s = await getScheme(c.db, schemeId, ['published']);
    if (!s) throw new HttpError(404, 'not_found', 'We could not find that scheme.');
    const [a] = await c.db.query(`insert into applications(user_id,scheme_id) values($1,$2) on conflict(user_id,scheme_id) do update set updated_at=now() returning id,status`, [uid(req), s.id]);
    await c.db.query('insert into application_events(application_id,status) select $1,$2 where not exists (select 1 from application_events where application_id=$1)', [a.id, a.status]);
    res.status(201).json({ application: a, note: TRACKING_NOTE });
  }));
  r.get('/applications/:id', ah(async (req, res) => {
    const [a] = await c.db.query('select a.id,a.status,a.notes,s.name,s.slug from applications a join schemes s on s.id=a.scheme_id where a.id=$1::uuid and a.user_id=$2', [req.params.id, uid(req)]);
    if (!a) throw new HttpError(404, 'not_found', 'Application not found.');
    res.json({ application: a, events: await c.db.query('select status, created_at from application_events where application_id=$1::uuid order by created_at', [a.id]), note: TRACKING_NOTE });
  }));
  r.patch('/applications/:id', ah(async (req, res) => {
    const b = z.object({ status: z.enum(STATUSES).optional(), notes: z.string().max(1000).optional() }).parse(req.body);
    const [a] = await c.db.query('update applications set status=coalesce($3,status), notes=coalesce($4,notes), updated_at=now() where id=$1::uuid and user_id=$2 returning id,status,notes', [req.params.id, uid(req), b.status ?? null, b.notes ?? null]);
    if (!a) throw new HttpError(404, 'not_found', 'Application not found.');
    if (b.status) await c.db.query('insert into application_events(application_id,status) values($1,$2)', [a.id, b.status]);
    res.json({ application: a });
  }));

  /* Documents: AI/OCR is not used. Status is only ever self_declared or uploaded, never "verified". */
  r.get('/documents', ah(async (req, res) => res.json({ items: await c.db.query('select id,doc_type,filename,mime,size,status,created_at from user_documents where user_id=$1 order by doc_type', [uid(req)]),
    note: 'Documents are stored for your convenience. They are not officially verified.' })));
  r.post('/documents/declare', ah(async (req, res) => {
    const t = docType.parse(req.body?.docType);
    await c.db.query(`insert into user_documents(user_id,doc_type) values($1,$2) on conflict(user_id,doc_type) do nothing`, [uid(req), t]);
    res.status(201).json({ docType: t, status: 'self_declared' });
  }));
  r.post('/documents/upload', upload.single('file'), ah(async (req, res) => {
    const f = req.file; if (!f) throw new HttpError(400, 'validation_error', 'Choose a file to upload.');
    const t = docType.parse(req.body?.docType);
    const magic = MAGIC[f.mimetype];
    if (!magic.every((b, i) => f.buffer[i] === b)) throw new HttpError(415, 'bad_file_type', 'The file content does not match its type.');
    const key = `${uid(req)}/${crypto.randomUUID()}`;
    const old = await c.db.query('select storage_key from user_documents where user_id=$1 and doc_type=$2', [uid(req), t]);
    await c.storage.put(key, f.buffer, f.mimetype);
    const [d] = await c.db.query(`insert into user_documents(user_id,doc_type,filename,mime,size,storage_key,status) values($1,$2,$3,$4,$5,$6,'uploaded')
      on conflict(user_id,doc_type) do update set filename=$3,mime=$4,size=$5,storage_key=$6,status='uploaded' returning id,doc_type,status`, [uid(req), t, f.originalname.slice(0, 120), f.mimetype, f.size, key]);
    if (old[0]?.storage_key) await c.storage.remove(old[0].storage_key);
    res.status(201).json({ document: d });
  }));
  r.get('/documents/:id/file', ah(async (req, res) => {
    const [d] = await c.db.query('select storage_key,mime from user_documents where id=$1::uuid and user_id=$2', [req.params.id, uid(req)]);
    if (!d?.storage_key) throw new HttpError(404, 'not_found', 'File not found.');
    res.setHeader('content-type', d.mime).setHeader('content-disposition', 'attachment').send(await c.storage.get(d.storage_key));
  }));
  r.delete('/documents/:id', ah(async (req, res) => {
    const [d] = await c.db.query('delete from user_documents where id=$1::uuid and user_id=$2 returning storage_key', [req.params.id, uid(req)]);
    if (d?.storage_key) await c.storage.remove(d.storage_key);
    res.status(204).end();
  }));

  /* Notifications */
  r.get('/notifications', ah(async (req, res) => {
    const items = await c.db.query('select id,kind,title,body,read_at,created_at,scheme_id from notifications where user_id=$1 order by created_at desc limit 50', [uid(req)]);
    res.json({ items, unread: items.filter((n: any) => !n.read_at).length });
  }));
  r.post('/notifications/read-all', ah(async (req, res) => { await c.db.query('update notifications set read_at=now() where user_id=$1 and read_at is null', [uid(req)]); res.status(204).end(); }));
  r.post('/notifications/:id/read', ah(async (req, res) => { await c.db.query('update notifications set read_at=now() where id=$1::uuid and user_id=$2', [req.params.id, uid(req)]); res.status(204).end(); }));

  /* Privacy center */
  r.get('/privacy/export', ah(async (req, res) => {
    const u = uid(req);
    const q = (sql: string) => c.db.query(sql, [u]);
    res.setHeader('content-disposition', 'attachment; filename="schemepulse-data.json"').json({
      exportedAt: new Date().toISOString(),
      account: (await q('select id,email,name,language,created_at from users where id=$1'))[0],
      profile: (await q('select * from profiles where user_id=$1'))[0] ?? null,
      savedSchemes: await q('select scheme_id,created_at from saved_schemes where user_id=$1'),
      recommendationFeedback: await q('select scheme_id,rating,components,updated_at from recommendation_feedback where user_id=$1'),
      applications: await q('select scheme_id,status,notes,created_at from applications where user_id=$1'),
      documents: await q('select doc_type,filename,status,created_at from user_documents where user_id=$1'),
      notifications: await q('select kind,title,created_at from notifications where user_id=$1'),
    });
  }));
  r.delete('/privacy/account', ah(async (req, res) => {
    const docs = await c.db.query('select storage_key from user_documents where user_id=$1 and storage_key is not null', [uid(req)]);
    for (const d of docs) await c.storage.remove(d.storage_key);
    await audit(c.db, null, 'account_deleted', 'user', uid(req)); // actor omitted: the user row is being removed
    await c.db.query('delete from users where id=$1', [uid(req)]);
    res.clearCookie('sp_refresh', { path: '/api/auth' }).status(204).end();
  }));
  void rowToProfile;
  return r;
}
