import test from 'node:test';
import assert from 'node:assert/strict';
import { freshPrimarySource, preflight } from './job_source_gate.mjs';
const started = '2026-09-10T00:00:00Z';
const feed = () => ({ generatedAt: started, sourceStatus: [{ id: 'job-alio-openapi', ok: true, checkedAt: started, scannedCount: 300, scanTargetCount: 30, rawItemCount: 200 }] });
test('fresh live rows pass', () => assert.equal(freshPrimarySource(feed(), started), true));
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
