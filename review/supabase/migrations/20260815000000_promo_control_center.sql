-- Sugar & Salt remote promotion control plane.
-- Browser clients never receive service-role credentials or worker secrets.

create extension if not exists pgcrypto;

create table if not exists public.promo_items (
  id text primary key,
  title text not null,
  channel text not null,
  category text not null,
  risk text not null check (risk in ('낮음', '중', '상')),
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'hold', 'rejected')),
  due date,
  source_ref text not null default '',
  notes text not null default '',
  content text not null default '',
  route text not null default '',
  required_gates jsonb not null default '[]'::jsonb check (jsonb_typeof(required_gates) = 'array'),
  gates jsonb not null default '{}'::jsonb check (jsonb_typeof(gates) = 'object'),
  delivery jsonb not null default '{"adapter":"browser","destination":"","scheduledAt":null,"attachments":[],"cost":0}'::jsonb check (jsonb_typeof(delivery) = 'object'),
  approved_hash text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce((delivery ->> 'cost')::numeric, 0) = 0)
);

create table if not exists public.promo_jobs (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.promo_items(id) on delete cascade,
  status text not null default 'approved' check (status in ('approved', 'scheduled', 'executing', 'awaiting_automation', 'sent', 'published', 'failed', 'needs_attention', 'rejected_by_platform', 'revoked')),
  approved_snapshot jsonb not null check (jsonb_typeof(approved_snapshot) = 'object'),
  approved_hash text not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  execute_after timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  result jsonb,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists promo_jobs_one_active_approval_idx
  on public.promo_jobs (item_id, approved_hash)
  where status in ('approved', 'scheduled', 'executing', 'awaiting_automation');
create index if not exists promo_jobs_due_idx on public.promo_jobs (status, execute_after, approved_at);

create table if not exists public.promo_activity (
  id bigint generated always as identity primary key,
  item_id text references public.promo_items(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists promo_activity_created_idx on public.promo_activity (created_at desc);

create table if not exists public.promo_workers (
  worker_id text primary key,
  label text not null default '집 PC 실행기',
  status text not null default 'online' check (status in ('online', 'attention', 'paused')),
  version text,
  message text,
  capabilities jsonb not null default '[]'::jsonb,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promo_items enable row level security;
alter table public.promo_jobs enable row level security;
alter table public.promo_activity enable row level security;
alter table public.promo_workers enable row level security;

revoke all on public.promo_items from anon, authenticated;
revoke all on public.promo_jobs from anon, authenticated;
revoke all on public.promo_activity from anon, authenticated;
revoke all on public.promo_workers from anon, authenticated;
revoke all on sequence public.promo_activity_id_seq from anon, authenticated;

comment on table public.promo_items is 'Manager-only promotion plans; accessed through promo-control Edge Function.';
comment on table public.promo_jobs is 'Immutable approval snapshots claimed by the private home executor.';
comment on table public.promo_workers is 'Heartbeat only; no browser cookies, platform passwords, or third-party personal data.';
