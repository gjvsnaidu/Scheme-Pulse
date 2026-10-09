export type Status = 'eligible' | 'needs_info' | 'not_eligible';
export interface Profile { age?: number; income?: number; state?: string; occupation?: string; goal?: string; gender?: string; category?: string }
export interface Check { field: string; label: string; status: 'pass' | 'fail' | 'unknown'; detail: string }
export interface Scheme {
  id: string; slug: string; name: string; department: string; category: string; level: 'national' | 'state'; states: string[];
  summary: string; benefitText: string; benefitValue: number; goal: string | null; deadline: string | null; sourceUrl: string | null;
  status: string; isDemo: boolean; verifiedAt: string | null; version: number; documents: string[]; rules: unknown[];
  sourceKey?: string | null; sourceUpdatedAt?: string | null; sourceSyncedAt?: string | null;
}
export interface Rec {
  scheme: Scheme; status: Status; checks: Check[]; reasons: string[]; daysLeft: number | null;
  score: { total: number; band: string; components: Record<string, number> };
  feedback?: 'helpful' | 'not_helpful' | null;
}
export interface User { id: string; email: string; role: 'user' | 'admin'; name: string | null }
export const OCCUPATIONS: Record<string, string> = { student: 'Student', farmer: 'Farmer', entrepreneur: 'Business owner or founder', jobseeker: 'Job seeker', retired: 'Retired', other: 'Other' };
export const GOALS: Record<string, string> = { education: 'Education', agriculture: 'Agriculture', business: 'Business', employment: 'Jobs and skills', pension: 'Pension', housing: 'Housing', healthcare: 'Healthcare' };
export const STATUS_LABEL: Record<Status, string> = { eligible: 'Eligible', needs_info: 'Need info', not_eligible: 'Not eligible' };
export const STATUS_CLASS: Record<Status, string> = { eligible: 'ok', needs_info: 'wn', not_eligible: 'no' };
export const inr = (v: number) => (v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} lakh` : `₹${Math.round(v).toLocaleString('en-IN')}`);
