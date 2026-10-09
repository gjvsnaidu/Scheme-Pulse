import { z } from 'zod';
import type { Config } from '../config';
import { extractProfile } from '../engine/parser';
import type { Profile } from '../engine/types';

export interface AiProvider {
  name: string;
  extractProfile(text: string): Promise<Profile>;
  /** Rewrites a grounded draft answer in friendlier language. Must not add facts. */
  polish(question: string, groundedFacts: unknown, draft: string): Promise<string>;
}

export const rulesProvider: AiProvider = {
  name: 'rules',
  extractProfile: async (t) => extractProfile(t),
  polish: async (_q, _f, draft) => draft,
};

const profileSchema = z.object({
  age: z.number().int().min(0).max(120).optional(), income: z.number().int().min(0).optional(),
  state: z.string().optional(), occupation: z.enum(['student', 'farmer', 'entrepreneur', 'jobseeker', 'retired', 'other']).optional(),
  goal: z.enum(['education', 'agriculture', 'business', 'employment', 'pension', 'housing', 'healthcare']).optional(),
  gender: z.enum(['female', 'male', 'other']).optional(),
}).strip();

/** Anthropic Messages API over fetch. Provider-independent: swap by implementing AiProvider. */
export function anthropicProvider(cfg: Config): AiProvider {
  const call = async (system: string, user: string, max = 600): Promise<string> => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.ANTHROPIC_MODEL, max_tokens: max, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}`);
    const data: any = await res.json();
    return (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  };
  return {
    name: 'anthropic',
    async extractProfile(text) {
      try {
        const out = await call('Extract an Indian citizen profile from the text. Reply with ONLY a JSON object using keys age, income (rupees per year, integer), state, occupation (student|farmer|entrepreneur|jobseeker|retired|other), goal (education|agriculture|business|employment|pension|housing|healthcare), gender (female|male|other). Omit anything not stated. Never guess.', text, 300);
        const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
        return profileSchema.parse(json) as Profile;
      } catch { return extractProfile(text); } // validated or fall back to rules
    },
    async polish(question, facts, draft) {
      try {
        const out = await call('You help people understand government schemes. Use ONLY the facts provided. Never invent schemes, eligibility rules, amounts, deadlines or URLs. Never say an application was approved or a scheme is officially verified unless the facts say so. If the facts do not answer the question, say so. Keep it under 120 words.',
          `Question: ${question}\nFacts: ${JSON.stringify(facts)}\nDraft answer: ${draft}`);
        return out.trim() || draft;
      } catch { return draft; }
    },
  };
}

export const createAi = (cfg: Config): AiProvider => (cfg.AI_PROVIDER === 'anthropic' && cfg.ANTHROPIC_API_KEY ? anthropicProvider(cfg) : rulesProvider);
