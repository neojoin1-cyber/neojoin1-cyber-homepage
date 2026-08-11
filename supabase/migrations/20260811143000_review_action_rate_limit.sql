-- Durable per-reviewer action budget. The fixed hourly row prevents request
-- tracking itself from becoming an unbounded write-amplification vector.
create table if not exists public.review_action_limits (
  reviewer_user_id uuid not null references public.review_profiles(user_id) on delete cascade,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  last_action text not null default '',
  updated_at timestamptz not null default now(),
  primary key (reviewer_user_id, bucket_start)
);

alter table public.review_action_limits enable row level security;
revoke all on table public.review_action_limits from anon, authenticated;
grant all on table public.review_action_limits to service_role;

create or replace function public.review_consume_action(
  p_user_id uuid,
  p_action text,
  p_limit integer default 600
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_bucket timestamptz := date_trunc('hour', now());
  v_count integer;
begin
  if p_user_id is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'review_rate_limit_invalid';
  end if;

  insert into public.review_action_limits (reviewer_user_id, bucket_start, request_count, last_action, updated_at)
  values (p_user_id, v_bucket, 1, left(coalesce(p_action, ''), 80), now())
  on conflict (reviewer_user_id, bucket_start) do update
    set request_count = public.review_action_limits.request_count + 1,
        last_action = excluded.last_action,
        updated_at = now()
    where public.review_action_limits.request_count < p_limit
  returning request_count into v_count;

  if v_count is null then
    raise exception 'review_rate_limit_exceeded';
  end if;

  delete from public.review_action_limits
  where reviewer_user_id = p_user_id
    and bucket_start < v_bucket - interval '48 hours';
end;
$$;

revoke all on function public.review_consume_action(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.review_consume_action(uuid, text, integer) to service_role;
