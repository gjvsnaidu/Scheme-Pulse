/** Ordered, append-only migrations. Statements are separated by ";" at end of a line. */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: `
create table users(
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text,
  role text not null default 'user' check (role in ('user','admin')),
  language text not null default 'en',
  created_at timestamptz not null default now()
);
create table refresh_tokens(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table profiles(
  user_id uuid primary key references users(id) on delete cascade,
  age int check (age between 0 and 120),
  occupation text, state text, income int check (income >= 0), goal text, gender text, category text,
  updated_at timestamptz not null default now()
);
create table schemes(
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  department text not null,
  category text not null,
  level text not null default 'national' check (level in ('national','state')),
  states jsonb not null default '[]',
  summary text not null default '',
  benefit_text text not null,
  benefit_value int not null default 0,
  goal text,
  deadline date,
  source_url text,
  status text not null default 'draft' check (status in ('draft','pending_review','published','archived')),
  is_demo boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references users(id),
  version int not null default 1,
  search tsvector generated always as (to_tsvector('english', name || ' ' || summary || ' ' || department || ' ' || category || ' ' || coalesce(goal,''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index schemes_search_idx on schemes using gin(search);
create index schemes_status_idx on schemes(status, category);
create table eligibility_rules(
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references schemes(id) on delete cascade,
  field text not null check (field in ('age','income','state','occupation','gender','category')),
  op text not null check (op in ('between','lte','gte','in','eq')),
  value jsonb not null,
  label text not null
);
create index eligibility_rules_scheme_idx on eligibility_rules(scheme_id);
create table scheme_documents(
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references schemes(id) on delete cascade,
  name text not null
);
create index scheme_documents_scheme_idx on scheme_documents(scheme_id);
create table scheme_versions(
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references schemes(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  changed_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table saved_schemes(
  user_id uuid not null references users(id) on delete cascade,
  scheme_id uuid not null references schemes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, scheme_id)
);
create table applications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  scheme_id uuid not null references schemes(id) on delete cascade,
  status text not null default 'discovered' check (status in ('discovered','eligibility_checked','documents_ready','started','submitted','under_review','approved','rejected')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, scheme_id)
);
create table application_events(
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now()
);
create table user_documents(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  doc_type text not null,
  filename text,
  mime text,
  size int,
  storage_key text,
  status text not null default 'self_declared' check (status in ('self_declared','uploaded')),
  created_at timestamptz not null default now(),
  unique(user_id, doc_type)
);
create table notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  scheme_id uuid references schemes(id) on delete set null,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, dedupe_key)
);
create table recommendations(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  scheme_id uuid not null references schemes(id) on delete cascade,
  total int not null,
  components jsonb not null,
  status text not null,
  created_at timestamptz not null default now()
);
create index recommendations_user_idx on recommendations(user_id, created_at desc);
create table admin_reviews(
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references schemes(id) on delete cascade,
  reviewer_id uuid references users(id),
  decision text not null check (decision in ('verified','published','archived','changes_requested')),
  note text,
  created_at timestamptz not null default now()
);
create table settings(key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table events(
  id bigserial primary key,
  user_id uuid,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_kind_idx on events(kind, created_at desc);
create table audit_logs(
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
)`,
  },
  {
    id: '002_recommendation_feedback',
    sql: `
create table recommendation_feedback(
  user_id uuid not null references users(id) on delete cascade,
  scheme_id uuid not null references schemes(id) on delete cascade,
  rating text not null check (rating in ('helpful','not_helpful')),
  components jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(user_id, scheme_id)
);
create index recommendation_feedback_user_idx on recommendation_feedback(user_id, updated_at desc)`
  },
  {
    id: '003_official_scheme_sync',
    sql: `
alter table schemes add column source_key text;
alter table schemes add column source_record_id text;
alter table schemes add column source_updated_at timestamptz;
alter table schemes add column source_synced_at timestamptz;
alter table schemes add column source_hash text;
create unique index scheme_source_record_idx on schemes(source_key,source_record_id) where source_key is not null;
create table scheme_sync_runs(
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_name text not null,
  status text not null check (status in ('running','succeeded','completed_with_errors','failed')),
  items_seen int not null default 0,
  created int not null default 0,
  updated int not null default 0,
  unchanged int not null default 0,
  rejected int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index scheme_sync_runs_recent_idx on scheme_sync_runs(started_at desc);
create table scheme_sync_locks(
  source_key text primary key,
  lease_id uuid not null,
  locked_until timestamptz not null
);
update schemes set status='archived', updated_at=now() where is_demo=true and status<>'archived'`
  },
  {
    id: '004_manual_eligibility_checks',
    sql: `
alter table eligibility_rules drop constraint eligibility_rules_op_check;
alter table eligibility_rules add constraint eligibility_rules_op_check check (op in ('between','lte','gte','in','eq','manual'))`
  },
];
