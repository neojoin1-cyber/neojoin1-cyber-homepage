import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPages, buildCollectionAudit, assertCollectionAudit } from './job_collection_audit.mjs';
import { moefRecordToRaw } from './fetch_vocational_jobs.mjs';
import { assessStudentEligibility } from './student_job_eligibility.mjs';

const pager = (pages, overrides = {}) => collectPages({ fetchPage: async (n) => pages[n - 1] || { records: [] },
  recordKey: (x) => x.id, pageSize: 100, maxPages: 10, ...overrides });
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
});
test('repeat unresolved and disappeared active records are retained for operators', () => {
  const a = item('1', 'review');
  const previous = audit({ assessed: [a, item('2')] });
  const next = audit({ assessed: [a], previous });
  assert.equal(next.records[0].consecutiveUnresolved, 2);
  assert.equal(next.summary.disappearedActive, 1);
});
test('MOEF maps original eligibility rather than education checkbox into evidence', () => {
  const raw = moefRecordToRaw({ recrutPblntSn: 304793, recrutPbancTtl: '직원 채용', instNm: '국가생명윤리정책원',
    acbgCondNmLst: '고졸, 학사, 석사', aplyQlfcCn: '석사학위 소지자 또는 학사학위 취득 전후 2년 이상 경력자',
    recrutSeNm: '신입', scrnprcdrMthdExpln: '서류전형 및 면접' });
  assert.equal(raw.sourceId, '304793');
  assert.equal(raw.processText, '서류전형 및 면접');
  assert.notEqual(assessStudentEligibility(raw).status, 'eligible');
});
test('MOEF high-school beginner evidence is usable without fictitious credentials', () => {
  const raw = moefRecordToRaw({ recrutPblntSn: 1, recrutPbancTtl: '고졸 신입 채용', instNm: '기관',
    acbgCondNmLst: '고졸', recrutSeNm: '신입', aplyQlfcCn: '고등학교 졸업예정자 지원 가능. 경력 무관.' });
  assert.equal(assessStudentEligibility(raw).status, 'eligible');
});
