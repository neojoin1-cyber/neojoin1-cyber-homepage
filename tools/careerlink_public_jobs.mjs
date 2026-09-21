const API_ROOT = 'https://api.inhr.co.kr/v1/recruit/jd';
const DEFAULT_TIMEOUT_MS = 15000;

function safeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function htmlText(value) {
  return String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .split('\n').map(safeText).filter(Boolean).join(' ');
}

function officialContentLinks(html, attachments = []) {
  const rows = [...attachments];
  const source = String(html ?? '');
  for (const match of source.matchAll(/<(a|img)\b([^>]*?)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const url = attrs.match(tag === 'a' ? /\bhref\s*=\s*["']([^"']+)["']/i : /\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!url || !/^https:\/\//i.test(url)) continue;
    const title = tag === 'img' ? '공식 채용 안내 이미지' : '공식 채용 첨부자료';
    rows.push({ title, url });
  }
  const unique = new Map();
  for (const item of rows) {
    const url = safeText(item?.url || item?.fileUrl || item?.atchFileUrl || item?.dwnldUrl);
    if (!/^https:\/\//i.test(url) || unique.has(url)) continue;
    unique.set(url, { title: safeText(item?.title || item?.fileNm || item?.atchFileNm) || '공식 첨부자료', url });
  }
  return [...unique.values()].slice(0, 12);
}

function asRecruitment(row, detail, source, entry) {
  const info = detail?.rcrtInf || row;
  const id = safeText(info.rcrtNo || row.rcrtNo);
  if (!id) return null;
  const title = safeText(info.rcrtNm || row.rcrtNm);
  const jobs = Array.isArray(info.rcrtJobInfList) ? info.rcrtJobInfList
    : Array.isArray(row.rcrtJobInfList) ? row.rcrtJobInfList : [];
  const roles = [...new Set(jobs.map((job) => safeText(job.jobNmPath || job.jobNm)).filter(Boolean))];
  const contentHtml = info.rcrtCntn || row.rcrtCntn || '';
  const description = htmlText(contentHtml);
  const root = new URL(entry.url).origin;
  const url = `${root}/jobs/${encodeURIComponent(id)}`;
  const attachments = officialContentLinks(contentHtml, info.rcrtAtflInfList || row.rcrtAtflInfList || []);
  return {
    source: source.id,
    sourceName: source.name,
    sourceId: id,
    company: safeText(info.coNm || row.coNm || entry.employer),
    title,
    url,
    originalUrl: url,
    sourceOfficialUrl: url,
    sourceDetailUrl: url,
    publishedAt: safeText(info.rcrtDispStrtDtm || row.rcrtDispStrtDtm),
    deadline: safeText(info.rcrtAcptEndDtm || row.rcrtAcptEndDtm),
    deadlineText: safeText(info.rcrtAcptEndDtm || row.rcrtAcptEndDtm),
    education: roles.some((role) => /특성화고|직업계고|마이스터고|고졸|고등학교/.test(role))
      ? roles.filter((role) => /특성화고|직업계고|마이스터고|고졸|고등학교/.test(role)).join(' · ')
      : '',
    career: safeText(info.carrTypeGbcdNm || row.carrTypeGbcdNm),
    employmentType: safeText(info.hireTypeGbcdNm || row.hireTypeGbcdNm),
    recruitField: roles.join(' · '),
    qualificationText: description,
    description,
    attachments,
    processText: safeText(info.rcrtProcCntn || row.rcrtProcCntn),
  };
}

async function postJson(fetchImpl, url, body, { timeoutMs, headers }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.code !== '0000') throw new Error(`Careerlink API ${safeText(payload?.code) || 'response error'}`);
    return payload.data || {};
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCareerlinkPublicJobs({ entry, source, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, detailConcurrency = 3 }) {
  const origin = new URL(entry.url).origin;
  const headers = { Origin: origin, Referer: `${origin}/jobs` };
  const companyNo = safeText(entry.careerlinkCoNo);
  const groupCompanyNo = safeText(entry.careerlinkGroupCoNo || companyNo);
  if (!companyNo) throw new Error('Careerlink company identifier missing');
  const listData = await postJson(fetchImpl, `${API_ROOT}/list`, { coNo: companyNo }, { timeoutMs, headers });
  const list = Array.isArray(listData.rcrtList) ? listData.rcrtList : [];
  const limit = Math.min(60, Math.max(1, Number(entry.careerlinkMaxRecords) || 40));
  const selected = list.slice(0, limit);
  let detailFailures = 0;
  const detailResults = new Array(selected.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const index = cursor++;
      const row = selected[index];
      const rcrtNo = safeText(row.rcrtNo);
      try {
        detailResults[index] = await postJson(fetchImpl, `${API_ROOT}/inf`, {
          coNo: companyNo,
          grpCoNo: groupCompanyNo,
          rcrtNo,
          referCd: '',
          refer: '',
          pwd: ''
        }, { timeoutMs, headers });
      } catch {
        detailFailures += 1;
        detailResults[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(detailConcurrency, selected.length) }, worker));
  const records = selected.map((row, index) => asRecruitment(row, detailResults[index], source, entry)).filter(Boolean);
  return {
    records,
    listCount: list.length,
    detailFailures,
    complete: list.length <= limit && detailFailures === 0
  };
}
