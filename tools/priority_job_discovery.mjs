import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Independent school-to-employer discovery. These notices are leads, not qualification proof.
export const PRIORITY_BOARDS = [
  { id: 'busan-highschool', name: '부산교육청 고졸채용', type: 'pen', pageKey: 'currPage', container: 'bbs_ViewA', url: 'https://www.pen.go.kr/main/na/ntt/selectNttList.do?bbsId=2756&mi=31898' },
  { id: 'incheon-highschool', name: '인천교육청 취업지원센터', type: 'ice', pageKey: 'currPage', container: 'bbsV_cont', url: 'https://jci.ice.go.kr/jci/na/ntt/selectNttList.do?mi=10427&bbsId=1616' },
  { id: 'gwangju-public', name: '광주교육청 공공기관·추천채용', type: 'xboard', pageKey: 'page', container: 'board_content', url: 'https://jpl.gen.go.kr/xboard/board.php?tbnum=1' },
  { id: 'hifive-central', name: 'HIFIVE 중앙 취업지원 공지', type: 'hifive', pageKey: 'currpage', container: 'kcci_bbs_editor', url: 'https://www.hifive.go.kr/front/bbs/bbsList.do?bbs_id=1&menuId=0501&rootMenuId=05' },
  { id: 'jeju-highschool', name: '제주교육청 취업지원센터', type: 'jeju', pageKey: 'startPage', container: 'boardViewWrap', url: 'https://www.jje.go.kr/job/board/list.jje?boardId=BBS_0000266&contentsSid=531&menuCd=DOM_000000301001000000&paging=ok' }
];
const decode = (s) => String(s || '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&(?:nbsp|amp|quot|lt|gt|apos);/g, (x) => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&apos;': "'" })[x]);
export const boardText = (html) => decode(String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<em\b[^>]*class=["']mTit["'][^>]*>[\s\S]*?<\/em>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (s, key) => decode(s.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '');
const isoDate = (y, m, d) => {
  const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : '';
};
export function boardDates(value) {
  const text = boardText(value);
  const matches = [...text.matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)];
  if (!matches.length) return { start: '', end: '' };
  const first = matches[0];
  const start = isoDate(first[1], first[2], first[3]);
  if (matches.length > 1) { const last = matches.at(-1); return { start, end: isoDate(last[1], last[2], last[3]) }; }
  const remainder = text.slice(first.index + first[0].length).split(/[~～∼]/)[1] || '';
  const short = remainder.match(/^\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  return { start, end: short ? isoDate(Number(first[1]) + (Number(short[1]) < Number(first[2]) ? 1 : 0), short[1], short[2]) : '' };
}
function absolute(value, base) {
  try { const url = new URL(decode(value), base); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function assertBoardContent(html) {
  if (/게시판이\s*존재하지|접근\s*권한이\s*없|서비스\s*점검\s*중/.test(boardText(html))
    || /alert\(['"]게시판이 존재하지/.test(html)) throw new Error('Board unavailable, not an empty recruitment list');
}
export function parsePriorityBoard(html, source) {
  assertBoardContent(html);
  const rows = [];
  for (const table of html.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    for (const match of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length < 4) continue;
      const titleCell = cells[source.type === 'pen' ? 3 : 1] || '';
      const link = [...titleCell.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)][0];
      if (!link) continue;
      let url = absolute(attr(link[1], 'href'), source.url);
      if (source.type === 'ice') {
        const id = attr(link[1], 'data-id');
        if (!/^\d+$/.test(id)) continue;
        const detail = new URL(source.url.replace('selectNttList', 'selectNttInfo'));
        detail.searchParams.set('nttSn', id); url = detail.href;
      }
      if (source.type === 'hifive') {
        const call = link[1].match(/funcGoDetail\('([0-9]+)'\s*,\s*'([0-9]+)'/);
        if (!call) continue;
        const detail = new URL(source.url.replace('bbsList', 'bbsDetail'));
        detail.searchParams.set('bbs_seq', call[1]); detail.searchParams.set('bbs_id', call[2]); url = detail.href;
      }
      if (!url || !/selectNttInfo|mode=view|bbsDetail|\/view\.jje/.test(url)) continue;
      const title = boardText(link[2]).replace(/\s*\(\d+\)\s*$/, '');
      const dates = boardDates(cells[4]);
      rows.push({ source: source.id, sourceName: source.name, url, title,
        company: source.type === 'pen' ? boardText(cells[2]) : source.type === 'ice' ? title : '',
        category: source.type === 'pen' ? boardText(cells[1]) : '',
        postedAt: ['pen', 'ice'].includes(source.type) ? '' : dates.start,
        start: ['pen', 'ice'].includes(source.type) ? dates.start : '',
        deadline: ['pen', 'ice'].includes(source.type) ? dates.end : '',
        recruitment: ['pen', 'ice'].includes(source.type) || /채용|모집/.test(title) && !/박람회|설명회|연수|공모전|행사|담당자|이벤트|당첨|직무교육|부사관/.test(title) });
    }
  }
  if (!rows.length && !/등록된\s*(?:게시물|자료|글).*없|게시물이\s*없/.test(boardText(html))) throw new Error('Recruitment row schema not recognized');
  return [...new Map(rows.map((r) => [r.url, r])).values()];
}

// Match a known content container with balanced tags, excluding adjacent/previous notices.
export function contentContainer(html, className) {
  const tags = [...html.matchAll(/<\/?div\b[^>]*>/gi)];
  const start = tags.findIndex((m) => attr(m[0], 'class').split(/\s+/).includes(className));
  if (start < 0) throw new Error(`Detail schema missing: ${className}`);
  let depth = 0;
  for (let i = start; i < tags.length; i++) {
    depth += /^<\//.test(tags[i][0]) ? -1 : 1;
    if (!depth) return html.slice(tags[start].index, tags[i].index + tags[i][0].length);
  }
  throw new Error('Detail container truncated');
}
export function parsePriorityDetail(html, row, source) {
  assertBoardContent(html);
  const body = contentContainer(html, source.container);
  const text = boardText(body);
  const fields = {};
  for (const pair of body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)) fields[boardText(pair[1])] = boardText(pair[2]);
  const links = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((m) => absolute(m[1], row.url)).filter(Boolean);
  for (const match of text.matchAll(/(?:https?:\/\/|www\.)[a-zA-Z0-9.-]+(?:\/[a-zA-Z0-9_/?=&%#.+-]*)?/g)) {
    const url = absolute(match[0].startsWith('www.') ? `https://${match[0]}` : match[0], row.url);
    if (url) links.push(url);
  }
  const externalLinks = [...new Set(links.filter((u) => new URL(u).hostname !== new URL(row.url).hostname))];
  const period = boardDates(fields['접수기간'] || text.match(/(?:접수기간|접수 기간|공고기간)\s*[:：]?\s*(.{0,140})/)?.[1] || '');
  return { ...row, company: fields['기관(기업)명'] || row.company || (/IBK기업은행/.test(row.title) ? '중소기업은행' : ''),
    title: fields['공고명'] || row.title,
    deadline: row.deadline || period.end, start: row.start || period.start,
    highSchoolSignal: /고졸|고등학교|특성화고|마이스터고|직업계고|고교/.test(row.title + ' ' + text),
    externalLinks, detailStatus: 'read', detailText: text.slice(0, 18000) };
}
async function readHtml(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html', 'User-Agent': 'Gyo6-JobDiscovery/1.0 (+https://gyo6.kr/jobs.html)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 3000000) throw new Error('Response exceeds board limit');
      return text;
    } catch (error) { last = error; }
  }
  throw last;
}
async function mapLimit(values, concurrency, fn) {
  const result = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const i = cursor++; result[i] = await fn(values[i], i); }
  }));
  return result;
}
export async function discoverPriorityJobs({ fetchHtml = readHtml, boards = PRIORITY_BOARDS, now = new Date(), days = 120, maxPages = 12 } = {}) {
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const results = await mapLimit(boards, 3, async (source) => {
    const records = new Map(); let pages = 0; let stopReason = 'page-limit'; let error = '';
    const fingerprints = new Set();
    try {
      for (let page = 1; page <= maxPages; page++) {
        const url = new URL(source.url); url.searchParams.set(source.pageKey, page);
        const rows = parsePriorityBoard(await fetchHtml(url.href), source); pages++;
        const fingerprint = rows.map((r) => r.url).join('|');
        if (!rows.length) { stopReason = 'empty'; break; }
        if (fingerprints.has(fingerprint)) throw new Error('Pagination repeated the same inventory');
        fingerprints.add(fingerprint);
        for (const row of rows) {
          const date = row.deadline || row.postedAt || row.start;
          if (!date || date >= cutoff) records.set(row.url, row);
        }
        if (rows.every((r) => (r.deadline || r.postedAt || r.start) && (r.deadline || r.postedAt || r.start) < cutoff)) { stopReason = 'lookback-reached'; break; }
        if (rows.length < 10) { stopReason = 'last-page'; break; }
      }
    } catch (e) { error = e.message; stopReason = 'failed'; }
    const candidates = [...records.values()].filter((r) => r.recruitment);
    const detailed = await mapLimit(candidates, 3, async (row) => {
      try { return parsePriorityDetail(await fetchHtml(row.url), row, source); }
      catch (e) { return { ...row, detailStatus: 'failed', detailError: e.message, externalLinks: [], highSchoolSignal: /고졸|고등학교|특성화고|직업계고/.test(row.title) }; }
    });
    return { source: { id: source.id, name: source.name, url: source.url, pages, stopReason, error,
      ok: !error && stopReason !== 'page-limit', listed: records.size, candidates: candidates.length,
      detailsRead: detailed.filter((r) => r.detailStatus === 'read').length, detailsFailed: detailed.filter((r) => r.detailStatus !== 'read').length }, records: detailed };
  });
  return { version: 1, generatedAt: now.toISOString(), scope: { lookbackDays: days, maxPagesPerBoard: maxPages, nationwideCompletenessGuaranteed: false }, sources: results.map((r) => r.source), records: results.flatMap((r) => r.records) };
}
const compact = (text) => String(text || '').replace(/주식회사|\(주\)|㈜/g, '').replace(/[^a-zA-Z0-9가-힣]/g, '').toLowerCase();
const urlsOf = (r) => [r.url, r.originalUrl, r.companyNoticeUrl, r.sourceDetailUrl].filter(Boolean);
const exactNotice = (u) => /(?:idx|nttSn|recruitNo|id|number|dataSid)=\d+|\/\d{4,}(?:[/?#]|$)/.test(u);
export function reconcilePriorityDiscovery(discovery, assessed, published, now = new Date(), previous = {}) {
  const today = now.toISOString().slice(0, 10);
  const publishedIds = new Set(published.map((i) => i.id));
  const current = new Map(discovery.records.map((r) => [r.url, r]));
  for (const old of previous.records || []) {
    if (!current.has(old.url) && (!old.deadline || old.deadline >= today)
      && !['closed', 'published-match'].includes(old.outcome)) current.set(old.url, { ...old, missingFromCurrentScan: true });
  }
  const records = [...current.values()].map((row) => {
    const matches = assessed.filter((item) => {
      const direct = row.externalLinks?.some((url) => exactNotice(url) && urlsOf(item).includes(url));
      const company = compact(row.company);
      const dated = company.length >= 3 && company === compact(item.company) && row.deadline && row.deadline === String(item.deadline || '').slice(0, 10);
      return direct || dated;
    });
    const visible = matches.filter((i) => publishedIds.has(i.id) && (!row.highSchoolSignal || i.studentChannelAssessment?.qualificationAssessment?.explicitHighSchool));
    const closed = row.deadline && row.deadline < today;
    const outcome = closed ? 'closed' : visible.length ? 'published-match' : matches.length ? 'qualification-or-policy-review' : 'unmatched-discovery';
    const { detailText, ...publicRow } = row;
    const old = previous.records?.find((r) => r.url === row.url);
    return { ...publicRow, outcome, firstSeenAt: old?.firstSeenAt || discovery.generatedAt,
      unresolvedRuns: ['closed', 'published-match'].includes(outcome) ? 0 : (old?.unresolvedRuns || 0) + 1,
      matches: matches.map((i) => ({ id: i.id, company: i.company, title: i.baseTitle || i.title,
      url: i.originalUrl || i.url, published: publishedIds.has(i.id), qualification: i.studentChannelAssessment?.qualificationAssessment?.status,
      roles: i.studentChannelAssessment?.qualificationAssessment?.eligibleRoles || [] })) };
  });
  return { ...discovery, records, summary: { discovered: records.length, publishedMatches: records.filter((r) => r.outcome === 'published-match').length,
    closed: records.filter((r) => r.outcome === 'closed').length,
    unresolved: records.filter((r) => !['closed', 'published-match'].includes(r.outcome)).length,
    activeDatedUnresolved: records.filter((r) => r.deadline >= today && !['closed', 'published-match'].includes(r.outcome)).length,
    unknownDeadlineUnresolved: records.filter((r) => !r.deadline && !['closed', 'published-match'].includes(r.outcome)).length,
    highSchoolUnresolved: records.filter((r) => r.highSchoolSignal && !['closed', 'published-match'].includes(r.outcome)).length,
    sourceFailures: discovery.sources.filter((s) => !s.ok).length, detailFailures: discovery.sources.reduce((n, s) => n + s.detailsFailed, 0) } };
}
export function discoveredRecruiterEntries(discovery) {
  const entries = new Map();
  for (const row of discovery.records) {
    if (!row.company || row.detailStatus !== 'read') continue;
    for (const link of row.externalLinks || []) {
      const url = new URL(link);
      if (!/^[a-z0-9-]+\.recruiter\.co\.kr$/i.test(url.hostname)) continue;
      entries.set(url.hostname, { employer: row.company, url: `https://${url.hostname}/`, builtIn: true, group: 'education-discovered', tags: ['독립발견'], discoveredFrom: row.url });
    }
  }
  return [...entries.values()];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await discoverPriorityJobs();
  const output = process.argv[2];
  if (output) await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ sources: result.sources, records: result.records.length }, null, 2));
}
