import type { Recommendation } from '../services/recommend';
import { inr } from '../engine/eligibility';

export interface Answer { text: string; schemeIds: string[]; intent: string; facts: unknown }

const names = (r: Recommendation[]) => r.map((x) => x.scheme.name).join(', ');

/** Grounded assistant: every sentence is built from stored scheme records and rule results. */
export function answer(question: string, recs: Recommendation[]): Answer {
  const q = question.toLowerCase();
  const mentioned = recs.find((r) => q.includes(r.scheme.name.toLowerCase()))
    ?? recs.find((r) => r.scheme.name.toLowerCase().split(' ').filter((w) => w.length > 5).some((w) => q.includes(w)));
  const open = recs.filter((r) => r.status !== 'not_eligible');
  const eligible = recs.filter((r) => r.status === 'eligible');
  const sourceNote = ' Confirm current eligibility, benefits and deadlines with the issuing department.';

  if (/why.*(not|isn'?t|am i not)|not eligible/.test(q)) {
    const target = mentioned ?? recs.find((r) => r.status === 'not_eligible');
    if (!target) return { intent: 'why_not', text: 'Good news: none of the schemes I checked rule you out on the details you gave.', schemeIds: [], facts: {} };
    const fails = target.checks.filter((c) => c.status === 'fail');
    const unknown = target.checks.filter((c) => c.status === 'unknown');
    const text = fails.length
      ? `${target.scheme.name} does not fit right now. ${fails.map((c) => `${c.label}: ${c.detail}.`).join(' ')}`
      : unknown.length ? `I can't confirm ${target.scheme.name} yet. Missing: ${unknown.map((c) => c.label.toLowerCase()).join(', ')}.` : `You meet every rule I have for ${target.scheme.name}.`;
    return { intent: 'why_not', text: text + sourceNote, schemeIds: [target.scheme.id], facts: { scheme: target.scheme.name, checks: target.checks } };
  }
  if (/document|certificate|paper|need to apply/.test(q)) {
    const t = mentioned ?? open[0];
    if (!t) return { intent: 'documents', text: 'Tell me about yourself first so I can find relevant schemes.', schemeIds: [], facts: {} };
    return { intent: 'documents', text: `For ${t.scheme.name} the record lists: ${t.scheme.documents.join(', ')}. Confirm the exact list with the issuing department.${sourceNote}`, schemeIds: [t.scheme.id], facts: { documents: t.scheme.documents } };
  }
  if (/highest|biggest|most money|best benefit|maximum/.test(q)) {
    const t = [...open].sort((a, b) => b.scheme.benefitValue - a.scheme.benefitValue)[0];
    if (!t) return { intent: 'highest', text: 'I have no open schemes for your details yet.', schemeIds: [], facts: {} };
    return { intent: 'highest', text: `The largest listed benefit among schemes you may qualify for is ${t.scheme.name}: ${t.scheme.benefitText}. Check scheme rules before combining benefits.${sourceNote}`, schemeIds: [t.scheme.id], facts: { benefit: t.scheme.benefitText } };
  }
  if (/deadline|last date|closing|when/.test(q)) {
    const soon = open.filter((r) => r.daysLeft !== null && r.daysLeft >= 0).sort((a, b) => a.daysLeft! - b.daysLeft!).slice(0, 3);
    if (!soon.length) return { intent: 'deadline', text: 'None of your matches have a listed deadline.', schemeIds: [], facts: {} };
    return { intent: 'deadline', text: `Closest listed deadlines: ${soon.map((r) => `${r.scheme.name} on ${r.scheme.deadline} (${r.daysLeft} days)`).join('; ')}. Verify dates with the department.${sourceNote}`, schemeIds: soon.map((r) => r.scheme.id), facts: {} };
  }
  if (/compare/.test(q)) {
    const top = open.slice(0, 2);
    if (top.length < 2) return { intent: 'compare', text: 'I need at least two matching schemes to compare.', schemeIds: [], facts: {} };
    return { intent: 'compare', text: `${top[0].scheme.name}: ${top[0].scheme.benefitText}, ${top[0].scheme.documents.length} documents. ${top[1].scheme.name}: ${top[1].scheme.benefitText}, ${top[1].scheme.documents.length} documents.${sourceNote}`, schemeIds: top.map((r) => r.scheme.id), facts: {} };
  }
  if (mentioned && /income|limit|age|rule|eligib/.test(q)) {
    const c = mentioned.checks.map((x) => `${x.label}: ${x.detail}`).join('. ');
    return { intent: 'eligibility', text: `${mentioned.scheme.name} (${mentioned.status.replace('_', ' ')}). ${c}.${sourceNote}`, schemeIds: [mentioned.scheme.id], facts: {} };
  }
  if (!eligible.length && !open.length) return { intent: 'apply', text: 'I could not find a scheme that fits the details I have. Try adding your age, income and state.', schemeIds: [], facts: {} };
  const list = (eligible.length ? eligible : open).slice(0, 3);
  if (!eligible.length && open.length) {
    const uncertain = open.filter((item) => item.status === 'needs_info').slice(0, 3);
    return {
      intent: 'apply',
      text: `I found ${open.length} relevant scheme listing${open.length === 1 ? '' : 's'}, but I cannot confirm eligibility from the information available. Check: ${names(uncertain)}.${sourceNote}`,
      schemeIds: uncertain.map((item) => item.scheme.id), facts: { schemes: uncertain.map((item) => item.scheme.name), eligibilityConfirmed: false },
    };
  }
  return {
    intent: 'apply',
    text: `You appear to qualify for ${list.length} scheme${list.length > 1 ? 's' : ''}: ${names(list)}. Top benefit: ${list[0].scheme.benefitText}${list[0].scheme.benefitValue ? ` (${inr(list[0].scheme.benefitValue)} scale)` : ''}.${sourceNote}`,
    schemeIds: list.map((r) => r.scheme.id), facts: { schemes: list.map((r) => r.scheme.name) },
  };
}
