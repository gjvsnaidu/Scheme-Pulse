import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { loadConfig } from './config';
import { connect, migrate } from './db';
import { seed } from './seed';

if (existsSync('.env')) loadEnvFile('.env');

const cfg = loadConfig();
const db = await connect(cfg);
await migrate(db);
await seed(db, cfg);
console.log(`${cfg.SEED_DEMO ? 'Seeded test fixtures' : 'No scheme fixtures loaded'}${cfg.ADMIN_EMAIL ? ' and admin user' : ''}`);
await db.close();
