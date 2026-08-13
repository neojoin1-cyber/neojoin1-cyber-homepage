create table if not exists public.review_runtime_controls (
  id text primary key check (id = 'default'),
  access_enabled boolean not null default false,
  launch_enabled boolean not null default false,
  updated_by uuid references public.review_profiles(user_id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.review_runtime_controls (id, access_enabled, launch_enabled)
values ('default', false, false)
on conflict (id) do nothing;

alter table public.review_runtime_controls enable row level security;
revoke all on table public.review_runtime_controls from anon, authenticated;
grant all on table public.review_runtime_controls to service_role;

