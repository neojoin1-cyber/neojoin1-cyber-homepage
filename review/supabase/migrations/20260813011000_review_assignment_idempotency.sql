-- Remove only later, untouched duplicates; keep the oldest assignment and every audit event.
with ranked_prepared as (
  select
    a.id,
    row_number() over (
      partition by a.reviewer_user_id, a.subject_id, a.exam_track, a.starts_at, a.ends_at
      order by a.created_at asc, a.id asc
    ) as duplicate_rank
  from public.review_assignments a
  where a.status = 'prepared'
    and a.started_at is null
    and a.notification_sent_at is null
), safe_empty_duplicates as (
  select ranked.id
  from ranked_prepared ranked
  where ranked.duplicate_rank > 1
    and not exists (select 1 from public.review_progress p where p.assignment_id = ranked.id)
    and not exists (select 1 from public.review_annotations n where n.assignment_id = ranked.id)
    and not exists (select 1 from public.review_interim_reports i where i.assignment_id = ranked.id)
    and not exists (select 1 from public.review_exports e where e.assignment_id = ranked.id)
    and not exists (select 1 from public.review_change_history h where h.assignment_id = ranked.id)
)
delete from public.review_assignments assignment
using safe_empty_duplicates duplicate
where assignment.id = duplicate.id;

create unique index if not exists review_assignments_active_schedule_unique_idx
  on public.review_assignments (reviewer_user_id, subject_id, exam_track, starts_at, ends_at)
  where status <> 'revoked';

comment on index public.review_assignments_active_schedule_unique_idx is
  'Prevents duplicate active assignments for the same reviewer, subject, exam track, and schedule.';
