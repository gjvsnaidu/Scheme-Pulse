import { PGlite } from '@electric-sql/pglite';
const db = new PGlite('./.data/pglite');
await db.waitReady;
const rows = await db.query("select count(*) as c, status, min(name) as sample from schemes group by status order by status");
console.log(JSON.stringify(rows, null, 2));
await db.close();
