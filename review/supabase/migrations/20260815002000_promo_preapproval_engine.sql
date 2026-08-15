-- Durable state for the publicity office pre-approval engine.
-- The engine may prepare and verify items, but can never approve or publish them.

alter table public.promo_items
  add column if not exists engine_stage text not null default 'queued'
    check (engine_stage in ('queued', 'drafting', 'verifying', 'waiting_external', 'ready_for_approval', 'needs_owner', 'approved', 'stopped')),
  add column if not exists engine_last_action text not null default '',
  add column if not exists engine_next_action text not null default '홍보실 자동 점검 대기',
  add column if not exists engine_blocker text not null default '',
  add column if not exists engine_last_run_at timestamptz,
  add column if not exists engine_next_run_at timestamptz not null default now(),
  add column if not exists engine_claimed_by text,
  add column if not exists engine_lease_until timestamptz,
  add column if not exists engine_attempt_count integer not null default 0 check (engine_attempt_count >= 0),
  add column if not exists engine_evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(engine_evidence) = 'array');

update public.promo_items
set
  engine_stage = case
    when status = 'approved' then 'approved'
    when status = 'rejected' then 'stopped'
    else 'queued'
  end,
  engine_next_action = case
    when status = 'approved' then '대표 승인 완료'
    when status = 'rejected' then '대표 반려로 중단'
    else '홍보실이 문안·근거·무료 경로를 자동 점검'
  end,
  engine_next_run_at = case when status in ('approved', 'rejected') then now() + interval '100 years' else now() end,
  engine_claimed_by = null,
  engine_lease_until = null;

create index if not exists promo_items_preapproval_due_idx
  on public.promo_items (engine_stage, engine_next_run_at, due)
  where status in ('draft', 'review', 'hold');

comment on column public.promo_items.engine_stage is 'Pre-approval preparation only; ready_for_approval still requires an explicit manager approval action.';
comment on column public.promo_items.engine_evidence is 'Non-personal verification references used to justify release gates.';
