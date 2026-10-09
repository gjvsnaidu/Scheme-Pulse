export interface Profile {
  age?: number; income?: number; state?: string; occupation?: string;
  goal?: string; gender?: string; category?: string;
}
export type RuleOp = 'between' | 'lte' | 'gte' | 'in' | 'eq' | 'manual';
export interface Rule { field: 'age' | 'income' | 'state' | 'occupation' | 'gender' | 'category'; op: RuleOp; value: any; label: string }
export type CheckStatus = 'pass' | 'fail' | 'unknown';
export interface Check { field: string; label: string; status: CheckStatus; detail: string }
export type Eligibility = 'eligible' | 'needs_info' | 'not_eligible';
export interface SchemeRecord {
  id: string; slug: string; name: string; department: string; category: string; level: 'national' | 'state';
  states: string[]; summary: string; benefitText: string; benefitValue: number; goal: string | null;
  deadline: string | null; sourceUrl: string | null; status: string; isDemo: boolean;
  verifiedAt: string | null; version: number; rules: Rule[]; documents: string[];
  sourceKey?: string | null; sourceUpdatedAt?: string | null; sourceSyncedAt?: string | null;
}
export const OCCUPATIONS: Record<string, string> = {
  student: 'Student', farmer: 'Farmer', entrepreneur: 'Business owner or founder',
  jobseeker: 'Job seeker', retired: 'Retired', other: 'Other',
};
export const GOALS: Record<string, string> = {
  education: 'Education', agriculture: 'Agriculture', business: 'Business',
  employment: 'Jobs and skills', pension: 'Pension', housing: 'Housing', healthcare: 'Healthcare',
};
