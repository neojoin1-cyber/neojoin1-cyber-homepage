import test from 'node:test';
import assert from 'node:assert/strict';
import { assessStudentEligibility } from './student_job_eligibility.mjs';
import { normalizeItem, studentRecruitPriority, applyPublicationSafetyGuards, validateRecruitRoleFixtures, validateStudentPriorityFixtures, extractJobAlioQualification } from './fetch_vocational_jobs.mjs';

const base = { title: '신입직원 채용', education: '학력무관', career: '신입', recruitField: '행정직', qualification: '학력 및 경력 제한 없음. 신입 지원 가능.' };
const nibp = { ...base, title: '국가생명윤리정책원 제2026-3차 직원 채용 공고', company: '국가생명윤리정책원',
  education: '학력무관,중졸이하,고졸,대졸(2~3년),대졸(4년),석사,박사', career: '신입+경력', recruitField: '행정직,연구직,전산직',
  qualification: 'ㅇ 연구직(정규직) 5급(A07) - 생명윤리 관련분야 석사학위 소지자 또는 학사학위 취득 전·후 2년 이상 업무 경력자 ㅇ 행정직(정규직) 5급(A08) - 채용 예정 직무 경력 1년 이상 경력자 ㅇ 전산직(정규직) 5급(A09) - 채용 예정 직무 경력 1년 이상 경력자 ㅇ 행정직(계약직) 5급(B10) - 채용 예정 직무 경력 1년 이상 경력자 ㅇ 행정직(계약직) 5급(B11) - 채용 예정 직무 경력 1년 이상 경력자 ㅇ 전산직(계약직) 5급(B12) - 채용 예정 직무 경력 1년 이상 경력자' };

test('real regression: six degree/experienced positions cannot become a high-school recommendation', () => {
  const a = assessStudentEligibility(nibp);
  assert.equal(a.status, 'ineligible');
  assert.equal(a.roleEvidence.length, 6);
  assert.equal(a.eligibleRoles.length, 0);
  const item = normalizeItem({ ...nibp, source: 'job-alio-openapi', sourceName: '잡알리오', sourceId: '304793', url: 'https://job.alio.go.kr/recruitview.do?idx=304793', deadline: '2027-09-23' });
  assert.equal(item.studentChannelAssessment.hardBlocked, true);
  assert.equal(item.studentPriority.tier, 10);
  assert.equal(applyPublicationSafetyGuards([item]).items.length, 0);
});

const cases = [
  ['고졸 신입', { ...base, education: '고졸', qualification: '고등학교 졸업예정자 신입 채용' }, 'eligible'],
  ['학력무관 신입', base, 'eligible'],
  ['학력 체크리스트만 존재', { ...base, education: nibp.education, career: '신입+경력', qualification: '', title: '직원 채용' }, 'review'],
  ['혼합 학력 체크리스트와 근무일만으로 지원 가능 판정 금지', { ...base, education: nibp.education, qualification: '채용 예정일 즉시 근무 가능한 자' }, 'review'],
  ['학력무관이 경력 필수를 무효화하지 않음', { ...base, qualification: '학력무관. 해당 직무 경력 1년 이상 경력자' }, 'ineligible'],
  ['고졸 경력 필수', { ...base, education: '고졸', qualification: '고졸 이상, 2년 이상 업무 경력자' }, 'ineligible'],
  ['고졸 후 교육 또는 실무경력', { ...base, education: '고졸', qualification: '고등학교 졸업 후 4년 이상 교육 또는 해당 분야 실무 경력 가진 사람' }, 'ineligible'],
  ['공통 법령 문구 뒤의 경력조건', { ...base, qualification: '공통: 국가공무원법 제33조 결격사유 없음. 채용 분야 응시자격: 실무 경력 2년 이상' }, 'ineligible'],
  ['학사 후 경력', { ...base, qualification: '학사학위 취득 후 관련 업무 2년 이상 경력자' }, 'ineligible'],
  ['석사 또는 경력', { ...base, qualification: '석사 이상 또는 관련 직무 경력 3년 이상' }, 'ineligible'],
  ['전문학사 필수', { ...base, qualification: '전문학사 학위 소지자' }, 'ineligible'],
  ['경력 우대는 지원 제한이 아님', { ...base, qualification: '학력무관 신입. 우대사항: 금융권 근무경력 1년 이상' }, 'eligible'],
  ['학위 우대는 지원 제한이 아님', { ...base, qualification: '학력무관 신입. 석사학위 소지자 우대.' }, 'eligible'],
  ['경력 필수 뒤 우대 문구로 제한을 지우면 안 됨', { ...base, qualification: '지원자격: 해당 직무 경력 1년 이상. 우대사항: 자격증 소지자' }, 'ineligible'],
  ['같은 줄의 우대 문구가 필수 경력을 지우면 안 됨', { ...base, qualification: '지원자격 경력 2년 이상 필수 자격증 소지자 우대' }, 'ineligible'],
  ['기존 요약문은 자격 원문을 대신하지 못함', { ...base, qualification: '', detailText: '학력무관 신입' }, 'review'],
  ['첨부 확인 필요', { ...base, qualification: '응시자격은 첨부 공고문 참조' }, 'review'],
  ['잘린 자격', { ...base, qualification: '학력무관 신입. 세부 자격…' }, 'review'],
  ['기능사 취득 학생 허용', { ...base, qualification: '고졸 신입. 전기기능사 자격증 소지자' }, 'eligible'],
  ['기사 제한', { ...base, qualification: '전기기사 자격증 소지자' }, 'ineligible'],
  ['기사 자격증 등 소지자', { ...base, qualification: '해당 분야 기사 자격증 등 소지자' }, 'ineligible'],
  ['공통 첨부 참조를 직렬명으로 우회할 수 없음', { ...base, qualification: '※ 응시자격은 첨부 공고문 참조. 행정직(6급): 해당 직급 응시자격 충족자' }, 'review'],
  ['자격증 목록 앞에 소지 조건이 있는 경우', { ...base, qualification: '아래 자격증 중 하나 이상 소지자: 전기기사, 전기공사기사' }, 'ineligible'],
  ['경력직 필드 제한', { ...base, career: '경력', qualification: '학력무관' }, 'ineligible'],
  ['혼합 직렬의 고졸 신입을 보존', { ...base, career: '신입+경력', recruitField: '연구직,행정직', qualification: '연구직: 석사학위 소지자. 행정직: 고졸 신입, 경력무관' }, 'eligible'],
  ['혼합 직렬의 이름만으로 구제 금지', { ...base, career: '신입+경력', recruitField: '연구직,행정직', qualification: '연구직: 석사학위 소지자. 행정직: 별첨 자격요건 참조' }, 'ineligible'],
];
for (const [name, raw, status] of cases) test(name, () => assert.equal(assessStudentEligibility(raw).status, status));

