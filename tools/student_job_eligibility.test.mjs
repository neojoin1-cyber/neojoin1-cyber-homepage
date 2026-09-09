import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyReviewedAttachment } from './reviewed_job_evidence.mjs';
import { buildFeedHealth, extractJobAlioSection, dedupeAndSortAll } from './fetch_vocational_jobs.mjs';
import { assessStudentEligibility } from './student_job_eligibility.mjs';
import { normalizeItem, buildStudentChannelAssessment, studentRecruitPriority, applyPublicationSafetyGuards, validateRecruitRoleFixtures, validateStudentPriorityFixtures, extractJobAlioQualification } from './fetch_vocational_jobs.mjs';

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

test('MPM headcount rows do not prove role eligibility when qualifications are in attachments', () => {
  const a = assessStudentEligibility({ title: '한국전력기술(주) 정규직 신입사원 채용공고',
    qualification: '1. 채용인원 : 총 109명 ○ 대졸수준 : 90명 ○ 고졸 : 5명 ○ 보훈 : 12명 ○ 장애인 : 2명 2. 채용공고문 및 직무기술서 : 붙임 참조 5. 응시자격 ○ (공통) 입사 예정일에 근무가 가능한 자 ○ (분야별) 붙임 참조' });
  assert.notEqual(a.status, 'eligible');
  assert.equal(a.eligibleRoles.length, 0);
  assert.notEqual(assessStudentEligibility({ ...base, qualification: '고졸 신입. 분야별 자격은 붙임 참조' }).status, 'eligible');
});
test('IBK 304338: high-school track is independent of regional/general track references', () => {
  const raw = { title: '2026년 하반기 IBK기업은행 신입행원 채용공고', company: '중소기업은행', career: '신입',
    qualification: 'ㅇ 금융일반, 디지털, IT 분야 - 학력, 연령, 성별 등 제한사항 없음 - 남성의 경우 병역필 또는 면제자. 고졸인재 분야 지원자는 해당 없음 ※ 지역인재의 경우, 공고문 참조 ㅇ 고졸인재 분야 - 고등학교 졸업 예정자 (졸업 예정월: 27년 2월) - 채용 확정 후 전일 근무 가능한 자 - 당행 인사규정 「채용의 제한」 대상자 등(공고문 內 “유의사항” 참조)이 아닌 자' };
  const proof = assessStudentEligibility(raw);
  assert.equal(proof.status, 'eligible'); assert.equal(proof.explicitHighSchool, true);
  assert.deepEqual(proof.eligibleRoles, ['고졸인재 분야']);
  assert.doesNotMatch(proof.eligibleEvidence, /병역필|지역인재/);
  assert.notEqual(assessStudentEligibility({ ...raw, qualification: raw.qualification.replace('고등학교 졸업 예정자', '지원자격은 첨부 공고문 참조') }).status, 'eligible');
});

