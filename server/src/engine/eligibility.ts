import type { Check, Eligibility, Profile, Rule, SchemeRecord } from './types';
import { OCCUPATIONS } from './types';

export const inr = (v: number) =>
  v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} lakh` : `₹${Math.round(v).toLocaleString('en-IN')}`;

export function daysLeft(deadline: string | null, now = new Date()): number | null {
  if (!deadline) return null;
  const end = new Date(`${deadline}T23:59:59`);
  return Math.ceil((end.getTime() - now.getTime()) / 864e5);
}

const FIELD_LABEL: Record<string, string> = {
  age: 'Age', income: 'Family income', state: 'Location', occupation: 'Who it is for', gender: 'Gender', category: 'Category',
};
const fmt = (field: string, v: unknown) =>
  field === 'income' ? inr(Number(v)) : field === 'occupation' ? OCCUPATIONS[String(v)] ?? String(v) : String(v);

/** Evaluates a single rule. Pure and deterministic: language models never touch this. */
export function checkRule(rule: Rule, profile: Profile): Check {
  const label = rule.label || FIELD_LABEL[rule.field];
  const have = profile[rule.field];
  if (have === undefined || have === null || have === '')
    return { field: rule.field, label, status: 'unknown', detail: `Add your ${FIELD_LABEL[rule.field].toLowerCase()} to confirm` };
  const v = rule.value;
  let ok = false;
  let detail = '';
  switch (rule.op) {
    case 'manual': return { field: rule.field, label, status: 'unknown', detail: String(v) };
    case 'between': ok = Number(have) >= v[0] && Number(have) <= v[1]; detail = `You: ${have}. Allowed: ${v[0]} to ${v[1]}`; break;
    case 'lte': ok = Number(have) <= v; detail = `You: ${fmt(rule.field, have)}. Limit: ${fmt(rule.field, v)}`; break;
    case 'gte': ok = Number(have) >= v; detail = `You: ${fmt(rule.field, have)}. Minimum: ${fmt(rule.field, v)}`; break;
    case 'in': ok = (v as unknown[]).includes(have); detail = ok ? `You: ${fmt(rule.field, have)}` : `Open to: ${(v as unknown[]).map((x) => fmt(rule.field, x)).join(', ')}`; break;
    case 'eq': ok = have === v; detail = `Required: ${fmt(rule.field, v)}`; break;
  }
  return { field: rule.field, label, status: ok ? 'pass' : 'fail', detail };
}

export function evaluate(scheme: Pick<SchemeRecord, 'rules' | 'deadline'>, profile: Profile, now = new Date()) {
  const checks = scheme.rules.map((r) => checkRule(r, profile));
  const left = daysLeft(scheme.deadline, now);
  if (left !== null && left < 0)
    checks.push({ field: 'deadline', label: 'Deadline', status: 'fail', detail: `Applications closed on ${scheme.deadline}` });
  const status: Eligibility = checks.some((c) => c.status === 'fail') ? 'not_eligible'
    : checks.some((c) => c.status === 'unknown') ? 'needs_info' : 'eligible';
  return { status, checks };
}
