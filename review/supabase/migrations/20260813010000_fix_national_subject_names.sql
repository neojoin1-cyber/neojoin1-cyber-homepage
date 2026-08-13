begin;

update public.review_programs
set name = '국가직 7급 공무원시험 대비'
where id = 'civil';

update public.review_subjects
set name = case code
  when 'constitution' then '헌법'
  when 'administrative-law' then '행정법'
  when 'public-administration' then '행정학'
  when 'economics' then '경제학'
  else name
end
where program_id = 'civil'
  and code in ('constitution', 'administrative-law', 'public-administration', 'economics');

update public.review_documents d
set title = case s.code
  when 'administrative-law' then replace(d.title, '[국가직 7급] 행정법총론', '[국가직 7급] 행정법')
  when 'public-administration' then replace(d.title, '[국가직 7급] 행정학개론', '[국가직 7급] 행정학')
  when 'economics' then replace(d.title, '[국가직 7급] 경제학원론', '[국가직 7급] 경제학')
  else d.title
end,
updated_at = now()
from public.review_subjects s
where d.subject_id = s.id
  and s.program_id = 'civil'
  and d.title like '[국가직 7급]%'
  and s.code in ('administrative-law', 'public-administration', 'economics');

update public.review_assignments a
set title = case s.code
  when 'administrative-law' then replace(a.title, '행정법총론', '행정법')
  when 'public-administration' then replace(a.title, '행정학개론', '행정학')
  when 'economics' then replace(a.title, '경제학원론', '경제학')
  else a.title
end,
updated_at = now()
from public.review_subjects s
where a.subject_id = s.id
  and a.exam_track = 'national'
  and s.code in ('administrative-law', 'public-administration', 'economics');

commit;
