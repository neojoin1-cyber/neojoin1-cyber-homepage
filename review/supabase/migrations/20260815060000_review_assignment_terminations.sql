create table if not exists public.review_assignment_terminations (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.review_assignments(id) on delete restrict,
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete restrict,
  reason_code text not null check (reason_code in ('performance_impossible', 'no_response', 'contract_breach', 'security', 'mutual_agreement', 'other')),
  reason_detail text not null,
  terminated_by uuid not null references public.review_profiles(user_id) on delete restrict,
  terminated_at timestamptz not null default now(),
  notice_method text not null default 'manual' check (notice_method in ('manual', 'email', 'sms', 'eformsign', 'other')),
  notification_sent boolean not null default false,
  notification_status text not null default 'skipped',
  access_disabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_assignment_terminations_reviewer_time_idx
  on public.review_assignment_terminations (reviewer_user_id, terminated_at desc);

alter table public.review_assignment_terminations enable row level security;
revoke all on table public.review_assignment_terminations from anon, authenticated;
grant all on table public.review_assignment_terminations to service_role;

comment on table public.review_assignment_terminations is
  '전문위원 위촉 종료 사유, 처리자, 처리 시각과 접근 차단 상태를 보존하는 회사 내부 감사 기록';
