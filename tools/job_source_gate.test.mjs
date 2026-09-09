import test from 'node:test';
import assert from 'node:assert/strict';
import { freshPrimarySource, preflight, reconciledCollection } from './job_source_gate.mjs';
import { buildCollectionAudit } from './job_collection_audit.mjs';
const started = '2026-09-10T00:00:00Z';
const feed = () => ({ generatedAt: started, sourceStatus: [{ id: 'job-alio-openapi', ok: true, checkedAt: started, scannedCount: 300, scanTargetCount: 30, rawItemCount: 200 }] });
test('fresh live rows pass', () => assert.equal(freshPrimarySource(feed(), started), true));
test('fully paginated independent official API can survive ALIO outage, not partial or stale API', () => {
  const value = feed(); value.sourceStatus[0].ok = false;
  const api = { id: 'moef-public-recruit', ok: true, checkedAt: started, rawItemCount: 500, pagination: { complete: true, expectedTotal: 500 } };
  value.sourceStatus.push(api);
  assert.equal(freshPrimarySource(value, started), true);
  api.pagination.complete = false;
  assert.equal(freshPrimarySource(value, started), false);
  api.pagination.complete = true; api.checkedAt = '2026-09-09T00:00:00Z';
  assert.equal(freshPrimarySource(value, started), false);
});
test('collection audit must match this feed and this run, not an older successful artifact', () => {
  const audit = buildCollectionAudit({ discovered: [{ source: 'a', sourceId: '1', collectionDisposition: 'detail-failed' }],
    assessed: [], candidates: [], published: [], sources: [], generatedAt: started });
  const value = { generatedAt: started, collectionReconciliation: audit.summary };
  assert.equal(reconciledCollection(value, audit, started), true);
  assert.equal(reconciledCollection(value, audit, '2026-09-11T00:00:00Z'), false);
  assert.equal(reconciledCollection({ ...value, generatedAt: '2026-09-09T00:00:00Z' }, audit, started), false);
});
test('preserved previous data cannot pass as new collection', () => {
  const value = feed(); value.sourceStatus[0].ok = false; value.sourceStatus[0].fallbackItemCount = 97;
  assert.equal(freshPrimarySource(value, started), false);
});
test('a previous successful run cannot pass this run', () => assert.equal(freshPrimarySource(feed(), '2026-09-10T00:01:00Z'), false));
test('empty or missing source evidence fails closed', () => {
  assert.equal(freshPrimarySource({}, started), false);
  assert.equal(freshPrimarySource(feed(), undefined), false);
  for (const key of ['scannedCount', 'scanTargetCount', 'rawItemCount']) {
    const value = feed(); value.sourceStatus[0][key] = 0;
    assert.equal(freshPrimarySource(value, started), false);
  }
});
test('a live official job link passes preflight', async () => assert.equal(await preflight(async () => ({ ok: true, text: async () => 'recruitview.do?idx=123' })), true));
test('HTTP errors and an HTML error page do not pass preflight', async () => {
  for (const response of [{ ok: false, text: async () => 'recruitview.do?idx=123' }, { ok: true, text: async () => 'Temporarily unavailable' }]) {
    let calls = 0;
    assert.equal(await preflight(async () => { calls++; return response; }, async () => {}), false);
    assert.equal(calls, 2);
  }
});
test('transient transport failure retries once and can recover', async () => {
  let calls = 0;
  assert.equal(await preflight(async () => { if (++calls === 1) throw new Error('timeout'); return { ok: true, text: async () => 'recruitview.do?idx=123' }; }, async () => {}), true);
  assert.equal(calls, 2);
});
