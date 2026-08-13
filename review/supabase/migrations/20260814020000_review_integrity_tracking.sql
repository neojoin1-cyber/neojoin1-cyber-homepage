create table if not exists public.review_block_checks (
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  document_id uuid not null references public.review_documents(id) on delete cascade,
  block_id uuid not null references public.review_blocks(id) on delete cascade,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  first_seen_at timestamptz,
  first_checked_at timestamptz,
  last_checked_at timestamptz,
  check_count integer not null default 0,
  elapsed_seconds numeric,
  estimated_seconds integer,
  speed_status text not null default 'unknown' check (speed_status in ('normal', 'fast', 'very_fast', 'bulk', 'unknown')),
  character_count integer not null default 0,
  bulk_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, document_id, block_id, reviewer_user_id)
);

create index if not exists review_block_checks_assignment_idx
  on public.review_block_checks (assignment_id, reviewer_user_id, speed_status);

alter table public.review_block_checks enable row level security;
revoke all on public.review_block_checks from anon, authenticated;
grant all on public.review_block_checks to service_role;
