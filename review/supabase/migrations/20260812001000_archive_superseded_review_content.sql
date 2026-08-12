-- Preserve prior snapshots while preventing accidental assignment of duplicate manuscripts.
update public.review_documents
   set status = 'archived'
 where version = '2026.08.12-web-v2'
   and status = 'review_ready';
