import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmployerDetailUrl, employerNoticeUrl } from '../assets/job-official-links.mjs';
import { noticeLinks, noticeAttachments, sameNoticeTitle, verifyNoticePage, createNoticeResolver, enrichEmployerNotices } from './employer_notice_resolver.mjs';
import { collectJobAttachments, attachmentUrl } from '../assets/job-attachments.mjs';
import { auditJobAttachments, assertAttachmentAudit } from './job_attachment_audit.mjs';

test('recent verified downloads are reused and expired verification is checked again', async () => {
  let calls = 0;
  const file = { title: '공고.pdf', url: 'https://employer.example/file.pdf',
    downloadCheck: { status: 'verified', checkedAt: '2026-09-10T00:00:00Z' } };
  const rows = [{ attachments: [file] }];
  await auditJobAttachments(rows, { now: () => '2026-09-10T01:00:00Z', probe: async () => { calls++; return { ok: true }; } });
  assert.equal(calls, 0);
  await auditJobAttachments(rows, { now: () => '2026-09-11T01:00:00Z', probe: async () => { calls++; return { ok: true }; } });
  assert.equal(calls, 1);
});

test('reference attachments supplement employer links without replacing the notice URL', async () => {
  const rows = [{ source: 'alio', sourceId: '1', deadline: '2026-09-30', attachments: [],
    url: 'https://employer.example/post?idx=1', referenceNoticeUrl: 'https://job.alio.go.kr/recruitview.do?idx=1' }];
  const result = await auditJobAttachments(rows, { fetchPage: async (url) => ({ url,
    html: '<a href="https://www.alio.go.kr/download/download.json?fileNo=1">공고문.hwp</a>' }),
    probe: async () => ({ ok: true, httpStatus: 200 }) });
  assert.equal(result.verified, 1);
  assert.equal(rows[0].attachments.length, 1);
  assert.equal(rows[0].url, 'https://employer.example/post?idx=1');
});

test('temporary failure preserves prior files only for the same posting and records a retry', async () => {
  const previous = { source: 'alio', sourceId: '1', deadline: '2026-09-30', attachments: [
    { title: '공고.pdf', url: 'https://employer.example/file.pdf', downloadCheck: { status: 'verified', checkedAt: '2026-09-10' } }] };
  const rows = [{ ...previous, attachments: [] }, { ...previous, sourceId: '2', attachments: [] }];
  const result = await auditJobAttachments(rows, { previousItems: [previous], now: () => '2026-09-12T00:00:00Z', fetchPage: async () => { throw Error('offline'); },
    probe: async () => ({ ok: false }) });
  assert.equal(rows[0].attachments.length, 1);
  assert.equal(rows[1].attachments.length, 0);
  assert.equal(result.retryRequired, 1);
  assert.equal(result.missingReview, 1);
  rows[1].attachmentAudit.status = 'verified';
  assert.throws(() => assertAttachmentAudit(rows, result), /Unverified/);
});

const item = { company: '부산항만공사', title: '부산항만공사 정규직(신입) 채용 공고',
  publishedDate: '2026-09-02', deadline: '2026-09-17', sourceDetailUrl: 'https://job.alio.go.kr/recruitview.do?idx=304555' };
const detail = 'https://www.busanpa.com/board/view.bpa?boardId=BBS_0000046&dataSid=36757';
const body = `<h2>${item.title}</h2><p>등록일 2026.09.02</p><p>접수마감 2026.09.17</p>`;

test('BPA attachment downloads are extracted from the verified notice, not replaced by its page URL', async () => {
  const names = ['채용 공고.hwp', '붙임 1. 직무기술서.zip', '입사지원서.hwp', '채용 이의신청서.hwp', '채용서류 반환청구서.hwp'];
  const html = body + names.map((name, n) => `<a href="/board/download.bpa?dataSid=36757&amp;fileSid=${43296 + n}"><span>${name}</span><span>(151 kb)</span></a>`).join('');
  assert.equal(noticeAttachments(html, detail).length, 5);
  const items = [{ ...item, companyNoticeUrl: detail, attachments: [{ title: '기존 공고문.pdf', url: 'https://example.org/existing.pdf' }] }];
  await enrichEmployerNotices(items, { fetchPage: async (url) => ({ url, html: url === detail ? html : `<a href="${detail}">${item.title}</a>` }) });
  assert.equal(items[0].attachments.length, 6);
  assert.ok(items[0].attachments.some((file) => file.url.includes('fileSid=43297')));
  assert.ok(items[0].attachments.some((file) => file.url.endsWith('/existing.pdf')));
});

