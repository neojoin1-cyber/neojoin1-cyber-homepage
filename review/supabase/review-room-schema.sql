-- Sugar & Salt secure expert review workroom
-- Apply in a dedicated Supabase migration after reviewing the target project.
-- Original source files stay in a private bucket and are never exposed to browser clients.

create extension if not exists pgcrypto;

create table if not exists public.review_programs (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.review_subjects (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references public.review_programs(id) on delete restrict,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (program_id, code)
);

create table if not exists public.review_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  mobile text,
  organization text,
  department text,
  position_title text,
  role text not null default 'reviewer' check (role in ('reviewer', 'manager', 'admin')),
  role_label text not null default '외부 전문위원',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists review_profiles_email_lower_idx on public.review_profiles (lower(email));

create table if not exists public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  subject_id uuid not null references public.review_subjects(id) on delete restrict,
  title text not null,
  contract_reference text,
  notification_sent_at timestamptz,
  status text not null default 'prepared' check (status in ('prepared', 'assigned', 'reviewing', 'submitted', 'accepted', 'returned', 'revoked')),
  exam_track text not null default 'national' check (exam_track in ('national', 'local')),
  contract_completed_at timestamptz,
  started_at timestamptz,
  interim_due_at timestamptz,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  watermark_code text not null default encode(extensions.gen_random_bytes(7), 'hex'),
  submitted_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists review_assignments_reviewer_idx on public.review_assignments (reviewer_user_id, status, starts_at);

create table if not exists public.review_documents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.review_subjects(id) on delete restrict,
  kind text not null,
  title text not null,
  version text not null,
  review_stage text not null default '1차 검수',
  source_object_path text,
  source_sha256 text,
  status text not null default 'draft' check (status in ('draft', 'review_ready', 'reviewing', 'approved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists review_documents_subject_idx on public.review_documents (subject_id, status);

create table if not exists public.review_blocks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.review_documents(id) on delete cascade,
  block_key text not null,
  heading text not null,
  body text not null,
  sort_order integer not null default 0,
  source_fingerprint text not null default encode(extensions.gen_random_bytes(8), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, block_key)
);
create index if not exists review_blocks_document_order_idx on public.review_blocks (document_id, sort_order);

create table if not exists public.review_assignment_documents (
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  document_id uuid not null references public.review_documents(id) on delete restrict,
  sort_order integer not null default 0,
  release_stage integer not null default 1,
  visible_from timestamptz,
  visible_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (assignment_id, document_id)
);
create index if not exists review_assignment_documents_order_idx on public.review_assignment_documents (assignment_id, sort_order);

create table if not exists public.review_annotations (
  id uuid primary key,
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  document_id uuid not null references public.review_documents(id) on delete cascade,
  block_id uuid not null references public.review_blocks(id) on delete cascade,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  kind text not null check (kind in ('highlight', 'memo', 'issue')),
  color text check (color is null or color in ('yellow', 'green', 'pink')),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  selected_text text not null,
  body text not null default '',
  issue_type text,
  severity text check (severity is null or severity in ('critical', 'major', 'minor')),
  status text not null default 'open' check (status in ('open', 'accepted', 'resolved', 'deferred')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists review_annotations_assignment_document_idx on public.review_annotations (assignment_id, document_id, block_id);

create table if not exists public.review_progress (
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  document_id uuid not null references public.review_documents(id) on delete cascade,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  checked_blocks jsonb not null default '[]'::jsonb,
  memo text not null default '',
  complete boolean not null default false,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (assignment_id, document_id, reviewer_user_id)
);

create table if not exists public.review_events (
  id bigint generated always as identity primary key,
  assignment_id uuid references public.review_assignments(id) on delete set null,
  document_id uuid references public.review_documents(id) on delete set null,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  occurred_at timestamptz not null default now()
);
create index if not exists review_events_assignment_time_idx on public.review_events (assignment_id, occurred_at desc);

create table if not exists public.review_exports (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  schema_version text not null default 'sugar-salt-expert-review/v1',
  report_id text not null,
  file_name text not null,
  markdown text not null,
  json_payload jsonb not null,
  sha256 text not null,
  delivery_status text not null default 'ready' check (delivery_status in ('ready', 'delivered', 'superseded')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (assignment_id, reviewer_user_id)
);
create index if not exists review_exports_delivery_idx on public.review_exports (delivery_status, created_at);

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

-- Safe to re-run on an existing review workroom database.
alter table public.review_profiles add column if not exists mobile text;
alter table public.review_profiles add column if not exists organization text;
alter table public.review_profiles add column if not exists department text;
alter table public.review_profiles add column if not exists position_title text;
alter table public.review_assignments add column if not exists contract_reference text;
alter table public.review_assignments add column if not exists notification_sent_at timestamptz;
alter table public.review_assignments add column if not exists exam_track text not null default 'national';
alter table public.review_assignments add column if not exists contract_completed_at timestamptz;
alter table public.review_assignments add column if not exists started_at timestamptz;
alter table public.review_assignments add column if not exists interim_due_at timestamptz;
alter table public.review_assignments drop constraint if exists review_assignments_status_check;
alter table public.review_assignments add constraint review_assignments_status_check check (status in ('prepared', 'assigned', 'reviewing', 'submitted', 'accepted', 'returned', 'revoked'));
alter table public.review_assignments drop constraint if exists review_assignments_exam_track_check;
alter table public.review_assignments add constraint review_assignments_exam_track_check check (exam_track in ('national', 'local'));
update public.review_profiles set role_label = '외부 전문위원' where role_label = '외부 검수위원';

create or replace function public.review_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists review_profiles_updated_at on public.review_profiles;
create trigger review_profiles_updated_at before update on public.review_profiles for each row execute function public.review_set_updated_at();
drop trigger if exists review_assignments_updated_at on public.review_assignments;
create trigger review_assignments_updated_at before update on public.review_assignments for each row execute function public.review_set_updated_at();
drop trigger if exists review_documents_updated_at on public.review_documents;
create trigger review_documents_updated_at before update on public.review_documents for each row execute function public.review_set_updated_at();
drop trigger if exists review_blocks_updated_at on public.review_blocks;
create trigger review_blocks_updated_at before update on public.review_blocks for each row execute function public.review_set_updated_at();
drop trigger if exists review_annotations_updated_at on public.review_annotations;
create trigger review_annotations_updated_at before update on public.review_annotations for each row execute function public.review_set_updated_at();
drop trigger if exists review_progress_updated_at on public.review_progress;
create trigger review_progress_updated_at before update on public.review_progress for each row execute function public.review_set_updated_at();

alter table public.review_programs enable row level security;
alter table public.review_subjects enable row level security;
alter table public.review_profiles enable row level security;
alter table public.review_assignments enable row level security;
alter table public.review_documents enable row level security;
alter table public.review_blocks enable row level security;
alter table public.review_assignment_documents enable row level security;
alter table public.review_annotations enable row level security;
alter table public.review_progress enable row level security;
alter table public.review_events enable row level security;
alter table public.review_exports enable row level security;
alter table public.review_interim_reports enable row level security;

-- Browser users call the Edge Function only. Direct PostgREST table access is denied,
-- preventing bulk enumeration of review content even when a JWT is valid.
revoke all on table
  public.review_programs,
  public.review_subjects,
  public.review_profiles,
  public.review_assignments,
  public.review_documents,
  public.review_blocks,
  public.review_assignment_documents,
  public.review_annotations,
  public.review_progress,
  public.review_events,
  public.review_exports,
  public.review_interim_reports
from anon, authenticated;

grant all on table
  public.review_programs,
  public.review_subjects,
  public.review_profiles,
  public.review_assignments,
  public.review_documents,
  public.review_blocks,
  public.review_assignment_documents,
  public.review_annotations,
  public.review_progress,
  public.review_events,
  public.review_exports,
  public.review_interim_reports
to service_role;
grant usage, select on sequence public.review_events_id_seq to service_role;

insert into public.review_programs (id, name, sort_order) values
  ('civil', '공무원시험 대비', 10),
  ('elementary', '초등교원임용고사 대비', 20),
  ('secondary', '중등교원임용고사 대비', 30)
on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.review_subjects (program_id, code, name, sort_order) values
  ('civil', 'constitution', '헌법', 10),
  ('civil', 'economics', '경제학원론', 20),
  ('civil', 'administrative-law', '행정법총론', 30),
  ('civil', 'public-administration', '행정학개론', 40),
  ('elementary', 'integrated-curriculum', '초등 교육과정 통합', 10),
  ('elementary', 'teacher-essay', '교직논술', 20),
  ('elementary', 'kindergarten', '유치원', 30),
  ('elementary', 'elementary-special', '초등특수', 40),
  ('secondary', 'korean', '국어', 10),
  ('secondary', 'english', '영어', 20),
  ('secondary', 'mathematics', '수학', 30),
  ('secondary', 'history', '역사', 40),
  ('secondary', 'general-social-studies', '일반사회', 50),
  ('secondary', 'ethics', '도덕·윤리', 60),
  ('secondary', 'physical-education', '체육', 70),
  ('secondary', 'mechanical-engineering', '기계', 80),
  ('secondary', 'plant-resources-landscape', '식물자원·조경', 90),
  ('secondary', 'commerce', '상업', 100),
  ('secondary', 'life-science', '생명과학', 110),
  ('secondary', 'information-computer', '정보·컴퓨터', 120),
  ('secondary', 'chinese', '중국어', 130),
  ('secondary', 'education-essay', '교육학논술', 140),
  ('secondary', 'music', '음악', 150),
  ('secondary', 'health', '보건', 160),
  ('secondary', 'art', '미술', 170),
  ('secondary', 'nutrition', '영양', 180),
  ('secondary', 'professional-counseling', '전문상담', 190)
on conflict (program_id, code) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-masters',
  'review-masters',
  false,
  104857600,
  array['application/pdf', 'application/zip', 'application/octet-stream']
)
on conflict (id) do update set public = false;

-- No storage.objects policy is intentionally created. Only the service-role Edge Function
-- and trusted ingestion tools may access original masters.
