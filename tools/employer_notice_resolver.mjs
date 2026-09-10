import { isEmployerDetailUrl, isReferenceUrl, referenceNoticeUrl } from '../assets/job-official-links.mjs';

// Board seeds, not pinned vacancies. Every run discovers and rechecks the matching post.
const BOARDS = [
  ['부산항만공사', 'https://www.busanpa.com/board/list.bpa?boardId=BBS_0000046&menuCd=DOM_000000107001001000&contentsSid=47'],
  ['신용보증기금', 'https://www.kodit.or.kr/kodit/na/ntt/selectNttList.do?mi=2518&bbsId=407'],
  ['한국가스안전공사', 'https://kgs.or.kr/kgs/adgb/board.do'],
  ['한국전력기술', 'https://kepco-enc.com/board.es?bid=0002&mid=a10106020100'],
  ['한국도로공사', 'https://www.ex.co.kr/portal/biz/bbs/layout1/selectBoardList.do?bbsId=BBSMSTR_000000000182'],
  ['한국도로공사', 'https://www.ex.co.kr/portal/biz/bbs/layout1/selectBoardList.do?bbsId=BBSMSTR_000000000211'],
  ['주택관리공단', 'https://www.kohom.or.kr/web/mainComm/HM005008005.do?mode=list'],
  ['중소기업은행', 'https://ibk.incruit.com/'],
  ['예금보험공사', 'https://www.kdic.or.kr/di/empm/selectPbcrEmpmPbancList.do'],
  ['한전KPS', 'https://www.kps.co.kr/web/company/recruit/posting/rolling.do'],
  ['한국중부발전', 'https://www.komipo.co.kr/kor/board/BRD_000053/boardMain.do?mnCd=FN100204&pageSize=10'],
  ['한국산업은행', 'https://kdb.incruit.com/hire/hirelist.asp'],
  ['경북대학교치과병원', 'https://www.knudh.kr/content/05info/02_01.php'],
  ['근로복지공단', 'https://www.comwel.or.kr/recruit/hp/pblanc/pblancList.do?menuId=97'],
];

export function textOf(html = '') {
  return String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function canonical(value, company = '') {
  let text = textOf(value).replace(/\(원서 마감\)|새글|\bNEW\b/gi, '').replace(/년도/g, '년').replace(/경리직/g, '경리');
  for (const alias of [company, company.replace(/주식회사|\(주\)|\(재\)/g, ''),
    ...(company.includes('중소기업은행') ? ['IBK기업은행'] : [])].filter(Boolean)) text = text.split(alias).join('');
  return text.replace(/주식회사|채용공고문|채용공고|공개모집|채용안내|공개채용|공개경쟁채용|채용 공고/g, '채용')
    .replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase();
}

export function sameNoticeTitle(candidate, item) {
  const a = canonical(candidate, item.company || '');
  const b = canonical(item.baseTitle || item.title, item.company || '');
  if (!a || !b || b.length < 4) return false;
  // A result/FAQ/preannouncement is not the recruitment notice, even with the same title prefix.
  for (const word of ['합격자', '대상자', '결과', '사전공고', 'FAQ', '인정기간', '면접전형', '필기전형']) {
    if (candidate.includes(word) && !(item.title || '').includes(word)) return false;
  }
  if (item.company?.includes('주택관리공단')) {
    const branch = item.title.match(/[가-힣]+지사/)?.[0];
    const type = /채용형\s*인턴/.test(item.title) ? /채용형\s*인턴/ : /(?:육아|휴직).*대체/;
    return Boolean(branch && candidate.includes(branch) && type.test(candidate));
  }
  if (item.company === '한국전기안전공사' && /채용형\s*인턴/.test(item.title)) {
    const year = item.title.match(/20\d{2}/)?.[0];
    return Boolean(year && candidate.includes(year) && /채용형\s*인턴\s*\(학력무관\)/.test(candidate));
  }
  return a === b || (a.includes(b) && a.length <= b.length + 10);
}

function datePresent(text, date) {
  const parts = String(date || '').match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (!parts) return false;
  const [, y, m, d] = parts;
  return new RegExp(`(?:${y}|['’]${y.slice(2)})\\s*[.년/\\-]\\s*0?${Number(m)}\\s*[.월/\\-]\\s*0?${Number(d)}(?:\\D|$)`).test(text)
    || text.includes(`${y}${m}${d}`);
}

export function verifyNoticePage(html, url, item, anchorTitle = '') {
  if (!isEmployerDetailUrl(url)) return { matched: false, reason: 'not-employer-detail' };
  // Strip adjacent-post/navigation links so they cannot prove the current post's identity.
  const body = textOf(html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' '));
  const title = canonical(item.baseTitle || item.title, item.company || '');
  const company = (item.company || '').replace(/주식회사|\(주\)|\(재\)/g, '');
  const companyMatched = body.includes(company) || (company === '중소기업은행' && body.includes('기업은행'));
  const titleMatched = canonical(body, item.company || '').includes(title)
    || (companyMatched && anchorTitle && sameNoticeTitle(anchorTitle, item));
  const dateMatched = [item.publishedDate, item.publishedAt, item.collectionAudit?.publishedDate, item.deadline]
    .some((date) => datePresent(body, date));
  return { matched: titleMatched && dateMatched, titleMatched, dateMatched,
    reason: !titleMatched ? 'title-mismatch' : !dateMatched ? 'date-mismatch' : 'title-and-date' };
}

