const LIST_URL = 'https://job.alio.go.kr/recruit.do';
const PAGE_SIZE = 10;
const USER_AGENT = 'Gyo6-JobDiscovery/1.0 (+https://gyo6.kr/jobs.html)';
export const JOB_ALIO_HIGH_SCHOOL_EDUCATION_FILTER = Object.freeze({
  education: 'R7030',
  eduTypes: Object.freeze(['single', 'multi']),
  lookbackDays: 90
});
export const JOB_ALIO_HIGH_SCHOOL_KEYWORD_QUERIES = Object.freeze([
  '고졸', '고등학교', '졸업예정', '특성화고', '학력무관'
]);

const decodeHtml = (value) => String(value || '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
    const point = code[0].toLowerCase() === 'x' ? Number.parseInt(code.slice(1), 16) : Number(code);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
  });

const htmlText = (value) => decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseJobAlioRows(html) {
  const rows = Array.from(String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
  return rows.map((match) => {
    const link = match[1].match(/href=["']\/?recruitview\.do\?idx=(\d+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) return null;
    const cells = Array.from(match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (cell) => htmlText(cell[1]));
    return {
      idx: link[1],
      title: htmlText(link[2]),
      company: cells[3] || '',
      region: cells[4] || '',
      employmentType: cells[5] || '',
      registeredAt: cells[6] || '',
      deadline: cells[7] || '',
      status: cells[8] || ''
    };
  }).filter(Boolean);
}

function koreaDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const field = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

function dateDaysBefore(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function mergeCookies(current, response) {
  const jar = new Map((current || '').split(/;\s*/).filter(Boolean).map((entry) => {
    const split = entry.indexOf('=');
    return [entry.slice(0, split), entry.slice(split + 1)];
  }));
  for (const value of (response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''])) {
    const pair = value.split(';', 1)[0];
    const split = pair.indexOf('=');
    if (split > 0) jar.set(pair.slice(0, split), pair.slice(split + 1));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function csrfToken(html) {
  return html.match(/name=["']_csrf["'][^>]*value=["']([^"']*)["']/i)?.[1] || '';
}

function cleanFailure(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status > 0 ? `http-${status}` : 'request-failed';
}

export async function fetchJobAlioHighSchoolRows({
  fetchImpl = fetch,
  now = new Date(),
  lookbackDays = JOB_ALIO_HIGH_SCHOOL_EDUCATION_FILTER.lookbackDays,
  maxPagesPerType = 50,
  maxPagesPerKeyword = 20,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  const today = koreaDate(now);
  const startDate = dateDaysBefore(today, lookbackDays);
  const result = {
    rows: [],
    pagination: { complete: true, lookbackDays, pageSize: PAGE_SIZE, maxPagesPerType, queries: [], issues: [] }
  };
  let cookies = '';
  let csrf = '';

  try {
    const response = await fetchImpl(LIST_URL, {
      headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Object.assign(new Error('List unavailable'), { status: response.status });
    const html = await response.text();
    cookies = mergeCookies(cookies, response);
    csrf = csrfToken(html);
  } catch (error) {
    result.pagination.complete = false;
    result.pagination.issues.push({ type: cleanFailure(error), phase: 'session' });
    return result;
  }

  const allRows = new Map();
  for (const eduType of JOB_ALIO_HIGH_SCHOOL_EDUCATION_FILTER.eduTypes) {
    const query = { eduType, pages: 0, complete: false, discovered: 0 };
    result.pagination.queries.push(query);
    const fingerprints = new Set();
    for (let pageNo = 1; pageNo <= maxPagesPerType; pageNo += 1) {
      if (pageNo > 1 || eduType === 'multi') await pause(350);
      const form = new URLSearchParams({
        _csrf: csrf,
        pageNo: String(pageNo),
        s_date: startDate.replaceAll('-', '.'),
        e_date: today.replaceAll('-', '.'),
        education: JOB_ALIO_HIGH_SCHOOL_EDUCATION_FILTER.education,
        eduType,
        search_type: '',
        keyword: ''
      });
      try {
        const response = await fetchImpl(LIST_URL, {
          method: 'POST',
          headers: {
            Accept: 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            Origin: 'https://job.alio.go.kr',
            Referer: LIST_URL,
            ...(cookies ? { Cookie: cookies } : {})
          },
          body: form,
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw Object.assign(new Error('Search unavailable'), { status: response.status });
        const html = await response.text();
        cookies = mergeCookies(cookies, response);
        csrf = csrfToken(html) || csrf;
        const rows = parseJobAlioRows(html);
        query.pages += 1;
        query.discovered += rows.length;
        if (!rows.length) {
          query.complete = true;
          break;
        }
        const fingerprint = rows.map((row) => row.idx).join('|');
        if (fingerprints.has(fingerprint)) {
          result.pagination.complete = false;
          result.pagination.issues.push({ type: 'repeated-page', eduType, page: pageNo });
          break;
        }
        fingerprints.add(fingerprint);
        for (const row of rows) {
          const existing = allRows.get(row.idx);
          const scanReason = `education-high-school-${eduType}`;
          allRows.set(row.idx, {
            ...existing,
            ...row,
            scanReasons: [...new Set([...(existing?.scanReasons || []), scanReason])],
            priority: 0,
            educationFilterMatch: true
          });
        }
        if (pageNo === maxPagesPerType) {
          result.pagination.complete = false;
          result.pagination.issues.push({ type: 'page-limit', eduType, page: pageNo });
        }
      } catch (error) {
        result.pagination.complete = false;
        result.pagination.issues.push({ type: cleanFailure(error), eduType, page: pageNo });
        break;
      }
    }
    if (!query.complete && !result.pagination.issues.some((issue) => issue.eduType === eduType)) {
      result.pagination.complete = false;
      result.pagination.issues.push({ type: 'incomplete-query', eduType });
    }
  }

  // Some agencies mislabel education filters; search eligibility text across all employers too.
  result.pagination.keywordQueries = [];
  for (const keyword of JOB_ALIO_HIGH_SCHOOL_KEYWORD_QUERIES) {
    const query = { keyword, searchType: 'elig', pages: 0, complete: false, discovered: 0 };
    result.pagination.keywordQueries.push(query);
    const fingerprints = new Set();
    for (let pageNo = 1; pageNo <= maxPagesPerKeyword; pageNo += 1) {
      await pause(350);
      const form = new URLSearchParams({
        _csrf: csrf,
        pageNo: String(pageNo),
        s_date: startDate.replaceAll('-', '.'),
        e_date: today.replaceAll('-', '.'),
        search_type: query.searchType,
        keyword
      });
      try {
        const response = await fetchImpl(LIST_URL, {
          method: 'POST',
          headers: {
            Accept: 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
            Origin: 'https://job.alio.go.kr',
            Referer: LIST_URL,
            ...(cookies ? { Cookie: cookies } : {})
          },
          body: form,
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw Object.assign(new Error('Keyword search unavailable'), { status: response.status });
        const html = await response.text();
        cookies = mergeCookies(cookies, response);
        csrf = csrfToken(html) || csrf;
        const rows = parseJobAlioRows(html);
        query.pages += 1;
        query.discovered += rows.length;
        if (!rows.length) { query.complete = true; break; }
        const fingerprint = rows.map((row) => row.idx).join('|');
        if (fingerprints.has(fingerprint)) {
          result.pagination.keywordSearchIssues ||= [];
          result.pagination.keywordSearchIssues.push({ type: 'repeated-page', keyword, page: pageNo });
          break;
        }
        fingerprints.add(fingerprint);
        for (const row of rows) {
          const existing = allRows.get(row.idx);
          allRows.set(row.idx, {
            ...existing,
            ...row,
            scanReasons: [...new Set([...(existing?.scanReasons || []), `eligibility-keyword:${keyword}`])],
            priority: Math.min(existing?.priority ?? 99, 1)
          });
        }
        if (pageNo === maxPagesPerKeyword) {
          result.pagination.keywordSearchIssues ||= [];
          result.pagination.keywordSearchIssues.push({ type: 'page-limit', keyword, page: pageNo });
        }
      } catch (error) {
        result.pagination.keywordSearchIssues ||= [];
        result.pagination.keywordSearchIssues.push({ type: cleanFailure(error), keyword, page: pageNo });
        break;
      }
    }
  }
  result.pagination.keywordSearchComplete = !result.pagination.keywordSearchIssues?.length
    && result.pagination.keywordQueries.every((query) => query.complete);
  result.rows = [...allRows.values()];
  result.pagination.discovered = result.rows.length;
  return result;
}
