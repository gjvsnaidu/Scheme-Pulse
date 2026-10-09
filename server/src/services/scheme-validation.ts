import { z } from 'zod';

const rule = z.object({
  field: z.enum(['age', 'income', 'state', 'occupation', 'gender', 'category']),
  op: z.enum(['between', 'lte', 'gte', 'in', 'eq', 'manual']),
  value: z.any(),
  label: z.string().max(60),
}).refine((item) => (item.op === 'manual' ? typeof item.value === 'string' && item.value.length > 0
  : item.op === 'between' ? Array.isArray(item.value) && item.value.length === 2 && item.value.every((n: unknown) => typeof n === 'number')
  : item.op === 'in' ? Array.isArray(item.value) : item.op === 'eq' ? item.value !== undefined : typeof item.value === 'number'), { message: 'Rule value does not match its operator' });

export const schemeSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,80}$/),
  name: z.string().min(3).max(160),
  department: z.string().min(2).max(120),
  category: z.string().min(2).max(60),
  level: z.enum(['national', 'state']).default('national'),
  states: z.array(z.string()).default([]),
  summary: z.string().max(600).default(''),
  benefitText: z.string().min(2).max(200),
  benefitValue: z.number().int().min(0).default(0),
  goal: z.string().max(40).nullish(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  sourceUrl: z.string().url().nullish(),
  isDemo: z.boolean().default(false),
  rules: z.array(rule).max(20),
  documents: z.array(z.string().min(2).max(60)).max(20),
});