function absolute(value, base) {
  try {
    const u = new URL(value.replace(/&amp;/g, '&'), base);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname)) return '';
    return u.href;
  } catch { return ''; }
}

export function noticeLinks(html, base) {
  const links = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const href = attrs.match(/href\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '';
    let url = href && !/^(#|javascript:)/i.test(href) ? absolute(href, base) : '';
    const b = new URL(base);
    const id = attrs.match(/data-id=["'](\d+)["']/i)?.[1];
    if (!url && id && /selectNttList\.do$/i.test(b.pathname)) {
      b.pathname = b.pathname.replace('selectNttList.do', 'selectNttInfo.do');
      b.searchParams.set('nttSn', id); url = b.href;
    }
    const kgs = href.match(/fn_egov_boardDetail\((\d+)\)/);
    if (!url && kgs && /(^|\.)kgs\.or\.kr$/.test(b.hostname)) {
      b.searchParams.set('searchBoardSn', kgs[1]); url = b.href;
    }
    const ex = href.match(/fn_egov_inqire_notice\(['"]?(\d+)/);
    if (!url && ex && /(^|\.)ex\.co\.kr$/.test(b.hostname)) {
      b.pathname = b.pathname.replace('selectBoardList.do', 'selectBoardArticle.do');
      b.searchParams.set('nttId', ex[1]); url = b.href;
    }
    const kohom = attrs.match(/fn_goView\(['"](\d+)['"]\)/);
    if (!url && kohom && /(^|\.)kohom\.or\.kr$/.test(b.hostname)) {
      b.searchParams.set('mode', 'view'); b.searchParams.set('rnm_idx', kohom[1]); url = b.href;
    }
    const kdic = attrs.match(/detailView\((\d+)\)/);
    if (!url && kdic && /(^|\.)kdic\.or\.kr$/.test(b.hostname)) {
      b.pathname = '/di/empm/selectPbcrEmpmPbancDtl.do';
      b.searchParams.set('empmPbancRegSn', kdic[1]); url = b.href;
    }
    const comwel = attrs.match(/fn_pblancDetail\(['"](\d+)['"],\s*['"]([\w-]+)['"]\)/);
    if (!url && comwel && /(^|\.)comwel\.or\.kr$/.test(b.hostname)) {
      b.pathname = '/recruit/hp/pblanc/pblancView.do';
      b.search = new URLSearchParams({ menuId: comwel[1], annc_no: comwel[2] }).toString();
      url = b.href;
    }
    const literal = attrs.match(/goView3\('[^']+',\s*'([^']+)'\)/)?.[1];
    const jsUrl = literal || attrs.match(/(?:location(?:\.href)?\s*=|window\.open\()\s*['"]([^'"]+)['"]/i)?.[1];
    if (!url && jsUrl) url = absolute(jsUrl, base);
    if (url) links.push({ url, title: textOf(m[2]) });
  }
  if (/^https:\/\/(?:www\.)?wiset\.or\.kr\/bbs\//.test(base)) {
    for (const m of html.matchAll(/<button\b[^>]*onclick="[^\"]*fn_search_detail\('([\w]+)'\)[^\"]*"[^>]*>([\s\S]*?)<\/button>/gi)) {
      const u = new URL(base); u.pathname = u.pathname.replace(/list\.do$/, 'view.do');
      u.searchParams.set('nttId', m[1]); links.push({ url: u.href, title: textOf(m[2]) });
    }
  }
  return links;
}

export function noticeAttachments(html, base) {
  const content = html.replace(/<(?:header|footer|nav)\b[^>]*>[\s\S]*?<\/(?:header|footer|nav)>/gi, '');
  const files = new Map();
  for (const link of noticeLinks(content, base)) {
    if (!/\.(?:pdf|hwpx?|docx?|xlsx?|zip|pptx?|png|jpe?g)(?:\b|$)/i.test(link.title)) continue;
    if (!/(?:download|filedown|fileSn=|fileSid=|fileNo=|atchFile|\.pdf|\.hwp|\.zip|\.doc|\.xls|\.png|\.jpg)/i.test(link.url)) continue;
    if (/\/preview\./i.test(new URL(link.url).pathname)) continue;
    const title = link.title.replace(/\s*[([][\d.,]+\s*(?:k|m|g)?b[)\]]\s*$/i, '').trim();
    const url = link.url.replace(/;jsessionid=[^?&#/]*/gi, '');
    if (!files.has(url)) files.set(url, { title, url, sourceNoticeUrl: base });
  }
  return [...files.values()];
}

export async function fetchNoticePage(url) {
  let current = url;
  let cookie = '';
  for (let n = 0; n < 6; n++) {
    const r = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Gyo6RecruitNotice/1.0)', ...(cookie ? { Cookie: cookie } : {}) } });
    cookie = r.headers.getSetCookie().map((s) => s.split(';')[0]).filter(Boolean).join('; ') || cookie;
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const next = absolute(r.headers.get('location') || '', current);
      await r.body?.cancel();
      // Incruit initializes a public session, then requires the project query to be replayed.
      if (n === 0 && cookie && /\.incruit\.com$/.test(new URL(current).hostname)
        && /projectid=/i.test(current) && next && !/projectid=/i.test(next)) continue;
      if (!next || new URL(next).hostname !== new URL(current).hostname) cookie = '';
      if (!next) throw new Error('invalid-redirect');
      current = next; continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > 4000000) throw new Error('page-too-large');
    let html;
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { html = new TextDecoder('euc-kr').decode(bytes); }
    const refresh = html.match(/<meta[^>]+content=["'][^"']*?url=([^"']+)/i)?.[1];
    if (refresh) { current = absolute(refresh, current); if (!current) throw new Error('invalid-refresh'); continue; }
    return { html, url: current };
  }
  throw new Error('redirect-limit');
}

export function createNoticeResolver({ fetchPage = fetchNoticePage, now = () => new Date().toISOString() } = {}) {
  const cache = new Map();
  const get = (url) => {
    if (!cache.has(url)) cache.set(url, fetchPage(url));
    return cache.get(url);
  };
  return async function resolve(item) {
    const seeds = BOARDS.filter(([company]) => item.company?.includes(company)).map(([, url]) => url);
    const reference = referenceNoticeUrl(item);
    const candidates = [item.employerNotice?.url, item.companyNoticeUrl, item.primaryOfficialUrl, item.originalUrl, item.url]
      .filter((url) => url && !isReferenceUrl(url));
    const queue = [...new Set([...seeds, ...candidates])].map((url) => ({ url, depth: 0 }));
    const attempted = [];
    const visited = new Set();
    let designatedReference = null;
    // ALIO is a discovery source only. Its explicit original link can seed the institution crawl.
    if (/job\.alio\.go\.kr/.test(reference)) {
      try {
        const page = await get(reference);
        let original = textOf(page.html).match(/(?:공고 URL|원문 URL)\s*:?\s*((?:https?:\/\/|www\.)\S+)/)?.[1];
        if (original?.startsWith('www.')) original = `https://${original}`;
        if (original && !isReferenceUrl(original)) queue.push({ url: original, depth: 0 });
        for (const link of noticeLinks(page.html, page.url)) {
          if (!isReferenceUrl(link.url) && /원문|원본|기관.*공고|공고.*원문/.test(link.title)) queue.push({ url: link.url, depth: 0 });
        }
      } catch { /* Reference failure must not prevent independent institution lookup. */ }
    }
    while (queue.length && visited.size < 10) {
      const { url, depth, anchorTitle } = queue.shift();
      const visitKey = `${url}|${Boolean(anchorTitle)}`;
      if (visited.has(visitKey) || isReferenceUrl(url)) continue;
      visited.add(visitKey);
      try {
        const page = await get(url);
        const proof = verifyNoticePage(page.html, page.url, item, anchorTitle);
        attempted.push({ url: page.url, reason: proof.reason });
        if (proof.matched) return { status: 'verified', url: page.url, checkedAt: now(),
          attachments: noticeAttachments(page.html, page.url),
          titleMatched: true, dateMatched: true, method: 'employer-detail-title-and-date', attempts: attempted };
        const links = noticeLinks(page.html, page.url);
        const designated = links.find((link) => link.url === reference && isReferenceUrl(link.url) && sameNoticeTitle(link.title, item));
        if (designated) designatedReference = { url: reference, linkedFrom: page.url };
        const matches = links.filter((link) => isEmployerDetailUrl(link.url) && sameNoticeTitle(link.title, item));
        queue.unshift(...matches.map((link) => ({ url: link.url, depth: depth + 1, anchorTitle: link.title })));
        if (depth < 1) {
          queue.push(...links.filter((link) => !isReferenceUrl(link.url)
            && new URL(link.url).hostname === new URL(page.url).hostname
            && /^(채용공고|채용정보|인재채용|직원채용|채용안내)(\s|$)/.test(link.title))
            .slice(0, 3).map((link) => ({ url: link.url, depth: depth + 1 })));
          queue.push(...links.filter((link) => /^[23]$/.test(link.title)
            && new URL(link.url).hostname === new URL(page.url).hostname
            && /[?&](?:pageIndex|page|nPage)=/.test(link.url)).slice(0, 2).map((link) => {
              const next = new URL(page.url);
              for (const [key, value] of new URL(link.url).searchParams) next.searchParams.set(key, value);
              return { url: next.href, depth: 1 };
            }));
        }
      } catch (e) { attempted.push({ url, reason: 'fetch-failed', error: String(e.message).slice(0, 80) }); }
    }
    return { status: designatedReference ? 'reference_designated' : 'unresolved', url: '', checkedAt: now(),
      method: 'employer-detail-title-and-date', ...(designatedReference ? { designatedReference } : {}), attempts: attempted };
  };
}

export async function enrichEmployerNotices(items, options = {}) {
  const resolve = createNoticeResolver(options);
  let cursor = 0;
  const summary = { total: items.length, verified: 0, referenceDesignated: 0, unresolved: 0 };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      const reference = referenceNoticeUrl(item);
      const oldPrimary = item.primaryOfficialUrl || item.url || '';
      const proof = await resolve(item);
      item.employerNotice = proof;
      item.referenceNoticeUrl = reference;
      item.companyNoticeUrl = proof.url;
      if (proof.status === 'verified') {
        item.primaryOfficialUrl = proof.url;
        item.url = proof.url;
        summary.verified++;
      } else if (proof.status === 'reference_designated') { summary.referenceDesignated++; }
      else { summary.unresolved++; }
      item.sourceVerification = { ...item.sourceVerification,
        primaryOfficialUrl: proof.url || reference,
        doubleCheckStatus: proof.status === 'verified' ? 'company_notice_confirmed'
          : proof.status === 'reference_designated' ? 'employer_reference_designated' : 'employer_notice_pending',
        companyNoticeUrl: proof.url, companyNoticeReachable: proof.status === 'verified',
        companyNoticeMatched: proof.status === 'verified', companyNoticeCheckedAt: proof.checkedAt,
        companyNoticeCheckStatus: proof.status,
        doubleCheckLabel: proof.status === 'verified' ? '기관 상세 공고 대조 완료'
          : proof.status === 'reference_designated' ? '기관 홈페이지가 안내한 참조 공고' : '참조 공고 확인 · 기관 상세 탐색 중' };
      const label = item.sourceVerification.doubleCheckLabel;
      const sourceLines = [proof.url ? `기관 공식 원문: ${proof.url}` : '기관 상세 공고: 별도 주소 미확인',
        ...(reference ? [`참조 공고: ${reference}`] : []), label];
      item.attachments = (item.attachments || []).filter((file) =>
        !(file.url === oldPrimary && file.title === '회사·기관 공식 공고문'));
      const knownFiles = new Set(item.attachments.map((file) => file.url));
      for (const file of proof.attachments || []) {
        if (!knownFiles.has(file.url)) { item.attachments.push(file); knownFiles.add(file.url); }
      }
      const brief = item.teacherBriefing;
      if (brief) {
        brief.officialUrl = proof.url;
        brief.sourceLines = sourceLines;
        brief.officialBasis = label;
        brief.attachmentLines = (brief.attachmentLines || []).filter((line) =>
          !(line.startsWith('회사·기관 공식 공고문:') && line.includes(oldPrimary)));
        for (const file of proof.attachments || []) {
          if (!brief.attachmentLines.some((line) => line.includes(file.url))) brief.attachmentLines.push(`${file.title}: ${file.url}`);
        }
        if (brief.teacherShareText?.includes('[원문·첨부]')) {
          brief.teacherShareText = brief.teacherShareText.split('[원문·첨부]')[0]
            + '[원문·첨부]\n' + [...sourceLines, ...brief.attachmentLines].map((line) => `- ${line}`).join('\n');
        }
        if (brief.schoolActionItems?.length) brief.schoolActionItems[0] = label;
      }
      if (item.publicRecruitDetails) {
        item.publicRecruitDetails.companyNotice = proof.url ? '기관 상세 공고 확인' : '기관 상세 주소 미확인';
        item.publicRecruitDetails.sourceCheck = label;
      }
    }
  }));
  return summary;
}
