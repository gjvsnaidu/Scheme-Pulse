import type { Db } from '../db';
import type { Rule, SchemeRecord } from '../engine/types';

const COLS = `s.id, s.slug, s.name, s.department, s.category, s.level, s.states, s.summary, s.benefit_text, s.benefit_value,
  s.goal, to_char(s.deadline,'YYYY-MM-DD') as deadline, s.source_url, s.status, s.is_demo, s.verified_at, s.version,
  s.source_key, s.source_updated_at, s.source_synced_at`;

const toRecord = (r: any, rules: Rule[], documents: string[]): SchemeRecord => ({
  id: r.id, slug: r.slug, name: r.name, department: r.department, category: r.category, level: r.level,
  states: r.states ?? [], summary: r.summary, benefitText: r.benefit_text, benefitValue: r.benefit_value,
  goal: r.goal, deadline: r.deadline, sourceUrl: r.source_url, status: r.status, isDemo: r.is_demo,
  verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null, version: r.version, rules, documents,
  sourceKey: r.source_key ?? null,
  sourceUpdatedAt: r.source_updated_at ? new Date(r.source_updated_at).toISOString() : null,
  sourceSyncedAt: r.source_synced_at ? new Date(r.source_synced_at).toISOString() : null,
});

export async function loadSchemes(db: Db, opts: { status?: string[]; ids?: string[]; q?: string; category?: string } = {}): Promise<SchemeRecord[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.status) { params.push(opts.status); where.push(`s.status = any($${params.length}::text[])`); }
  if (opts.ids) { params.push(opts.ids); where.push(`s.id = any($${params.length}::uuid[])`); }
  if (opts.category) { params.push(opts.category); where.push(`s.category = $${params.length}`); }
  let order = 's.name';
  if (opts.q) {
    params.push(opts.q);
    where.push(`s.search @@ websearch_to_tsquery('english', $${params.length})`);
    order = `ts_rank(s.search, websearch_to_tsquery('english', $${params.length})) desc, s.name`;
  }
  const rows = await db.query(`select ${COLS} from schemes s ${where.length ? 'where ' + where.join(' and ') : ''} order by ${order}`, params);
  if (!rows.length) return [];
  const ids = rows.map((r: any) => r.id);
  const [rules, docs] = await Promise.all([
    db.query('select scheme_id, field, op, value, label from eligibility_rules where scheme_id = any($1::uuid[])', [ids]),
    db.query('select scheme_id, name from scheme_documents where scheme_id = any($1::uuid[]) order by name', [ids]),
  ]);
  return rows.map((r: any) => toRecord(
    r,
    rules.filter((x: any) => x.scheme_id === r.id).map((x: any) => ({ field: x.field, op: x.op, value: x.value, label: x.label })),
    docs.filter((x: any) => x.scheme_id === r.id).map((x: any) => x.name),
  ));
}

export async function getScheme(db: Db, key: string, statuses?: string[]): Promise<SchemeRecord | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(key);
  const row = await db.query(`select s.id from schemes s where ${isUuid ? 's.id = $1::uuid' : 's.slug = $1'}`, [key]);
  if (!row[0]) return null;
  const [s] = await loadSchemes(db, { ids: [row[0].id], status: statuses });
  return s ?? null;
}

export interface SchemeInput {
  slug: string; name: string; department: string; category: string; level?: 'national' | 'state'; states?: string[];
  summary?: string; benefitText: string; benefitValue?: number; goal?: string | null; deadline?: string | null;
  sourceUrl?: string | null; isDemo?: boolean; rules: Rule[]; documents: string[];
}

/** Writes scheme + rules + documents and snapshots the result into scheme_versions. */
export async function saveScheme(db: Db, input: SchemeInput, opts: { id?: string; actorId?: string | null; status?: string } = {}): Promise<string> {
  return db.tx(async (t) => {
    let id = opts.id;
    const p = [input.slug, input.name, input.department, input.category, input.level ?? 'national', JSON.stringify(input.states ?? []),
      input.summary ?? '', input.benefitText, input.benefitValue ?? 0, input.goal ?? null, input.deadline ?? null, input.sourceUrl ?? null, input.isDemo ?? false];
    if (id) {
      await t.query(`update schemes set slug=$2,name=$3,department=$4,category=$5,level=$6,states=$7::jsonb,summary=$8,benefit_text=$9,benefit_value=$10,
        goal=$11,deadline=$12,source_url=$13,is_demo=$14,version=version+1,updated_at=now(),
        status=case when status='published' then 'pending_review' else status end, verified_at=null where id=$1`, [id, ...p]);
      await t.query('delete from eligibility_rules where scheme_id=$1', [id]);
      await t.query('delete from scheme_documents where scheme_id=$1', [id]);
    } else {
      const r = await t.query(`insert into schemes(slug,name,department,category,level,states,summary,benefit_text,benefit_value,goal,deadline,source_url,is_demo,status)
        values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14) returning id`, [...p, opts.status ?? 'draft']);
      id = r[0].id as string;
    }
    for (const r of input.rules)
      await t.query('insert into eligibility_rules(scheme_id,field,op,value,label) values($1,$2,$3,$4::jsonb,$5)', [id, r.field, r.op, JSON.stringify(r.value), r.label]);
    for (const d of input.documents) await t.query('insert into scheme_documents(scheme_id,name) values($1,$2)', [id, d]);
    const v = await t.query('select version from schemes where id=$1', [id]);
    await t.query('insert into scheme_versions(scheme_id,version,snapshot,changed_by) values($1,$2,$3::jsonb,$4)', [id, v[0].version, JSON.stringify(input), opts.actorId ?? null]);
    return id as string;
  });
}
