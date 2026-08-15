create table if not exists public.review_presence (
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  document_id uuid references public.review_documents(id) on delete set null,
  visibility_state text not null default 'visible' check (visibility_state in ('visible', 'hidden', 'locked')),
  client_version text,
  last_heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, reviewer_user_id)
);

create index if not exists review_presence_last_heartbeat_idx
  on public.review_presence (last_heartbeat_at desc);

alter table public.review_presence enable row level security;

revoke all on table public.review_presence from anon, authenticated;
grant all on table public.review_presence to service_role;
