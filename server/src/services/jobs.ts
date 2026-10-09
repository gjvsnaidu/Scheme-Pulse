import type { Db } from '../db';
import type { Mailer } from './mailer';

/** Creates one in-app notification (and email) per saved scheme closing within `windowDays`. Idempotent via dedupe_key. */
export async function runDeadlineJob(db: Db, mail: Mailer, windowDays = 14, today = new Date()) {
  const rows = await db.query(`
    select u.id as user_id, u.email, s.id as scheme_id, s.name, to_char(s.deadline,'YYYY-MM-DD') as deadline,
           (s.deadline - $1::date) as days
    from saved_schemes sv join users u on u.id = sv.user_id join schemes s on s.id = sv.scheme_id
    where s.status='published' and s.deadline is not null and s.deadline >= $1::date and s.deadline <= ($1::date + $2::int)`,
    [today.toISOString().slice(0, 10), windowDays]);
  let created = 0;
  for (const r of rows) {
    const ins = await db.query(
      `insert into notifications(user_id,kind,title,body,scheme_id,dedupe_key) values($1,'deadline',$2,$3,$4,$5)
       on conflict(user_id, dedupe_key) do nothing returning id`,
      [r.user_id, `${r.name} closes in ${r.days} days`, `The listed deadline is ${r.deadline}. Confirm the date with the issuing department.`, r.scheme_id, `deadline:${r.scheme_id}:${r.deadline}`]);
    if (ins.length) { created++; await mail(r.email, `Deadline approaching: ${r.name}`, `The listed deadline is ${r.deadline}. Confirm with the issuing department.`).catch(() => undefined); }
  }
  return { created };
}
