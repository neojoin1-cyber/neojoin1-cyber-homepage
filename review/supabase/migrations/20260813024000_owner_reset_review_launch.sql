-- Product-owner confirmed that no professional reviewer has begun review work.
-- Preserve reviewer profiles, contracts, assignments and document allocations,
-- while resetting every active assignment to the manager-controlled start queue.

create temporary table review_owner_reset_candidates on commit drop as
select assignment.id, assignment.reviewer_user_id, assignment.status as previous_status
from public.review_assignments assignment
where assignment.status <> 'revoked';

delete from public.review_annotations annotation
where annotation.assignment_id in (
  select id from review_owner_reset_candidates
);

delete from public.review_progress progress
where progress.assignment_id in (
  select id from review_owner_reset_candidates
);

delete from public.review_interim_reports interim
where interim.assignment_id in (
  select id from review_owner_reset_candidates
);

delete from public.review_exports export
where export.assignment_id in (
  select id from review_owner_reset_candidates
);

update public.review_assignment_documents link
set visible_from = null
where link.assignment_id in (
  select id from review_owner_reset_candidates
);

update public.review_assignments assignment
set status = 'prepared',
    started_at = null,
    notification_sent_at = null,
    submitted_at = null
where assignment.id in (
  select id from review_owner_reset_candidates
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
  'assignment_owner_reset',
  jsonb_build_object(
    'reason', 'product_owner_confirmed_no_review_started',
    'previousStatus', candidate.previous_status,
    'restoredStatus', 'prepared',
    'notificationStatus', 'held_until_individual_start'
  )
from review_owner_reset_candidates candidate;