test('all ZIP children and same-named distinct files remain openable without a 12-file cap', () => {
  const file = { title: '직무기술서.zip', url: 'https://employer.example/files.zip',
    archiveEntries: Array.from({ length: 17 }, (_, n) => ({ name: `직무기술서${n}.pdf`, url: `assets/job-attachment-files/abc/${n}.pdf` })) };
  const files = collectJobAttachments({ attachments: [file, { title: '직무기술서.zip', url: 'https://employer.example/other.zip' }],
    teacherBriefing: { attachmentLines: ['직무기술서.zip: https://employer.example/files.zip'] } });
  assert.equal(files.length, 19);
  assert.equal(files.filter((file) => file.parent).length, 17);
  assert.ok(files.every((file) => file.url.startsWith('https://')));
  assert.equal(attachmentUrl('javascript:alert(1)'), '');
  assert.equal(attachmentUrl('//evil.example/a.pdf'), '');
});

test('aggregators, files, institution home and recruitment lists are not employer details', () => {
  for (const url of [item.sourceDetailUrl, 'https://www.ibk.co.kr/',
    'https://www.busanpa.com/board/list.bpa?boardId=BBS_0000046',
    'https://kgs.saramin.co.kr/', 'https://example.org/?idx=1', 'https://example.org/recruit/main',
    'https://wiset.or.kr/bbs/BBSMSTR_000000000305/view.do',
    'https://job.incruit.com/jobdb_info/jobpost.asp?job=123', 'https://example.org/fileDown.do?idx=8']) {
    assert.equal(isEmployerDetailUrl(url), false, url);
  }
  assert.equal(isEmployerDetailUrl(detail), true);
  assert.equal(isEmployerDetailUrl('https://ibk.incruit.com/hire/viewhire.asp?projectid=128'), true);
});

test('reviewed attachment never forces an ALIO link over the employer post', () => {
  const value = { ...item, source: 'job-alio-openapi', reviewedAttachment: { verified: true },
    employerNotice: { status: 'verified', url: detail } };
  assert.equal(employerNoticeUrl(value), detail);
  assert.equal(employerNoticeUrl({ ...value, employerNotice: { status: 'verified', url: item.sourceDetailUrl } }), '');
  assert.equal(employerNoticeUrl({ ...value, employerNotice: { status: 'unresolved', url: detail } }), '');
  assert.equal(employerNoticeUrl({ ...item, companyNoticeUrl: detail }), '');
});

test('same title requires matching recruitment dates; older identical vacancies fail', () => {
  assert.equal(verifyNoticePage(body, detail, item).matched, true);
  assert.equal(verifyNoticePage(body.replaceAll('2026.09', '2026.03'), detail, item).matched, false);
  assert.equal(verifyNoticePage(`<a href="${detail}">${item.title}</a><p>2026.09.02</p>`, detail, item).matched, false);
  assert.equal(verifyNoticePage(body, 'https://www.busanpa.com/', item).matched, false);
});

test('matching title does not select FAQ, results, preannouncements or experienced hires', () => {
  assert.equal(sameNoticeTitle(item.title, item), true);
  for (const suffix of [' 최종합격자 공고', ' 사전공고', ' FAQ', ' 면접전형 대상자 공고']) {
    assert.equal(sameNoticeTitle(item.title + suffix, item), false);
  }
  assert.equal(sameNoticeTitle(item.title.replace('신입', '경력'), item), false);
});

test('observed institution JavaScript links retain the exact post identifier', () => {
  const cases = [
    ['https://www.ex.co.kr/portal/selectBoardList.do?bbsId=X', `<a href="javascript:fn_egov_inqire_notice('30395');">공고</a>`, 'nttId=30395'],
    ['https://kgs.or.kr/kgs/adgb/board.do', '<a href="javascript:fn_egov_boardDetail(102684)">공고</a>', 'searchBoardSn=102684'],
    ['https://www.comwel.or.kr/recruit/hp/pblanc/pblancList.do?menuId=97', `<a href="#" onclick="fn_pblancDetail('97','R05-20260909-0001')">공고</a>`, 'annc_no=R05-20260909-0001'],
    ['https://www.kodit.or.kr/kodit/na/ntt/selectNttList.do?bbsId=407', '<a href="javascript:" data-id="5137098">공고</a>', 'nttSn=5137098'],
    ['https://kepco-enc.com/board.es?bid=0002', `<a href="#none" onclick="goView3('45062', '/board.es?act=view&list_no=45062'); return false;">공고</a>`, 'list_no=45062'],
  ];
  for (const [base, html, id] of cases) assert.ok(noticeLinks(html, base)[0]?.url.includes(id), base);
});

