import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, buildCollectionAudit, assertCollectionAudit, canonicalDate } from './job_collection_audit.mjs';
import { fetchJobAlioHighSchoolRows, parseJobAlioRows } from './job_alio_highschool_scan.mjs';
import { moefRecordToRaw, recruiterJobflexRecordToRaw, normalizeItem, mpmPageParams, studentRecruitPriority, buildJobAlioDynamicDiscovery, selectJobAlioEmployerNoticeCheckCandidates } from './fetch_vocational_jobs.mjs';
import { assessStudentEligibility } from './student_job_eligibility.mjs';

const pager = (pages, overrides = {}) => collectPages({ fetchPage: async (n) => pages[n - 1] || { records: [] },
  recordKey: (x) => x.id, pageSize: 100, maxPages: 10, ...overrides });
test('MPM uses the live-verified descending code and both date endpoints in Korea time', () => {
  const params = mpmPageParams({ Instt_se: 'g01', Pblanc_ty: 'e01' }, 2, 100, new Date('2026-09-09T16:00:00Z'));
  assert.equal(params.Sort_order, 2);
  assert.equal(params.End_de, '2026-09-10');
  assert.match(params.Begin_de, /^2026-06-/);
  assert.equal(params.pageNo, 2);
});
test('reads server-clamped pages until declared total, not requested page size', async () => {
  const result = await pager([{ records: [{ id: 1 }], totalCount: 2 }, { records: [{ id: 2 }], totalCount: 2 }]);
  assert.equal(result.complete, true); assert.equal(result.pages.length, 2);
});
test('missing total requires empty terminal page', async () => {
  const result = await pager([{ records: [{ id: 1 }] }, { records: [{ id: 2 }] }]);
  assert.equal(result.complete, true); assert.equal(result.pages.length, 3);
});
test('detects ignored page parameters instead of reporting completeness', async () => {
  const result = await pager([], { fetchPage: async () => ({ records: [{ id: 1 }], totalCount: 12 }) });
  assert.equal(result.complete, false); assert.equal(result.issues[0].type, 'repeated-page');
  assert.equal(result.missingCount, 11);
});
test('page failure preserves earlier discoveries without leaking errors', async () => {
  const result = await pager([], { fetchPage: async (n) => {
    if (n === 2) throw new Error('https://example.com/?serviceKey=private');
    return { records: [{ id: 1 }], totalCount: 2 };
  } });
  assert.equal(result.records.length, 1); assert.equal(result.complete, false);
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('page cap and premature empty are explicit unresolved coverage', async () => {
  assert.equal((await pager([{ records: [{ id: 1 }], totalCount: 10 }], { maxPages: 1 })).issues[0].type, 'page-limit');
  assert.equal((await pager([{ records: [{ id: 1 }], totalCount: 10 }])).issues[0].type, 'premature-empty-page');
});
test('invalid identities and changing totals cannot pass', async () => {
  assert.equal((await pager([{ records: [{}], totalCount: 1 }])).complete, false);
  assert.equal((await pager([{ records: [{ id: 1 }], totalCount: 2 }, { records: [{ id: 2 }], totalCount: 1 }])).complete, false);
});

const item = (sourceId, status = 'eligible') => ({ source: 'test', sourceId, id: `id-${sourceId}`,
  title: `Notice ${sourceId}`, company: 'Employer', deadline: '2026-12-01', url: 'https://example.com/notice',
  studentChannelAssessment: { qualificationAssessment: { status, reasons: [] } } });
const audit = (options) => buildCollectionAudit({ discovered: [], assessed: [], candidates: [], published: [], sources: [],
  generatedAt: '2026-09-10T00:00:00.000Z', ...options });
test('reconciliation separates published, ineligible, review, failures and deferred', () => {
  const [a, b, c] = [item('1'), item('2', 'ineligible'), item('3', 'review')];
  const result = audit({ discovered: [{ ...item('4'), collectionDisposition: 'detail-failed' }, { ...item('5'), collectionDisposition: 'deferred' }],
    assessed: [a, b, c], candidates: [a], published: [a] });
  assertCollectionAudit(result);
  assert.deepEqual(result.summary.counts, { 'detail-failed': 1, deferred: 1, published: 1, ineligible: 1, 'needs-review': 1 });
});
test('unprocessed discovery fails the publication gate', () => {
  assert.throws(() => assertCollectionAudit(audit({ discovered: [item('1')] })), /Unaccounted/);
});
test('cross-source duplicates are not silently lost', () => {
  const a = item('1'), b = { ...a, source: 'other', id: 'other-id' };
  const result = audit({ assessed: [a, b], candidates: [a, b], published: [b] });
  assert.equal(result.summary.counts.duplicate, 1);
});
test('publication loss is visible, not counted as qualification rejection', () => {
  const a = item('1');
  assert.equal(audit({ assessed: [a], candidates: [a] }).records[0].disposition, 'publication-review');
  assertCollectionAudit(audit({ assessed: [a], candidates: [a] }));
  const missingLink = { ...item('2'), url: '' };
  assert.throws(() => assertCollectionAudit(audit({ assessed: [missingLink], candidates: [missingLink],
    discovered: [missingLink] })), /Unaccounted/);
  const known = audit({ assessed: [a], candidates: [a], publicationReasons: { 'test:1': 'invalid-url' } });
  assertCollectionAudit(known);
  assert.ok(known.records[0].reasons.includes('invalid-url'));
});
test('high-school eligibility evidence marks an omitted notice for the visible review queue', () => {
  const candidate = { ...item('hs'), title: '신입 채용', education: '고등학교 졸업예정자 지원 가능',
    studentChannelAssessment: { qualificationAssessment: { status: 'eligible', explicitHighSchool: true, reasons: [] } } };
  const result = audit({ assessed: [candidate], candidates: [candidate] });
  assert.equal(result.records[0].priority, 'high');
  assert.equal(result.summary.highPriorityReview, 1);
});
test('education-open public vacancy stays in the high-priority audit queue when qualification requires review', () => {
  const candidate = { ...item('open-education'), source: 'job-alio-openapi', title: '직원 채용 공고',
    education: '학력무관', studentChannelAssessment: { qualificationAssessment: { status: 'review', reasons: [] } } };
  const result = audit({ discovered: [candidate], assessed: [candidate], candidates: [], published: [] });
  assert.equal(result.records[0].disposition, 'needs-review');
  assert.equal(result.records[0].priority, 'high');
  assert.ok(result.records[0].unresolvedSince);
});
test('unpublished recent ALIO candidates with official links are queued instead of blocking the feed', () => {
  const candidate = { source: 'job-alio-openapi', sourceId: '304899',
    title: '[세계김치연구소] 2026년 제8차 직원 채용 공고', baseTitle: '[세계김치연구소] 2026년 제8차 직원 채용 공고',
    company: '세계김치연구소', status: 'active', publishedDate: '2026-09-11', education: '학력무관',
    career: '신입+경력', employmentType: '무기계약직,비정규직', recruitField: '행정직,공무직',
    detailText: '공통 응시자격', deadline: '2026-09-28', url: 'https://job.alio.go.kr/recruitview.do?idx=304899',
    originalUrl: 'https://job.alio.go.kr/recruitview.do?idx=304899',
    studentChannelAssessment: { qualificationAssessment: { status: 'review', reasons: [] } } };
  const row = { idx: '304899', registeredAt: '2026.09.11', deadline: '26.09.28' };
  const result = buildJobAlioDynamicDiscovery([candidate], [], new Map([[row.idx, row]]), [row]);
  assert.equal(result.missingCandidateCount, 1);
  assert.equal(result.reviewQueueCount, 1);
  assert.equal(result.unaccountedCandidateCount, 0);
  assert.equal(result.reviewQueue[0].sourceId, '304899');
  assert.match(result.reviewQueue[0].url, /^https:\/\/job\.alio\.go\.kr\//);

  const noLink = buildJobAlioDynamicDiscovery([{ ...candidate, url: '', originalUrl: '' }], [],
    new Map([[row.idx, row]]), [row]);
  assert.equal(noLink.reviewQueueCount, 0);
  assert.equal(noLink.unaccountedCandidateCount, 1);
});
test('ALIO employer-page reachability checks are limited to kept student-channel candidates', () => {
  const candidate = {
    source: 'job-alio-openapi', sourceName: '잡알리오 공공기관 채용', sourceId: 'eligible-check',
    title: '2026년 신입직원 채용', company: '공기업 A', education: '고졸', career: '신입',
    employmentType: '정규직', qualification: '고등학교 졸업자 또는 졸업예정자 지원 가능. 경력 무관.',
    url: 'https://job.alio.go.kr/recruitview.do?idx=101',
    companyNoticeUrl: 'https://agency.example/recruit/view/101', deadline: '2099-12-31'
  };
  const graduateOnly = {
    ...candidate, sourceId: 'graduate-only', title: '석사 연구직 채용', education: '석사 이상',
    qualification: '석사학위 소지자 필수.'
  };
  assert.deepEqual(selectJobAlioEmployerNoticeCheckCandidates([graduateOnly, candidate]), [candidate]);
  assert.deepEqual(selectJobAlioEmployerNoticeCheckCandidates([candidate, { ...candidate, sourceId: 'second' }], 1), [candidate]);
});
test('all-employer ALIO school-filter evidence survives normalization without bypassing qualification checks', () => {
  const verified = normalizeItem({
    source: 'job-alio-openapi', sourceName: '잡알리오 공공기관 채용', sourceId: 'hs-filter-1',
    title: '2026년 신입직원 공개채용', company: '기관 A', education: '지원자격 확인', career: '신입',
    employmentType: '정규직', url: 'https://job.alio.go.kr/recruitview.do?idx=101',
    educationFilterMatch: true, scanReasons: ['education-high-school-single'],
    qualification: '고등학교 졸업자 또는 졸업예정자 지원 가능. 경력 무관.'
  });
  assert.equal(verified.highSchoolEducationFilterMatch, true);
  assert.deepEqual(verified.discoveryScanReasons, ['education-high-school-single']);
  assert.ok(verified.studentPriority.tier < 7);

  const review = normalizeItem({
    source: 'job-alio-openapi', sourceName: '잡알리오 공공기관 채용', sourceId: 'hs-filter-2',
    title: '2026년 신입직원 공개채용', company: '기관 B', education: '지원자격 확인', career: '신입',
    employmentType: '정규직', url: 'https://job.alio.go.kr/recruitview.do?idx=102',
    educationFilterMatch: true, qualificationEvidenceIncomplete: true
  });
  assert.equal(review.highSchoolEducationFilterMatch, true);
  assert.equal(review.studentChannelAssessment.qualificationAssessment.status, 'review');
  assert.equal(studentRecruitPriority({ ...review, status: 'active' }).tier, 10);
});
test('audit normalizes two-digit official list dates before active-posting checks', () => {
  assert.equal(canonicalDate('26.09.29 D-7'), '2026-09-29');
  assert.equal(canonicalDate('20260929'), '2026-09-29');
  assert.equal(canonicalDate('2026-02-30'), '');
});
const alioRow = (idx, title, company) => `<tr><td>1</td><td>2026</td><td>${title}</td><td>${company}</td><td>전국</td><td>정규직</td><td>2026.09.10</td><td>2026.09.30</td><td>접수중</td><td><a href="/recruitview.do?idx=${idx}">${title}</a></td></tr>`;
const alioResponse = (html, cookie = 'JSESSIONID=scan-session; Path=/') => ({ ok: true, status: 200, text: async () => html,
  headers: { getSetCookie: () => [cookie], get: () => cookie } });
test('ALIO high-school education filters scan every employer and both single/mixed education types', async () => {
  const requests = [];
  const pages = {
    'single:1': alioRow('101', '고졸 신입사원 채용', '공기업 A'),
    'single:2': '',
    'multi:1': alioRow('101', '고졸 신입사원 채용', '공기업 A') + alioRow('202', '하반기 신입 공채', '금융기관 B'),
    'multi:2': ''
  };
  const result = await fetchJobAlioHighSchoolRows({
    now: new Date('2026-09-20T18:00:00.000Z'), pause: async () => {},
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (!init.method) return alioResponse('<input name="_csrf" value="test-token">');
      const form = new URLSearchParams(init.body);
      assert.equal(init.headers.Cookie, 'JSESSIONID=scan-session');
      assert.equal(form.get('_csrf'), 'test-token');
      assert.equal(form.get('education'), 'R7030');
      assert.equal(['single', 'multi'].includes(form.get('eduType')), true);
      assert.equal(form.has('org_type') || form.has('org_name'), false);
      assert.equal(form.get('s_date'), '2026.06.23');
      assert.equal(form.get('e_date'), '2026.09.21');
      return alioResponse(`<table>${pages[`${form.get('eduType')}:${form.get('pageNo')}`] || ''}</table>`);
    }
  });
  assert.equal(requests.length, 5);
  assert.equal(result.pagination.complete, true);
  assert.deepEqual(result.rows.map((row) => row.idx), ['101', '202']);
  assert.deepEqual(result.rows[0].scanReasons, ['education-high-school-single', 'education-high-school-multi']);
  assert.equal(result.rows[1].company, '금융기관 B');
  assert.equal(parseJobAlioRows(alioRow('303', '제목', '기관'))[0].idx, '303');
});
test('ALIO filter pagination repetition is reported as incomplete rather than silent success', async () => {
  const repeated = alioRow('101', '고졸 신입사원 채용', '공기업 A');
  const result = await fetchJobAlioHighSchoolRows({
    maxPagesPerType: 3, pause: async () => {},
    fetchImpl: async (_url, init = {}) => {
      if (!init.method) return alioResponse('<input name="_csrf" value="">');
      const form = new URLSearchParams(init.body);
      return alioResponse(`<table>${form.get('eduType') === 'single' ? repeated : ''}</table>`);
    }
  });
  assert.equal(result.pagination.complete, false);
  assert.ok(result.pagination.issues.some((issue) => issue.type === 'repeated-page' && issue.eduType === 'single'));
});
test('repeat unresolved and disappeared active records are retained for operators', () => {
  const a = item('1', 'review');
  const previous = audit({ assessed: [a, item('2')] });
  const next = audit({ assessed: [a], previous });
  assert.equal(next.records[0].consecutiveUnresolved, 2);
  assert.equal(next.summary.disappearedActive, 1);
  const again = audit({ assessed: [a], previous: next });
  assert.equal(again.summary.disappearedActive, 1);
  assert.equal(again.disappearedActive[0].consecutiveMissing, 2);
  assert.equal(again.disappearedActive[0].missingSince, next.generatedAt);
  assert.equal(audit({ assessed: [a, item('2')], previous: again }).summary.disappearedActive, 0);
  assert.equal(audit({ assessed: [a], previous: again, generatedAt: '2026-12-02T00:00:00.000Z' }).summary.disappearedActive, 0);
});
test('MOEF maps original eligibility rather than education checkbox into evidence', () => {
  const raw = moefRecordToRaw({ recrutPblntSn: 304793, recrutPbancTtl: '직원 채용', instNm: '국가생명윤리정책원',
    acbgCondNmLst: '고졸, 학사, 석사', aplyQlfcCn: '석사학위 소지자 또는 학사학위 취득 전후 2년 이상 경력자',
    recrutSeNm: '신입', scrnprcdrMthdExpln: '서류전형 및 면접' });
  assert.equal(raw.sourceId, '304793');
  assert.equal(raw.companyNoticeUrl, '');
  assert.match(normalizeItem(raw).originalUrl, /job\.alio\.go\.kr\/recruitview\.do\?idx=304793/);
  assert.equal(raw.processText, '서류전형 및 면접');
  assert.notEqual(assessStudentEligibility(raw).status, 'eligible');
});
test('MOEF high-school beginner evidence is usable without fictitious credentials', () => {
  const raw = moefRecordToRaw({ recrutPblntSn: 1, recrutPbancTtl: '고졸 신입 채용', instNm: '기관',
    acbgCondNmLst: '고졸', recrutSeNm: '신입', aplyQlfcCn: '고등학교 졸업예정자 지원 가능. 경력 무관.' });
  assert.equal(assessStudentEligibility(raw).status, 'eligible');
  assert.equal(normalizeItem(raw).sourceVerification.companyNoticeCheckStatus, 'not_found');
  assert.notEqual(normalizeItem(raw).sourceVerification.doubleCheckStatus, 'job_alio_detail_confirmed');
});

test('an institution homepage is not a specific verified recruitment notice', () => {
  const raw = moefRecordToRaw({ recrutPblntSn: 123, recrutPbancTtl: '고졸 신입 채용', instNm: '기관',
    acbgCondNmLst: '고졸', recrutSeNm: '신입', aplyQlfcCn: '고등학교 졸업예정자 지원 가능. 경력 무관.',
    srcUrl: 'https://www.kps.co.kr/' });
  assert.equal(raw.companyNoticeUrl, 'https://www.kps.co.kr/');
  const item = normalizeItem({ ...raw, companyNoticeUrl: 'https://www.kps.co.kr/',
    companyNoticeCheck: { status: 'content_matched', reachable: true, companyMatched: true } });
  assert.equal(item.sourceVerification.primaryOfficialUrl, raw.sourceDetailUrl);
  assert.notEqual(item.sourceVerification.doubleCheckStatus, 'company_notice_confirmed');
});
test('employer eligibility keeps restrictions beyond the 780-character summary', () => {
  const raw = recruiterJobflexRecordToRaw({ positionSn: 1, title: '고졸 채용', careerType: 'NEW' },
    { jobDescription: `<p>고졸 신입 지원 가능.</p>${'업무 안내입니다. '.repeat(150)}<p>필수자격: 관련 경력 3년 이상</p>` },
    { id: 'finance-large-company-recruit', name: '공식기업' }, 'https://example.recruiter.co.kr/', { employer: '기업' }, 'example.recruiter.co.kr');
  assert.ok(raw.qualification.length > 780);
  assert.equal(assessStudentEligibility(raw).status, 'ineligible');
});
test('employer list metadata cannot masquerade as a fetched qualification', () => {
  const raw = recruiterJobflexRecordToRaw({ positionSn: 1, title: '고졸 신입 채용', careerType: 'NEW' }, {},
    { id: 'finance-large-company-recruit', name: '공식기업' }, 'https://example.recruiter.co.kr/', { employer: '기업' }, 'example.recruiter.co.kr');
  assert.equal(raw.qualificationEvidenceIncomplete, true);
  assert.notEqual(assessStudentEligibility(raw).status, 'eligible');
});
