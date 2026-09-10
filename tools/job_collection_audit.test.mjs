import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, buildCollectionAudit, assertCollectionAudit } from './job_collection_audit.mjs';
import { moefRecordToRaw, recruiterJobflexRecordToRaw, normalizeItem, mpmPageParams } from './fetch_vocational_jobs.mjs';
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
  title: `Notice ${sourceId}`, company: 'Employer', deadline: '2026-12-01',
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
  assert.throws(() => assertCollectionAudit(audit({ assessed: [a], candidates: [a] })), /Unaccounted/);
  const known = audit({ assessed: [a], candidates: [a], publicationReasons: { 'test:1': 'invalid-url' } });
  assertCollectionAudit(known);
  assert.ok(known.records[0].reasons.includes('invalid-url'));
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