const cases = [
  ['고졸 신입', { ...base, education: '고졸', qualification: '고등학교 졸업예정자 신입 채용' }, 'eligible'],
  ['학력무관 신입', base, 'eligible'],
  ['학력 체크리스트만 존재', { ...base, education: nibp.education, career: '신입+경력', qualification: '', title: '직원 채용' }, 'review'],
  ['혼합 학력 체크리스트와 근무일만으로 지원 가능 판정 금지', { ...base, education: nibp.education, qualification: '채용 예정일 즉시 근무 가능한 자' }, 'review'],
  ['대졸 단독 학력 필드는 고졸 제목보다 우선', { ...base, title: '고졸 관련 신입 채용', education: '대졸(4년)' }, 'ineligible'],
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
test('Busan Port Authority: Korean bullet roles keep technical licenses out of high-school office requirements', () => {
  const raw = { ...base, company: '부산항만공사', recruitField: '경영·회계·사무,건설', education: nibp.education,
    qualification: '[공통] ○ 학력ㆍ성별ㆍ전공 등 제한 없음 ○ 남성 병역필 또는 면제자, 고졸 분야 지원 시 병역 미필자 가능 ○ 한국사능력검정시험 3급 이상 합격자 [사무] ㅇ 사무(고졸) : 최종학력이 고등학교 졸업 또는 졸업예정인 자 ㅇ 사무(취업지원) : 보훈관계법률에 의한 취업지원 대상자 [기술] ㅇ 기술(토목) : 토목산업기사 이상 자격증 보유자 ㅇ 기술(건축) : 건축산업기사 이상 자격증 보유자' };
  const proof = assessStudentEligibility(raw);
  assert.equal(proof.status, 'eligible');
  assert.deepEqual(proof.eligibleRoles, ['사무(고졸)']);
  assert.equal(proof.explicitHighSchool, true);
  assert.doesNotMatch(proof.eligibleEvidence, /산업기사/);
  const assessment = buildStudentChannelAssessment(raw, { processTrack: 'exam-formal' });
  assert.equal(assessment.militaryCompletionRequired, false);
  assert.equal(assessment.militaryUnservedEligible, true);
  assert.equal(assessment.explicitHighSchoolGraduateCandidate, true);
  const withoutException = buildStudentChannelAssessment({ ...raw, qualification: raw.qualification.replace(', 고졸 분야 지원 시 병역 미필자 가능', '') }, { processTrack: 'exam-formal' });
  assert.equal(withoutException.militaryCompletionRequired, true);
  assert.notEqual(assessStudentEligibility({ ...raw, qualification: raw.qualification.replace('[공통]', '[공통] 관련 업무 경력 2년 이상 필수.') }).status, 'eligible');
  assert.notEqual(assessStudentEligibility({ ...raw, qualification: raw.qualification.replace('최종학력이 고등학교 졸업 또는 졸업예정인 자', '고졸 신입, 해당 업무 경력 1년 이상 필수') }).status, 'eligible');
});
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

test('another grade cannot impose its military-service restriction on the high-school track', () => {
  const assessment = buildStudentChannelAssessment({ ...base, education: nibp.education, qualification: '○ 5급 공채 학력무관 신입. 기사 자격증 등 소지자. 남자는 병역필 또는 면제자. ○ 8급공채 고등학교 졸업예정자. 기능사 이상. 병역 제한 없음.' }, { processTrack: 'exam-formal' });
  assert.equal(assessment.militaryCompletionRequired, false);
  assert.equal(assessment.militaryUnservedEligible, true);
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

test('military no-evasion clause cannot override mandatory completed service', () => {
  const result = buildStudentChannelAssessment({ ...base, qualification: '학력무관 신입. 병역기피 사실이 없는 자. 남자는 병역필 또는 면제자.' }, {});
  assert.equal(result.militaryCompletionRequired, true);
  assert.equal(result.militaryUnservedEligible, false);
});
test('parenthetical grade exception cannot cut off shared requirements', () => {
  const raw = { ...base, recruitField: '사무직,심사직', qualification: '(공통) 학력(사무직 6급보 제외) 제한 없음. 대한민국 국적 필수. 남자는 병역필 또는 면제자. (6급 사무직 일반) 공통 지원자격 외 별도의 응시자격 없음 (6급 심사직) 간호사 면허 소지자, 관련 업무 1년 이상 경력자' };
  const proof = assessStudentEligibility(raw);
  assert.match(proof.eligibleEvidence, /대한민국 국적 필수/);
  assert.equal(buildStudentChannelAssessment(raw, {}).militaryCompletionRequired, true);
  const restricted = { ...raw, qualification: raw.qualification.replace('대한민국 국적 필수', '관련 업무 2년 이상 경력 필수') };
  assert.notEqual(assessStudentEligibility(restricted).status, 'eligible');
});
test('mandatory experience after preference section is not erased (KEPCO KDN regression)', () => {
  const raw = { ...base, qualification: '학력, 연령 제한없음. 3. 우대사항: 컴퓨터 관련 경력자, 자격증 소지자. 4. 자격 · 필수 : OA설비 유지보수 또는 통신공사 현장 실무 경력 (1년 이상, 경력증명서)' };
  assert.equal(assessStudentEligibility(raw).status, 'ineligible');
});
for (const qualification of ['디젤엔진 정비 경력 보유 및 단독작업 수행 가능자', '플랜트설비 분야 정비 유경험자', '원자력발전소 정비공사 수행 경력 보유자', '경력 (1년 이상)', '방사선사 면허증 소지자', '임상병리사 면허증 소지자']) {
  test(`non-numeric/parenthesized experience and professional license: ${qualification}`, () => {
    assert.equal(assessStudentEligibility({ ...base, qualification }).status, 'ineligible');
  });
}
test('missing military requirements are not positive evidence of unserved eligibility', () => {
  assert.equal(buildStudentChannelAssessment(base, {}).militaryUnservedEligible, false);
});
test('completed service written with the Korean object particle is mandatory', () => {
  for (const clause of ['남성의 경우 병역을 필하였거나 면제된 자', '남자의 경우 병역을 필하거나 면제된 자']) {
    const result = buildStudentChannelAssessment({ ...base, qualification: `학력무관 신입. 병역기피 사실이 없는 자. ${clause}` }, {});
    assert.equal(result.militaryCompletionRequired, true);
    assert.equal(result.militaryUnservedEligible, false);
  }
});
test('age extension for veterans does not imply mandatory military service', () => {
  assert.equal(buildStudentChannelAssessment({ ...base, qualification: '학력무관 신입. 만19세 이상 만34세 이하. 군필자는 해당 법률에 따라 연령 연장.' }, {}).militaryCompletionRequired, false);
});
test('process paragraph survives the word notice before the written test', () => {
  assert.match(extractJobAlioSection('<h4>전형절차/방법</h4><p>공고문 확인. 서류전형 다음 필기시험(NCS), 면접</p><h4>공고문</h4>', '전형절차/방법'), /필기시험/);
});
test('partial source failures and missing integrations remain visible', () => {
  const health = buildFeedHealth({ summary: { total: 3 }, sourceStatus: [
    { id: 'partial', configured: true, ok: true, failedUrlCount: 2 },
    { id: 'missing', configured: false }
  ], qualificationReview: [{ status: 'review' }] });
  assert.equal(health.status, 'degraded');
  assert.equal(health.coverage.exhaustive, false);
  assert.equal(health.coverage.qualificationPending, 1);
  assert.equal(health.coverage.unconfiguredSources.length, 1);
});
test('education heading cannot become an eligible role', () => {
  const proof = assessStudentEligibility({ ...base, qualification: '□ 학력 : 제한없음 □ 지원자격 ○ 전기 : 산업기사 이상' });
  assert.notEqual(proof.status, 'eligible');
  assert.ok(!proof.eligibleRoles.includes('학력'));
});
test('unresolved role qualifications and exceptions remain held', () => {
  for (const qualification of ['학력무관. 직종별 자격 및 상세 사항은 모집공고 지원자격 참조', '학력 제한 없음. 단 채용분야별 응시요건에 따라 일부 예외']) {
    assert.equal(assessStudentEligibility({ ...base, qualification }).status, 'review');
  }
});
test('disability-only opportunity remains available but never receives a general core badge', () => {
  const item = normalizeItem({ ...base, source: 'job-alio-openapi', sourceName: '잡알리오', sourceId: 'conditional',
    title: '고졸 신입 채용', qualification: '고졸 신입. 장애인복지법에 따른 장애인. 병역 제한 없음.',
    url: 'https://job.alio.go.kr/', deadline: '2099-09-28', employmentType: '정규직' });
  assert.equal(item.studentChannelAssessment.qualificationAssessment.status, 'eligible');
  assert.equal(item.studentPriority.tier, 8);
  assert.match(item.studentPriority.label, /자격제한/);
  assert.ok(item.studentConditions.length);
});

const officialNotices = JSON.parse(fs.readFileSync(new URL('./fixtures/official-highschool-notices.json', import.meta.url)));
const restrictedNotices = JSON.parse(fs.readFileSync(new URL('./fixtures/official-restricted-notices.json', import.meta.url)));
for (const raw of restrictedNotices) {
  test(`official experience/license regression: ${raw.company} ${raw.sourceId}`, () => {
    assert.notEqual(assessStudentEligibility(raw).status, 'eligible');
    const result = applyPublicationSafetyGuards([normalizeItem({ ...raw, deadline: '2099-09-28' })]);
    assert.equal(result.items.length, 0);
  });
}
for (const original of officialNotices) {
  test(`official attachment gold case: ${original.company}`, () => {
    const raw = { ...original, deadline: '2099-09-28' };
    const item = normalizeItem(raw);
    const result = applyPublicationSafetyGuards([item]);
    assert.equal(result.items.length, 1, JSON.stringify(result.report.blockedByReason));
    assert.equal(item.processTrack, 'exam-formal');
    assert.ok(item.studentConditions.length >= 3);
    assert.ok(item.roleEligibility.eligibleRoles.length);
    assert.ok(item.roleEligibility.eligibleRoles.every((role) => /고졸|고교/.test(role)));
    assert.doesNotMatch(item.processLabels.join(' '), /학생추천 제외/);
    const coarseApi = { ...item, source: 'moef-public-recruit', id: `coarse-${item.id}`, reviewedAttachment: null,
      fitScore: 100, sourceVerification: { doubleCheckStatus: 'company_notice_confirmed' },
      qualificationText: '석사학위 이상 또는 관련 경력 2년 이상',
      studentChannelAssessment: { qualificationAssessment: { status: 'ineligible' } } };
    for (const candidates of [[coarseApi, item], [item, coarseApi]]) {
      assert.equal(dedupeAndSortAll(candidates)[0].id, item.id, 'verified role-specific attachment must survive cross-source deduplication');
    }
    const changed = structuredClone(applyReviewedAttachment(raw));
    changed.qualificationAttachments[0].sha256 = 'changed';
    assert.equal(assessStudentEligibility(changed).status, 'review');
    assert.equal(applyPublicationSafetyGuards([normalizeItem(changed)]).items.length, 0);
    const missing = { ...raw, qualificationAttachments: [] };
    assert.notEqual(assessStudentEligibility(missing).status, 'eligible');
    const swapped = { ...raw, sourceId: '304793' };
    assert.notEqual(assessStudentEligibility(swapped).status, 'eligible');
  });
}
