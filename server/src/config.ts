import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');
const officialUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(gov\.in|nic\.in)$/.test(url.hostname);
  } catch { return false; }
};
const officialFeed = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(2).max(100),
  url: z.string().url().refine(officialUrl, 'Feed URL must use HTTPS on a gov.in or nic.in domain'),
  token: z.string().optional(),
});
const officialFeeds = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}, z.array(officialFeed).max(10).superRefine((feeds, ctx) => {
  const keys = new Set<string>();
  feeds.forEach((feed, index) => {
    if (keys.has(feed.key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Feed keys must be unique' });
    keys.add(feed.key);
  });
}));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().optional(), // unset -> embedded Postgres (PGlite)
  PGLITE_DIR: z.string().default('./.data/pglite'), // "memory://" for ephemeral
  JWT_SECRET: z.string().default('dev-only-secret-change-me-dev-only-secret'),
  ACCESS_TTL_MIN: z.coerce.number().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(), // default: true in production
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SERVE_WEB: bool,
  WEB_DIST: z.string().default('../web/dist'),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  OFFICIAL_SCHEME_FEEDS: officialFeeds.default([]),
  OFFICIAL_SCHEME_SYNC_MINUTES: z.coerce.number().int().min(15).max(1440).default(60),
  RATE_LIMIT_DISABLED: bool,
  // AI provider (optional). Without a key the deterministic rule-based provider is used.
  AI_PROVIDER: z.enum(['rules', 'anthropic']).default('rules'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),
  // Email (optional). Without SMTP_URL, emails are logged instead of sent.
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('SchemePulse <no-reply@schemepulse.local>'),
  // Object storage for uploaded documents
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./.data/uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = schema.parse(env);
  if (cfg.NODE_ENV === 'production') {
    if (cfg.JWT_SECRET.startsWith('dev-only') || cfg.JWT_SECRET.length < 32)
      throw new Error('JWT_SECRET must be a random string of at least 32 characters in production');
    if (cfg.AI_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY)
      throw new Error('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  }
  return cfg;
}
