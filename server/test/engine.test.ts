import { describe, expect, it } from 'vitest';
import { evaluate, daysLeft } from '../src/engine/eligibility';
import { score, DEFAULT_WEIGHTS } from '../src/engine/scoring';
import { extractProfile } from '../src/engine/parser';
import { DEMO_SCHEMES } from '../src/seed';
import { learnWeights } from '../src/services/recommend';
import type { SchemeRecord } from '../src/engine/types';

const mk = (slug: string): SchemeRecord => {
  const s = DEMO_SCHEMES().find((x) => x.slug === slug)!;
  return { id: slug, slug, name: s.name, department: s.department, category: s.category, level: s.level ?? 'national', states: s.states ?? [], summary: '', benefitText: s.benefitText, benefitValue: s.benefitValue ?? 0, goal: s.goal ?? null, deadline: s.deadline ?? null, sourceUrl: null, status: 'published', isDemo: true, verifiedAt: null, version: 1, rules: s.rules, documents: s.documents };
};
const merit = mk('national-merit-scholarship');

describe('eligibility engine', () => {
  it('marks a fitting profile eligible', () => {
    const r = evaluate(merit, { age: 21, income: 250000, occupation: 'student' });
    expect(r.status).toBe('eligible');
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });
  it('fails when income exceeds the limit and explains why', () => {
    const r = evaluate(merit, { age: 21, income: 500000, occupation: 'student' });
    expect(r.status).toBe('not_eligible');
    expect(r.checks.find((c) => c.status === 'fail')?.detail).toContain('₹5 lakh');
  });
  it('asks for information instead of guessing when data is missing', () => {
    const r = evaluate(merit, { age: 21 });
    expect(r.status).toBe('needs_info');
    expect(r.checks.filter((c) => c.status === 'unknown')).toHaveLength(2);
  });
  it('treats an expired deadline as not eligible', () => {
    const r = evaluate({ ...merit, deadline: '2020-01-01' }, { age: 21, income: 1, occupation: 'student' });
    expect(r.status).toBe('not_eligible');
    expect(daysLeft('2020-01-01')).toBeLessThan(0);
  });
  it('enforces state-specific schemes', () => {
    const s = mk('fee-reimbursement-professional-courses');
    expect(evaluate(s, { age: 21, income: 200000, occupation: 'student', state: 'Kerala' }).status).toBe('not_eligible');
    expect(evaluate(s, { age: 21, income: 200000, occupation: 'student', state: 'Telangana' }).status).toBe('eligible');
  });
});

describe('scoring', () => {
  const p = { age: 21, income: 250000, occupation: 'student', goal: 'education' };
  it('scores an eligible, on-goal scheme high and keeps components separate', () => {
    const { status, checks } = evaluate(merit, p);
    const s = score(merit, p, status, checks, DEFAULT_WEIGHTS);
    expect(s.total).toBeGreaterThanOrEqual(85);
    expect(s.components.eligibility).toBe(100);
    expect(s.components.need).toBe(100);
  });
  it('gives zero eligibility score to ineligible schemes', () => {
    const q = { ...p, income: 900000 };
    const { status, checks } = evaluate(merit, q);
    expect(score(merit, q, status, checks).components.eligibility).toBe(0);
  });
  it('respects configurable weights', () => {
    const { status, checks } = evaluate(merit, p);
    const a = score(merit, p, status, checks, { ...DEFAULT_WEIGHTS, benefit: 0 }).total;
    const b = score(merit, p, status, checks, { ...DEFAULT_WEIGHTS, benefit: 100 }).total;
    expect(a).not.toBe(b);
  });
});

describe('personalized ranking', () => {
  it('learns from mixed explicit feedback and waits for both outcomes', () => {
    const helpful = { eligibility: 100, need: 100, location: 100, benefit: 30, deadline: 70, preference: 100 };
    const notHelpful = { eligibility: 100, need: 20, location: 20, benefit: 100, deadline: 30, preference: 20 };
    expect(learnWeights(DEFAULT_WEIGHTS, [
      { rating: 'helpful', components: helpful },
      { rating: 'helpful', components: helpful },
    ])).toEqual(DEFAULT_WEIGHTS);
    expect(learnWeights(DEFAULT_WEIGHTS, [
      { rating: 'helpful', components: helpful },
      { rating: 'helpful', components: helpful },
      { rating: 'not_helpful', components: notHelpful },
    ])).not.toEqual(DEFAULT_WEIGHTS);
  });
});

describe('profile extraction', () => {
  it('extracts the student example', () => {
    expect(extractProfile("I'm a 21-year-old B.Tech student from Andhra Pradesh. My family earns around ₹2.5 lakh a year and I need financial support for education.")).toEqual({ age: 21, income: 250000, state: 'Andhra Pradesh', occupation: 'student', goal: 'education' });
  });
  it('extracts a farmer and a retiree', () => {
    expect(extractProfile("I'm a 45-year-old farmer in Telangana. Household income is about 1.8 lakh a year.")).toMatchObject({ age: 45, occupation: 'farmer', state: 'Telangana', income: 180000, goal: 'agriculture' });
    expect(extractProfile("I'm a 62-year-old retired teacher in Kerala earning about ₹1.2 lakh a year.")).toMatchObject({ age: 62, occupation: 'retired', goal: 'pension', income: 120000 });
  });
  it('does not invent fields that are not in the text', () => {
    expect(extractProfile('I need help')).toEqual({});
  });
});
