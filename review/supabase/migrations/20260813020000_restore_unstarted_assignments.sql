-- Restore legacy assignments that were never explicitly launched by the manager.
-- Only untouched rows with no launch timestamp or notification are eligible.

create temporary table review_unstarted_assignment_candidates on commit drop as
select assignment.id, assignment.reviewer_user_id, assignment.status as previous_status
from public.review_assignments assignment
where assignment.status in ('assigned', 'reviewing')
  and assignment.started_at is null
  and assignment.notification_sent_at is null
  and assignment.submitted_at is null
  and not exists (
    select 1 from public.review_progress progress
    where progress.assignment_id = assignment.id
  )
  and not exists (
    select 1 from public.review_annotations annotation
    where annotation.assignment_id = assignment.id
  )
  and not exists (
    select 1 from public.review_interim_reports interim
    where interim.assignment_id = assignment.id
  )
  and not exists (
    select 1 from public.review_exports export
    where export.assignment_id = assignment.id
  );

update public.review_assignment_documents link
set visible_from = null
where link.assignment_id in (
  select id from review_unstarted_assignment_candidates
);

update public.review_assignments assignment
set status = 'prepared',
    started_at = null,
    notification_sent_at = null,
    submitted_at = null
where assignment.id in (
  select id from review_unstarted_assignment_candidates
);

insert into public.review_events (
  assignment_id,
  reviewer_user_id,
  event_type,
  payload
)
select
  candidate.id,
  candidate.reviewer_user_id,
  'assignment_state_corrected',
  jsonb_build_object(
    'reason', 'legacy_status_without_manager_launch',
    'previousStatus', candidate.previous_status,
    'restoredStatus', 'prepared',
    'notificationStatus', 'held_until_individual_start'
  )
from review_unstarted_assignment_candidates candidate;

