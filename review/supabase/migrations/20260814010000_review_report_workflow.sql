-- Manager-first review, approval, and textbook-system handoff workflow.
create table if not exists public.review_manager_reviews (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null unique references public.review_exports(id) on delete cascade,
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  manager_user_id uuid references public.review_profiles(user_id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'approved')),
  manager_notes text not null default '',
  ai_supplement jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_manager_reviews_assignment_idx
  on public.review_manager_reviews (assignment_id, updated_at desc);

drop trigger if exists review_manager_reviews_updated_at on public.review_manager_reviews;
create trigger review_manager_reviews_updated_at
before update on public.review_manager_reviews
for each row execute function public.review_set_updated_at();

alter table public.review_manager_reviews enable row level security;
revoke all on table public.review_manager_reviews from anon, authenticated;
grant all on table public.review_manager_reviews to service_role;
