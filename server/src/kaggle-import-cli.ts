import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { loadConfig } from './config';
import { connect, migrate } from './db';
import { importKaggleDataset } from './services/kaggle-import';

if (existsSync('.env')) loadEnvFile('.env');

const argv = process.argv.slice(2);
const fileArg = argv[0];
const formatArg = argv.find((arg) => arg.startsWith('--format='))?.split('=')[1];
const sourceName = argv.find((arg) => arg.startsWith('--name='))?.split('=')[1];

if (!fileArg) {
  console.error('Usage: npm run import:kaggle -- <path-to-csv-or-json> [--format=csv|json] [--name=my-dataset]');
  process.exit(1);
}

async function main() {
  const cfg = loadConfig();
  const db = await connect(cfg);
  await migrate(db);

  const report = await importKaggleDataset(db, fileArg, {
    format: (formatArg as any) ?? 'auto',
    sourceName: sourceName ?? fileArg,
  });

  console.log(JSON.stringify(report, null, 2));
  await db.close();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
