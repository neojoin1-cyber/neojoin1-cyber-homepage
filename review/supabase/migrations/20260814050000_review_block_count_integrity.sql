create or replace function public.review_block_counts(p_document_ids uuid[])
returns table(document_id uuid, block_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select b.document_id, count(*)::bigint as block_count
  from public.review_blocks b
  where b.document_id = any(coalesce(p_document_ids, array[]::uuid[]))
  group by b.document_id;
$$;

revoke all on function public.review_block_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.review_block_counts(uuid[]) to service_role;

comment on function public.review_block_counts(uuid[]) is
  '관리자 검수 현황과 시작 전 무결성 점검을 위한 문서별 실제 검수 문단 수 집계';
