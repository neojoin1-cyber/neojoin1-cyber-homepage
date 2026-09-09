import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIORITY_BOARDS, boardDates, parsePriorityBoard, parsePriorityDetail, discoverPriorityJobs, reconcilePriorityDiscovery, discoveredRecruiterEntries } from './priority_job_discovery.mjs';
const pen = PRIORITY_BOARDS[0];
const table = (rows) => `<table><tbody>${rows.join('')}</tbody></table>`;
const penRow = (id = '1234', company = '부산항만공사', title = '고졸 신입 채용') => `<tr><td>1</td><td>공기업</td><td>${company}</td><td><a href="/main/na/ntt/selectNttInfo.do?nttSn=${id}&amp;bbsId=2756">${title}</a></td><td>2026/09/09 ~ 2026/09/17</td><td>5</td></tr>`;
test('rows are isolated, not neighboring-text qualification guesses', () => {
  const rows = parsePriorityBoard(table([penRow(), penRow('2345', '다른기관', '석사 경력 채용')]), pen);
  assert.equal(rows.length, 2); assert.equal(rows[0].company, '부산항만공사');
  assert.equal(rows[0].deadline, '2026-09-17'); assert.equal(rows[0].qualification, undefined);
  assert.doesNotMatch(rows[0].title, /석사/);
});
test('Incheon data-id links are followed, never executed', () => {
  const html = table(['<tr><td>1</td><td><a href="javascript:;" data-id="3380304">한국산업인력공단</a></td><td>전국</td><td>신입</td><td>2026. 8. 5.(수) ~ 8. 13.</td></tr>']);
  const [row] = parsePriorityBoard(html, PRIORITY_BOARDS[1]);
  assert.match(row.url, /selectNttInfo\.do/); assert.match(row.url, /nttSn=3380304/);
  assert.equal(row.deadline, '2026-08-13');
});
test('HIFIVE detail contract uses literal post identifiers', () => {
  const html = table([`<tr><td>1</td><td><a href="#" onclick="funcGoDetail('145990','1','216437');return false;">고졸 채용</a></td><td></td><td>운영자</td><td>2026-08-10</td></tr>`]);
  const [row] = parsePriorityBoard(html, PRIORITY_BOARDS[3]);
  assert.match(row.url, /bbsDetail\.do/); assert.match(row.url, /bbs_seq=145990/);
  assert.equal(row.postedAt, '2026-08-10');
});
test('Xboard escaped query and dates survive parsing', () => {
  const html = table(['<tr><td>1</td><td><a href="board.php?mode=view&amp;number=3156&amp;tbnum=1">기업 채용</a></td><td></td><td>운영자</td><td>2026/08/21</td><td>4</td></tr>']);
  const [row] = parsePriorityBoard(html, PRIORITY_BOARDS[2]);
  assert.match(row.url, /number=3156&tbnum=1/); assert.equal(row.postedAt, '2026-08-21');
});
test('dead board with HTTP 200 is a failure, not successful zero jobs', () => {
  assert.throws(() => parsePriorityBoard("<script>alert('게시판이 존재하지않습니다.');history.back();</script>", pen));
  assert.throws(() => parsePriorityBoard('<html>정상 홈페이지지만 게시판 없음</html>', pen));
});
test('detail only reads its bounded content, not next-post links', () => {
  const html = '<div class="bbs_ViewA"><div>고졸 채용</div><a href="https://nhqv.recruiter.co.kr/">채용</a></div><a href="https://other.example/">다음 채용</a>';
  const row = parsePriorityDetail(html, { company: 'NH투자증권', title: '채용', url: pen.url }, pen);
  assert.deepEqual(row.externalLinks, ['https://nhqv.recruiter.co.kr/']);
  assert.equal(row.highSchoolSignal, true);
});
test('invalid and non-adjacent short dates are never invented as deadlines', () => {
  assert.equal(boardDates('2026.02.31').start, '');
  assert.equal(boardDates('2026.8.10 접수 ~ 별도 안내 입사 5.1').end, '');
  assert.deepEqual(boardDates('2026.12.20 ~ 1.5'), { start: '2026-12-20', end: '2027-01-05' });
});
test('page cap and repeated inventory remain explicitly incomplete', async () => {
  const html = table(Array.from({ length: 10 }, (_, i) => penRow(String(1234 + i))));
  const fetchHtml = async (url) => url.includes('selectNttList') ? html : '<div class="bbs_ViewA">고졸 신입</div>';
  const capped = await discoverPriorityJobs({ boards: [pen], fetchHtml, now: new Date('2026-09-10'), maxPages: 1 });
  assert.equal(capped.sources[0].ok, false); assert.equal(capped.sources[0].stopReason, 'page-limit');
  const repeated = await discoverPriorityJobs({ boards: [pen], fetchHtml, now: new Date('2026-09-10') });
  assert.equal(repeated.sources[0].ok, false); assert.match(repeated.sources[0].error, /repeated/);
});
test('failed detail is retained as a discovered lead', async () => {
  const result = await discoverPriorityJobs({ boards: [pen], now: new Date('2026-09-10'), fetchHtml: async (u) => { if (u.includes('selectNttList')) return table([penRow()]); throw new Error('HTTP 503'); } });
  assert.equal(result.records.length, 1); assert.equal(result.sources[0].detailsFailed, 1);
});
test('company alone and home page links never prove a matched opening', () => {
  const lead = { title: '고졸', company: '부산항만공사', deadline: '2026-09-17', highSchoolSignal: true, externalLinks: ['https://example.com/'] };
  const item = { id: 'x', company: lead.company, deadline: '2026-09-20', url: 'https://example.com/' };
  const result = reconcilePriorityDiscovery({ sources: [], records: [lead] }, [item], [item], new Date('2026-09-10'));
  assert.equal(result.summary.publishedMatches, 0);
});
test('a published graduate-level track does not satisfy a discovered high-school track', () => {
  const lead = { title: '고졸', company: '부산항만공사', deadline: '2026-09-17', highSchoolSignal: true, externalLinks: [] };
  const item = { id: 'x', company: lead.company, deadline: lead.deadline, studentChannelAssessment: { qualificationAssessment: { explicitHighSchool: false } } };
  const result = reconcilePriorityDiscovery({ sources: [], records: [lead] }, [item], [item], new Date('2026-09-10'));
  assert.equal(result.summary.highSchoolUnresolved, 1);
  item.studentChannelAssessment.qualificationAssessment.explicitHighSchool = true;
  assert.equal(reconcilePriorityDiscovery({ sources: [], records: [lead] }, [item], [item], new Date('2026-09-10')).summary.publishedMatches, 1);
});
test('dynamic employer discovery accepts only the real recruiter domain', () => {
  const result = discoveredRecruiterEntries({ records: [{ company: '기업', detailStatus: 'read', externalLinks: ['https://real.recruiter.co.kr/app/jobnotice/view?systemKindCode=MRS2&jobnoticeSn=1', 'https://recruiter.co.kr.evil.example/', 'http://127.0.0.1/', 'https://evil.example/'] }] });
  assert.equal(result.length, 1); assert.equal(result[0].url, 'https://real.recruiter.co.kr/');
});
test('unresolved leads survive a failed or incomplete next scan', () => {
  const previous = { records: [{ url: 'https://example.com/job/1234', source: pen.id, deadline: '2026-09-20', outcome: 'unmatched-discovery', highSchoolSignal: true, unresolvedRuns: 2, firstSeenAt: '2026-09-08' }] };
  const report = reconcilePriorityDiscovery({ generatedAt: '2026-09-10', sources: [], records: [] }, [], [], new Date('2026-09-10'), previous);
  assert.equal(report.records.length, 1); assert.equal(report.records[0].unresolvedRuns, 3);
  assert.equal(report.records[0].missingFromCurrentScan, true);
  assert.equal(report.summary.activeDatedUnresolved, 1);
});
