import type { Db } from '../db';
export const audit = (db: Db, actorId: string | null, action: string, entity: string, entityId?: string | null, meta: object = {}) =>
  db.query('insert into audit_logs(actor_id,action,entity,entity_id,meta) values($1,$2,$3,$4,$5::jsonb)', [actorId, action, entity, entityId ?? null, JSON.stringify(meta)]);
export const track = (db: Db, userId: string | null | undefined, kind: string, payload: object = {}) =>
  db.query('insert into events(user_id,kind,payload) values($1,$2,$3::jsonb)', [userId ?? null, kind, JSON.stringify(payload)]).catch(() => undefined);
