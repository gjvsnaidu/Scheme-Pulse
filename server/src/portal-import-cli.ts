import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { loadConfig } from './config';
import { connect, migrate } from './db';
import { importPublicPortalSchemes, parsePublicSchemeListings, type PortalKind } from './services/portal-import';

if (existsSync('.env')) loadEnvFile('.env');

const argv = process.argv.slice(2);
const portalArg = argv[0] as PortalKind | undefined;
const urls = argv.slice(1);

const portals: Record<PortalKind, string[]> = {
  myscheme: ['https://www.myscheme.gov.in/search'],
  ippb: ['https://www.ippbonline.com/'],
};

const chosen = portalArg && portalArg in portals ? portalArg : undefined;
const targets: { portal: PortalKind; url: string }[] = chosen
  ? (urls.length ? urls.map((url) => ({ portal: chosen, url })) : portals[chosen].map((url) => ({ portal: chosen, url })))
  : Object.entries(portals).flatMap(([portal, list]) => list.map((url) => ({ portal: portal as PortalKind, url })));

async function main() {
  const cfg = loadConfig();
  const db = await connect(cfg);
  await migrate(db);

  if (chosen) {
    const report = await importPublicPortalSchemes(db, chosen, urls.length ? urls : portals[chosen]);
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const { portal, url } of targets) {
      const html = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) }).then((r) => r.text()).catch(() => '');
      const items = parsePublicSchemeListings(portal, html);
      console.log(`Portal ${portal}: ${items.length} listings discovered from ${url}`);
    }
  }

  await db.close();
}

void main();
