-- Contract-first release gate for the expert review workroom.
-- Prepared assignments are invisible until the company manager starts them.

alter table public.review_assignments add column if not exists exam_track text not null default 'national';
alter table public.review_assignments add column if not exists contract_completed_at timestamptz;
alter table public.review_assignments add column if not exists started_at timestamptz;
alter table public.review_assignments add column if not exists interim_due_at timestamptz;

alter table public.review_assignments drop constraint if exists review_assignments_status_check;
alter table public.review_assignments
  add constraint review_assignments_status_check
  check (status in ('prepared', 'assigned', 'reviewing', 'submitted', 'accepted', 'returned', 'revoked'));

alter table public.review_assignments drop constraint if exists review_assignments_exam_track_check;
alter table public.review_assignments
  add constraint review_assignments_exam_track_check
  check (exam_track in ('national', 'local'));

comment on column public.review_assignments.exam_track is 'national or local; national/local source documents must not be mixed';
comment on column public.review_assignments.contract_completed_at is 'company confirmation timestamp for the signed electronic contract';
comment on column public.review_assignments.started_at is 'manager batch-start timestamp; null means reviewer access is blocked';
comment on column public.review_assignments.interim_due_at is 'first progress report due timestamp';

create table if not exists public.review_interim_reports (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  schema_version text not null default 'sugar-salt-expert-review/v1',
  report_id text not null,
  file_name text not null,
  markdown text not null,
  json_payload jsonb not null,
  sha256 text not null,
  submitted_at timestamptz not null default now(),
  unique (assignment_id, reviewer_user_id)
);
create index if not exists review_interim_reports_submitted_idx on public.review_interim_reports (submitted_at desc);
alter table public.review_interim_reports enable row level security;
revoke all on table public.review_interim_reports from anon, authenticated;
grant all on table public.review_interim_reports to service_role;
