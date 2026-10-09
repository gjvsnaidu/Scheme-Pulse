import type { Db } from '../db';
import { evaluate, daysLeft } from '../engine/eligibility';
import { score, band, DEFAULT_WEIGHTS, type Weights } from '../engine/scoring';
import type { Profile, SchemeRecord, Check, Eligibility } from '../engine/types';
import { loadSchemes } from './schemes';

export interface Recommendation {
  scheme: SchemeRecord; status: Eligibility; checks: Check[];
  score: { total: number; band: string; components: Weights }; daysLeft: number | null; reasons: string[];
  feedback?: 'helpful' | 'not_helpful' | null;
}

type FeedbackExample = { rating: 'helpful' | 'not_helpful'; components: Weights };

export function learnWeights(base: Weights, examples: FeedbackExample[]): Weights {
  if (examples.length < 3 || new Set(examples.map((x) => x.rating)).size < 2) return base;
  const keys = Object.keys(base) as (keyof Weights)[];
  const coefficients = Object.fromEntries(keys.map((key) => [key, 0])) as Weights;
  for (let epoch = 0; epoch < 100; epoch++) {
    for (const example of examples) {
      const features = Object.fromEntries(keys.map((key) => [key, example.components[key] / 100])) as Weights;
      const logit = keys.reduce((sum, key) => sum + coefficients[key] * features[key], 0);
      const prediction = 1 / (1 + Math.exp(-Math.max(-12, Math.min(12, logit))));
      const target = example.rating === 'helpful' ? 1 : 0;
      for (const key of keys) coefficients[key] += 0.2 * ((target - prediction) * features[key] - 0.02 * coefficients[key]);
    }
  }
  const adjusted = Object.fromEntries(keys.map((key) => [key, base[key] * Math.exp(Math.max(-1, Math.min(1, coefficients[key])))])) as Weights;
  return Object.values(adjusted).every(Number.isFinite) ? adjusted : base;
}

export async function getWeights(db: Db): Promise<Weights> {
  const r = await db.query("select value from settings where key='weights'");
  return r[0] ? (r[0].value as Weights) : DEFAULT_WEIGHTS;
}

export function recommendFrom(schemes: SchemeRecord[], profile: Profile, weights: Weights, now = new Date()): Recommendation[] {
  return schemes.map((scheme) => {
    const { status, checks } = evaluate(scheme, profile, now);
    const s = score(scheme, profile, status, checks, weights, now);
    const reasons = checks.filter((c) => c.status === 'pass').map((c) => `${c.label}: ${c.detail}`);
    if (scheme.goal && scheme.goal === profile.goal) reasons.push(`Supports your goal: ${profile.goal}`);
    return { scheme, status, checks, score: { total: s.total, band: band(s.total), components: s.components }, daysLeft: daysLeft(scheme.deadline, now), reasons };
  }).sort((a, b) => (a.status === 'not_eligible' ? 1 : 0) - (b.status === 'not_eligible' ? 1 : 0) || b.score.total - a.score.total);
}

export async function recommend(db: Db, profile: Profile, userId?: string, now = new Date()) {
  const [schemes, weights, feedbackRows] = await Promise.all([
    loadSchemes(db, { status: ['published'] }),
    getWeights(db),
    userId ? db.query<FeedbackExample>('select rating, components from recommendation_feedback where user_id=$1', [userId]) : Promise.resolve([]),
  ]);
  const personalWeights = learnWeights(weights, feedbackRows);
  const recs = recommendFrom(schemes, profile, personalWeights, now);
  const feedbackByScheme = new Map((userId ? await db.query<{ scheme_id: string; rating: FeedbackExample['rating'] }>(
    'select scheme_id, rating from recommendation_feedback where user_id=$1', [userId],
  ) : []).map((row) => [row.scheme_id, row.rating]));
  for (const rec of recs) rec.feedback = feedbackByScheme.get(rec.scheme.id) ?? null;
  if (userId) {
    await db.tx(async (t) => {
      await t.query('delete from recommendations where user_id=$1', [userId]);
      for (const r of recs.filter((x) => x.status !== 'not_eligible'))
        await t.query('insert into recommendations(user_id,scheme_id,total,components,status) values($1,$2,$3,$4::jsonb,$5)',
          [userId, r.scheme.id, r.score.total, JSON.stringify(r.score.components), r.status]);
    });
  }
  return recs;
}

export function simulate(schemes: SchemeRecord[], base: Profile, changes: Profile, now = new Date()) {
  const next = { ...base, ...changes };
  const w = DEFAULT_WEIGHTS;
  const a = recommendFrom(schemes, base, w, now);
  const b = recommendFrom(schemes, next, w, now);
  return b.map((r) => {
    const before = a.find((x) => x.scheme.id === r.scheme.id)!;
    const changed = before.status !== r.status;
    const failing = r.checks.find((c) => c.status === 'fail');
    const why = !changed ? 'No change'
      : r.status === 'not_eligible' && failing ? `${failing.label}: ${failing.detail}`
      : `Now meets: ${before.checks.filter((c) => c.status !== 'pass').map((c) => c.label.toLowerCase()).join(', ')}`;
    return { schemeId: r.scheme.id, slug: r.scheme.slug, name: r.scheme.name, before: before.status, after: r.status, changed, why };
  });
}
