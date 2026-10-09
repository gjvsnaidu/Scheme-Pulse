import type { Eligibility, Check, Profile, SchemeRecord } from './types';
import { daysLeft } from './eligibility';

export type Weights = Record<'eligibility' | 'need' | 'location' | 'benefit' | 'deadline' | 'preference', number>;
export const DEFAULT_WEIGHTS: Weights = { eligibility: 30, need: 25, location: 15, benefit: 15, deadline: 10, preference: 5 };
export type Components = Weights;

export function normalizeWeights(w: Weights): Weights {
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, (v / sum) * 100])) as Weights;
}

/** Each component is 0-100 and stored separately so every recommendation is explainable. */
export function score(
  scheme: SchemeRecord, profile: Profile, status: Eligibility, checks: Check[], weights: Weights = DEFAULT_WEIGHTS, now = new Date(),
) {
  const pass = checks.filter((c) => c.status === 'pass').length;
  const unknown = checks.filter((c) => c.status === 'unknown').length;
  const left = daysLeft(scheme.deadline, now);
  const occRule = scheme.rules.find((r) => r.field === 'occupation');
  const occFits = !occRule || (profile.occupation !== undefined && (occRule.value as string[]).includes(profile.occupation));
  const components: Components = {
    eligibility: status === 'not_eligible' ? 0 : checks.length ? Math.round((100 * (pass + unknown / 2)) / checks.length) : 100,
    need: scheme.goal && scheme.goal === profile.goal ? 100 : occFits ? 55 : 15,
    location: scheme.level === 'national' ? 100 : profile.state ? (scheme.states.includes(profile.state) ? 100 : 0) : 50,
    benefit: Math.round(40 + 60 * Math.min(1, Math.max(0, (Math.log10(Math.max(scheme.benefitValue, 1)) - 3) / 3))),
    deadline: left === null ? 80 : left < 0 ? 0 : left < 14 ? 70 : left < 45 ? 85 : 100,
    preference: scheme.goal && scheme.goal === profile.goal ? 100 : 50,
  };
  const w = normalizeWeights(weights);
  const total = Math.round((Object.keys(w) as (keyof Weights)[]).reduce((a, k) => a + components[k] * w[k], 0) / 100);
  return { total, components };
}

export const band = (n: number) => (n >= 80 ? 'Strong match' : n >= 60 ? 'Good match' : 'Possible match');
