import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { loadConfig } from './config';
import { connect, migrate } from './db';
import { seed } from './seed';
import { createApp } from './app';
import { createAi } from './ai/provider';
import { createMailer } from './services/mailer';
import { createStorage } from './services/storage';
import { runDeadlineJob } from './services/jobs';
import { syncOfficialSchemes } from './services/scheme-sync';

if (existsSync('.env')) loadEnvFile('.env');

const cfg = loadConfig();
const db = await connect(cfg);
await migrate(db);
await seed(db, cfg);
const mail = createMailer(cfg);
const app = createApp({ db, cfg, ai: createAi(cfg), mail, storage: createStorage(cfg) });
const server = app.listen(cfg.PORT, () => console.log(`SchemePulse API on :${cfg.PORT} (db: ${cfg.DATABASE_URL ? 'postgres' : 'embedded'}, ai: ${cfg.AI_PROVIDER})`));

// Background job: deadline reminders, hourly. Idempotent, so multiple instances are safe.
const timer = setInterval(() => runDeadlineJob(db, mail).catch((e) => console.error('deadline job failed', e)), 3_600_000);
const runConfiguredSync = () => syncOfficialSchemes(db, cfg).then(({ results }) => {
	for (const result of results.filter((item) => item.status === 'failed')) console.error(`official scheme sync failed: ${result.sourceKey}: ${result.error}`);
}).catch((e) => console.error('official scheme sync failed', e));
if (cfg.OFFICIAL_SCHEME_FEEDS.length) {
	void runConfiguredSync();
}
const schemeSyncTimer = cfg.OFFICIAL_SCHEME_FEEDS.length ? setInterval(runConfiguredSync, cfg.OFFICIAL_SCHEME_SYNC_MINUTES * 60_000) : undefined;
const stop = async () => { clearInterval(timer); if (schemeSyncTimer) clearInterval(schemeSyncTimer); server.close(); await db.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
