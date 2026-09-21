import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJobAlioHighSchoolRows, JOB_ALIO_HIGH_SCHOOL_KEYWORD_QUERIES } from './job_alio_highschool_scan.mjs';

const row = (idx, title, company) => `<table><tbody><tr><td>1</td><td><a href="/recruitview.do?idx=${idx}">${title}</a></td><td></td><td>${company}</td><td></td><td></td><td>2026-09-20</td><td>진행중</td></tr></tbody></table>`;
const response = (body) => ({ ok: true, headers: { getSetCookie: () => [], get: () => null }, text: async () => body });

test('eligibility keyword fallback searches all employers and merges results with the education filter', async () => {
  const requests = [];
  const result = await fetchJobAlioHighSchoolRows({
    now: new Date('2026-09-10T00:00:00Z'), pause: async () => {},
    fetchImpl: async (_url, options = {}) => {
      if (!options.method) return response('<input name="_csrf" value="csrf-token">');
      const form = new URLSearchParams(options.body);
      requests.push(form);
      if (form.get('search_type') === 'elig' && form.get('keyword') === '고졸' && form.get('pageNo') === '1') {
        return response(row('9001', '2026년 고졸 신입 채용', '한국에너지공단'));
      }
      return response('<table><tbody></tbody></table>');
    }
  });

  const keywordRequest = requests.find((form) => form.get('keyword') === '고졸');
  assert.ok(keywordRequest);
  assert.equal(keywordRequest.get('search_type'), 'elig');
  assert.equal(keywordRequest.get('education'), null);
  assert.equal(keywordRequest.get('org_name'), null);
  assert.deepEqual(JOB_ALIO_HIGH_SCHOOL_KEYWORD_QUERIES, ['고졸', '고등학교', '졸업예정', '특성화고', '학력무관']);
  assert.equal(result.pagination.keywordSearchComplete, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].educationFilterMatch, undefined);
  assert.deepEqual(result.rows[0].scanReasons, ['eligibility-keyword:고졸']);
});

test('keyword fallback keeps partial failure visible without invalidating the independent education scan', async () => {
  const result = await fetchJobAlioHighSchoolRows({
    now: new Date('2026-09-10T00:00:00Z'), pause: async () => {}, maxPagesPerType: 2, maxPagesPerKeyword: 1,
    fetchImpl: async (_url, options = {}) => {
      if (!options.method) return response('<input name="_csrf" value="csrf-token">');
      const form = new URLSearchParams(options.body);
      if (form.get('search_type') === 'elig') return response(row('9002', '고졸 전형', '기관'));
      return response('<table><tbody></tbody></table>');
    }
  });
  assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.keywordSearchComplete, false);
  assert.ok(result.pagination.keywordSearchIssues.some((issue) => issue.type === 'page-limit'));
});
