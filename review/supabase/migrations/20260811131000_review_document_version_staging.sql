begin;
alter table public.review_documents
  drop constraint if exists review_documents_status_check;
alter table public.review_documents
  add constraint review_documents_status_check
  check (status in (
    'draft',
    'staged',
    'review_ready',
    'reviewing',
    'approved',
    'superseded',
    'archived'
  ));
commit;
