create table if not exists public.review_notification_archive (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.review_assignments(id) on delete cascade,
  notification_type text not null check (notification_type in ('assignment_start', 'supplemental_guide', 'status_change')),
  channel text not null default 'email' check (channel in ('email')),
  recipient_email text not null,
  recipient_name text,
  subject text not null,
  html_body text not null,
  text_body text,
  template_version text not null,
  provider text,
  provider_message_id text,
  delivery_status text not null default 'service_accepted',
  sent_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (assignment_id, notification_type, recipient_email)
);

create index if not exists review_notification_archive_assignment_idx
  on public.review_notification_archive (assignment_id, sent_at desc);

alter table public.review_notification_archive enable row level security;
revoke all on table public.review_notification_archive from anon, authenticated;

comment on table public.review_notification_archive is
  'Representative-only archive of exact operational email content. Accessed only through the manager-authorized Edge Function.';