test('mixed education checklist never earns a core high-school badge', () => {
  const item = normalizeItem({ ...base, education: nibp.education, employmentType: '정규직', source: 'job-alio-openapi', sourceName: '잡알리오', sector: 'public-institution', url: 'https://job.alio.go.kr/', deadline: '2027-09-23' });
  assert.notEqual(studentRecruitPriority(item).tier, 0);
});

test('normalization cannot promote an old abbreviated summary to complete qualification evidence', () => {
  const item = normalizeItem({ ...base, qualification: '', detailText: '학력무관 신입', source: 'job-alio-openapi', sourceId: 'old-summary', url: 'https://job.alio.go.kr/', deadline: '2027-09-23' });
  assert.equal(item.qualificationEvidenceIncomplete, true);
  assert.equal(applyPublicationSafetyGuards([item]).items.length, 0);
});

test('a restricted high-school position cannot lend its core badge to another open position', () => {
  const proof = assessStudentEligibility({ ...base, recruitField: '행정직,기술직', qualification: '행정직: 학력무관 신입. 기술직: 고졸이며 경력 3년 이상 필수' });
  assert.equal(proof.status, 'eligible');
  assert.deepEqual(proof.eligibleRoles, ['행정직']);
  assert.equal(proof.explicitHighSchool, false);
});

test('same-name positions are not all advertised when only one is eligible', () => {
  const proof = assessStudentEligibility({ ...base, qualification: '행정직(A01): 고졸 신입. 행정직(A02): 학사학위 소지자' });
  assert.deepEqual(proof.eligibleRoles, []);
});

test('mixed fifth/eighth-grade recruitment keeps the actual high-school track only', () => {
  const proof = assessStudentEligibility({ ...base, education: nibp.education, qualification: '○ 5급 공채 학력무관 신입. 해당 분야 기사 자격증 등 소지자. ○ 8급공채 고등학교 졸업예정자, 기능사 이상 자격증 소지자' });
  assert.equal(proof.status, 'eligible');
  assert.deepEqual(proof.eligibleRoles, ['8급공채']);
  assert.equal(proof.explicitHighSchool, true);
});
test('cached false positive is rechecked before publication', () => {
  const item = { ...nibp, id: 'legacy', sourceName: '잡알리오', url: 'https://job.alio.go.kr/', verifiedAt: new Date().toISOString(), status: 'active', processTrack: 'direct-interview', studentChannelAssessment: { hardBlocked: false }, studentPriority: { tier: 0 } };
  assert.equal(applyPublicationSafetyGuards([item]).items.length, 0);
});
test('existing role and priority behavior', () => { validateRecruitRoleFixtures(); validateStudentPriorityFixtures(); });
test('qualification section is not cut at words inside its paragraph', () => {
  const html = '<h4>응시자격</h4><p>공통: 결격사유에 해당하지 않는 자<br>행정직: 업무 경력 1년 이상</p><h4>결격사유</h4><p>별도 제외 조항</p>';
  const text = extractJobAlioQualification(html);
  assert.match(text, /업무 경력 1년 이상/);
  assert.doesNotMatch(text, /별도 제외/);
});
