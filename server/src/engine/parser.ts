import { OCCUPATIONS, type Profile } from './types';

export const STATES = [
  'Andhra Pradesh', 'Telangana', 'Tamil Nadu', 'Karnataka', 'Kerala', 'Maharashtra', 'Gujarat', 'Rajasthan',
  'Uttar Pradesh', 'Bihar', 'West Bengal', 'Odisha', 'Madhya Pradesh', 'Punjab', 'Haryana', 'Delhi',
];

const OCC: [string, RegExp][] = [
  ['retired', /retire|senior citizen/], ['farmer', /farm|crop|cultivat/],
  ['entrepreneur', /business|startup|start-up|shop|entrepreneur|founder/],
  ['student', /student|b\.?tech|college|universit|studying|degree/], ['jobseeker', /unemployed|\bjob|skill|training/],
];
const GOAL: [string, RegExp][] = [
  ['pension', /pension|retire/], ['agriculture', /farm|crop|agricultur/], ['housing', /\bhome\b|house|housing|flat/],
  ['business', /business|startup|start-up|enterprise|shop/], ['education', /scholarship|fee|tuition|education|study|college/],
  ['employment', /\bjob|skill|training|stipend/], ['healthcare', /health|hospital|medical|insurance/],
];

/** Deterministic text -> profile extraction. Used directly, and as the fallback for any LLM provider. */
export function extractProfile(text: string): Profile {
  const x = text.toLowerCase();
  const p: Profile = {};
  let m = x.match(/(\d{2})[\s-]*(?:year|yr)s?[\s-]*old/) || x.match(/\bage[d]?\s*(?:is\s*)?(\d{2})\b/) || x.match(/\bi['’]?m\s*(?:a\s*)?(\d{2})\b/);
  if (m) p.age = +m[1];
  m = x.match(/(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|lpa)/);
  if (m) p.income = Math.round(+m[1] * 1e5);
  else if ((m = x.match(/(?:₹|rs\.?|inr)\s*([\d,]+)\s*(k)?/))) p.income = parseInt(m[1].replace(/,/g, ''), 10) * (m[2] ? 1e3 : 1);
  p.state = STATES.find((s) => x.includes(s.toLowerCase()));
  p.occupation = OCC.find(([, r]) => r.test(x))?.[0];
  p.goal = GOAL.find(([, r]) => r.test(x))?.[0];
  if (!p.goal && p.occupation)
    p.goal = ({ student: 'education', farmer: 'agriculture', entrepreneur: 'business', jobseeker: 'employment', retired: 'pension' } as Record<string, string>)[p.occupation];
  if (/\b(woman|female|she|girl)\b/.test(x)) p.gender = 'female';
  else if (/\b(man|male|he|boy)\b/.test(x)) p.gender = 'male';
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Profile;
}

export const describeDetected = (p: Profile) =>
  (['age', 'occupation', 'state', 'income', 'goal'] as const).map((k) => ({ field: k, detected: p[k] !== undefined, value: p[k] ?? null }));
export { OCCUPATIONS };