test('resolver traverses employer board, ignores results and verifies exact post', async () => {
  const resolve = createNoticeResolver({ fetchPage: async (url) => ({ url,
    html: url === detail ? body : `<a href="${detail}">${item.title}</a>` }) });
  const proof = await resolve(item);
  assert.equal(proof.status, 'verified');
  assert.equal(proof.url, detail);
});

test('reference discovery follows explicit original URL but never promotes the reference', async () => {
  const other = { ...item, company: '기관A', title: '기관A 고졸 신입직원 채용', companyNoticeUrl: '' };
  const exact = 'https://employer.example/notice?nttId=7';
  const resolve = createNoticeResolver({ fetchPage: async (url) => ({ url, html: url.includes('alio')
    ? `<p>공고 URL : <a href="${exact}">${exact}</a></p>`
    : '<h2>기관A 고졸 신입직원 채용</h2><p>2026.09.02</p>' }) });
  assert.equal((await resolve(other)).url, exact);
});

test('failed or ambiguous lookup remains unresolved and preserves accessible reference', async () => {
  const items = [{ ...item }];
  const result = await enrichEmployerNotices(items, { fetchPage: async () => { throw new Error('HTTP 503'); } });
  assert.equal(result.unresolved, 1);
  assert.equal(items[0].companyNoticeUrl, '');
  assert.equal(items[0].referenceNoticeUrl, item.sourceDetailUrl);
  assert.equal(items[0].sourceVerification.companyNoticeMatched, false);
  assert.equal(items[0].sourceVerification.doubleCheckStatus, 'employer_notice_pending');
});

test('institution-designated ALIO reference is reported explicitly, never an employer detail', async () => {
  const items = [{ ...item }];
  const result = await enrichEmployerNotices(items, { fetchPage: async (url) => ({ url,
    html: `<a href="${item.sourceDetailUrl}">${item.title}</a>` }) });
  assert.equal(result.referenceDesignated, 1);
  assert.equal(employerNoticeUrl(items[0]), '');
  assert.equal(items[0].employerNotice.designatedReference.url, item.sourceDetailUrl);
});

test('briefing and synthetic attachment links cannot retain an obsolete board URL', async () => {
  const old = 'https://www.busanpa.com/board/list.bpa?boardId=BBS_0000046';
  const items = [{ ...item, primaryOfficialUrl: old, attachments: [{ title: '회사·기관 공식 공고문', url: old }],
    teacherBriefing: { sourceLines: [`공식 원문: ${old}`], attachmentLines: [`회사·기관 공식 공고문: ${old}`],
      teacherShareText: `자격 정보\n[원문·첨부]\n공식 원문: ${old}` } }];
  await enrichEmployerNotices(items, { fetchPage: async (url) => ({ url,
    html: url === detail ? body : `<a href="${detail}">${item.title}</a>` }) });
  assert.equal(items[0].teacherBriefing.officialUrl, detail);
  assert.ok(!items[0].teacherBriefing.teacherShareText.includes(old));
  assert.equal(items[0].attachments.length, 0);
});

test('a cached direct URL can be rechecked with its subsequently discovered board title', async () => {
  const target = { ...item, company: '기관A', title: '기관A 고졸 신입직원 채용',
    companyNoticeUrl: 'https://example.org/notice?nttId=7' };
  const board = 'https://example.org/board';
  const resolve = createNoticeResolver({ fetchPage: async (url) => ({ url, html: url.includes('alio')
    ? `<p>공고 URL : <a href="${board}">${board}</a></p>` : url === board
      ? `<a href="${target.companyNoticeUrl}">${target.title}</a>`
      : '<h1>기관A</h1><p>2026.09.02</p>' }) });
  assert.equal((await resolve(target)).status, 'verified');
});
