import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'data', 'job-feed.json');

const NOW = new Date();
const CHECKED_AT = NOW.toISOString();
const MAX_ITEMS = 40;
const REQUEST_TIMEOUT_MS = 18000;

const HIGH_SCHOOL_TERMS = [
  '고졸',
  '고등학교',
  '특성화고',
  '직업계고',
  '마이스터고',
  '졸업예정',
  '졸업 예정',
  '학교장 추천',
  '학교장추천',
  '학력무관',
  '학력 무관',
  '신입',
  '공채',
  '채용연계',
  '채용 연계'
];

const STRONG_TERMS = ['고졸', '특성화고', '직업계고', '마이스터고', '학교장 추천', '학교장추천'];
const NEGATIVE_EDU_TERMS = ['대졸 이상', '4년제', '대학교 졸업', '학사 이상', '석사', '박사'];

const WORK24_OPEN_RECRUIT_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L21.do';
const SARAMIN_JOB_SEARCH_URL = 'https://oapi.saramin.co.kr/job-search';

function readSecret(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 18);
}

function textValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value === 'object') {
    if (typeof value.name === 'string') return value.name.trim();
    if (typeof value['#text'] === 'string') return value['#text'].trim();
  }
  return '';
}

function normalizeSpace(value) {
  return textValue(value).replace(/\s+/g, ' ').trim();
}

function decodeXml(value) {
  return normalizeSpace(value)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getXmlNodes(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  return Array.from(xml.matchAll(pattern), (match) => match[1]);
}

function getXmlText(xml, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(pattern);
  return match ? decodeXml(match[1]) : '';
}

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'GYO6 vocational job feed (+https://gyo6.kr)',
        ...(options.headers || {})
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function parseDate(value) {
  const raw = normalizeSpace(value);
  if (!raw) return null;

  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw);
    const ms = raw.length === 13 ? timestamp : timestamp * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T23:59:59+09:00`);

  const dotted = raw.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (dotted) {
    const month = dotted[2].padStart(2, '0');
    const day = dotted[3].padStart(2, '0');
    return new Date(`${dotted[1]}-${month}-${day}T23:59:59+09:00`);
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function daysUntil(date) {
  if (!date) return null;
  const nowKst = new Date(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(NOW));
  const targetKst = new Date(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date));
  return Math.round((targetKst.getTime() - nowKst.getTime()) / 86400000);
}

function cleanUrl(value) {
  const raw = normalizeSpace(value);
  if (!raw) return '';
  try {
    return new URL(raw).toString();
  } catch {
    return raw;
  }
}

function compactTags(tags) {
  return Array.from(new Set(tags.filter(Boolean).map(normalizeSpace))).slice(0, 6);
}

function scoreItem(raw) {
  const haystack = [
    raw.title,
    raw.company,
    raw.education,
    raw.career,
    raw.employmentType,
    raw.region,
    raw.description
  ].join(' ');

  let score = 0;
  const labels = [];

  for (const term of STRONG_TERMS) {
    if (haystack.includes(term)) {
      score += term.includes('학교장') ? 26 : 30;
      labels.push(term.replace('학교장추천', '학교장 추천'));
    }
  }

  if (haystack.includes('학력무관') || haystack.includes('학력 무관')) {
    score += 18;
    labels.push('학력무관');
  }
  if (haystack.includes('신입') || haystack.includes('경력무관')) {
    score += 12;
    labels.push('신입·경력무관');
  }
  if (haystack.includes('공채')) {
    score += 14;
    labels.push('공채');
  }
  if (haystack.includes('채용연계') || haystack.includes('채용 연계')) {
    score += 10;
    labels.push('채용연계');
  }
  if (raw.source === 'work24-open-recruit') {
    score += 8;
    labels.push('고용24 공채속보');
  }
  if (raw.source === 'saramin-job-search') {
    score += 6;
    labels.push('사람인 공채속보');
  }

  const hasPositiveTerm = HIGH_SCHOOL_TERMS.some((term) => haystack.includes(term));
  const hasNegativeEduOnly = NEGATIVE_EDU_TERMS.some((term) => haystack.includes(term)) && !hasPositiveTerm;
  if (hasNegativeEduOnly) score -= 30;

  return {
    score: Math.max(0, Math.min(100, score)),
    labels: compactTags(labels)
  };
}

function normalizeItem(raw) {
  const title = normalizeSpace(raw.title);
  const company = normalizeSpace(raw.company);
  const deadlineDate = parseDate(raw.deadline || raw.deadlineTimestamp);
  const deadline = formatDate(deadlineDate);
  const deadlineDistance = daysUntil(deadlineDate);
  const url = cleanUrl(raw.url || raw.originalUrl);
  const score = scoreItem(raw);
  const lowerText = [
    title,
    company,
    raw.education,
    raw.career,
    raw.employmentType,
    raw.description
  ].join(' ');

  let status = 'active';
  if (deadlineDistance !== null && deadlineDistance < 0) status = 'expired';
  else if (deadlineDistance !== null && deadlineDistance <= 5) status = 'deadline_soon';

  let schoolRecommendation = 'unknown';
  if (lowerText.includes('학교장 추천') || lowerText.includes('학교장추천')) {
    schoolRecommendation = 'required';
  }

  const legalCheckFlags = ['원문확인', '마감확인', '학력조건확인', '추천여부확인'];
  const guideTags = compactTags([
    raw.employmentType || '고용형태 확인',
    raw.education || '학력조건 확인',
    schoolRecommendation === 'required' ? '학교장 추천 확인' : '추천여부 확인',
    '직무기술서 확인'
  ]);

  const item = {
    id: sha([raw.source, raw.sourceId, title, company, deadline, url].join('|')),
    source: raw.source,
    sourceName: raw.sourceName,
    title,
    company,
    region: normalizeSpace(raw.region) || '원문 확인',
    education: normalizeSpace(raw.education) || '원문 확인',
    career: normalizeSpace(raw.career) || '원문 확인',
    employmentType: normalizeSpace(raw.employmentType) || '원문 확인',
    deadline,
    deadlineText: normalizeSpace(raw.deadlineText) || (deadline ? `${deadline} 마감` : '마감일 원문 확인'),
    url,
    originalUrl: url,
    verifiedAt: CHECKED_AT,
    fitScore: score.score,
    fitLabels: score.labels.length ? score.labels : ['원문확인'],
    schoolRecommendation,
    status,
    legalCheckFlags,
    guideTags
  };

  return item;
}

function shouldKeep(item) {
  if (!item.title || !item.company || !item.url) return false;
  if (item.status === 'expired') return false;
  if (item.fitScore >= 24) return true;
  return item.education.includes('고졸') || item.education.includes('학력무관');
}

function dedupeAndSort(items) {
  const seen = new Map();
  for (const item of items) {
    const key = [
      item.source,
      item.originalUrl || item.url,
      item.title,
      item.company,
      item.deadline || ''
    ].join('|').toLowerCase();
    const existing = seen.get(key);
    if (!existing || item.fitScore > existing.fitScore) seen.set(key, item);
  }

  return Array.from(seen.values())
    .sort((a, b) => {
      const statusWeight = { deadline_soon: 0, active: 1, needs_review: 2 };
      const statusDiff = (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return a.title.localeCompare(b.title, 'ko-KR');
    })
    .slice(0, MAX_ITEMS);
}

function sourceStatus(base, overrides = {}) {
  return {
    id: base.id,
    name: base.name,
    type: base.type,
    sourceUrl: base.sourceUrl,
    configured: Boolean(base.configured),
    ok: false,
    checkedAt: CHECKED_AT,
    itemCount: 0,
    message: '',
    ...overrides
  };
}

async function fetchWork24OpenRecruit() {
  const key = readSecret('WORK24_AUTH_KEY', 'WORKNET_AUTH_KEY');
  const base = {
    id: 'work24-open-recruit',
    name: '고용24 공채속보',
    type: 'official-api',
    sourceUrl: WORK24_OPEN_RECRUIT_URL,
    configured: Boolean(key)
  };
  if (!key) {
    return {
      items: [],
      status: sourceStatus(base, { message: 'GitHub Secret WORK24_AUTH_KEY 또는 WORKNET_AUTH_KEY 미설정' })
    };
  }

  const requests = [
    { empWantedEduCd: '10|99', sortField: 'regDt', sortOrderBy: 'desc' },
    { empWantedTitle: '고졸', sortField: 'regDt', sortOrderBy: 'desc' },
    { empWantedTitle: '특성화고', sortField: 'regDt', sortOrderBy: 'desc' },
    { empWantedTitle: '마이스터고', sortField: 'regDt', sortOrderBy: 'desc' },
    { empWantedTitle: '학교장 추천', sortField: 'regDt', sortOrderBy: 'desc' }
  ];

  const rawItems = [];
  const errors = [];

  for (const params of requests) {
    const url = buildUrl(WORK24_OPEN_RECRUIT_URL, {
      authKey: key,
      callTp: 'L',
      returnType: 'XML',
      startPage: 1,
      display: 100,
      ...params
    });

    try {
      const xml = await fetchWithTimeout(url);
      const nodes = getXmlNodes(xml, 'dhsOpenEmpInfo');
      for (const node of nodes) {
        rawItems.push({
          source: base.id,
          sourceName: base.name,
          sourceId: getXmlText(node, 'empSeqno'),
          title: getXmlText(node, 'empWantedTitle'),
          company: getXmlText(node, 'empBusiNm'),
          region: getXmlText(node, 'coClcdNm'),
          education: params.empWantedEduCd === '10|99' ? '고졸 또는 학력무관' : '',
          career: '',
          employmentType: getXmlText(node, 'empWantedTypeNm'),
          deadline: getXmlText(node, 'empWantedEndt'),
          deadlineText: getXmlText(node, 'empWantedEndt') ? `${getXmlText(node, 'empWantedEndt')} 마감` : '',
          url: getXmlText(node, 'empWantedHomepgDetail') || getXmlText(node, 'empWantedMobileUrl'),
          description: [getXmlText(node, 'empWantedTitle'), getXmlText(node, 'coClcdNm')].join(' ')
        });
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const normalized = rawItems.map(normalizeItem).filter(shouldKeep);
  const ok = errors.length < requests.length;
  return {
    items: normalized,
    status: sourceStatus(base, {
      ok,
      itemCount: normalized.length,
      message: ok
        ? `정상 확인, 후보 ${normalized.length}건`
        : `연결 실패: ${errors.slice(0, 2).join('; ')}`
    })
  };
}

function saraminJobArray(payload) {
  const jobs = payload?.jobs?.job ?? payload?.job ?? [];
  if (Array.isArray(jobs)) return jobs;
  if (jobs && typeof jobs === 'object') return [jobs];
  return [];
}

async function fetchSaraminJobSearch() {
  const key = readSecret('SARAMIN_ACCESS_KEY');
  const base = {
    id: 'saramin-job-search',
    name: '사람인 채용공고 API',
    type: 'official-api',
    sourceUrl: SARAMIN_JOB_SEARCH_URL,
    configured: Boolean(key)
  };
  if (!key) {
    return {
      items: [],
      status: sourceStatus(base, { message: 'GitHub Secret SARAMIN_ACCESS_KEY 미설정' })
    };
  }

  const queries = ['고졸', '특성화고', '직업계고', '마이스터고', '학교장 추천'];
  const rawItems = [];
  const errors = [];

  for (const keywords of queries) {
    const url = buildUrl(SARAMIN_JOB_SEARCH_URL, {
      'access-key': key,
      keywords,
      bbs_gb: 1,
      sr: 'directhire',
      fields: 'posting-date,expiration-date,keyword-code',
      start: 0,
      count: 100
    });

    try {
      const body = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
      const payload = JSON.parse(body);
      if (payload?.code && payload?.message) {
        throw new Error(`API ${payload.code}`);
      }
      for (const job of saraminJobArray(payload)) {
        const position = job.position || {};
        const expirationTimestamp = textValue(job['expiration-timestamp'] || job.expirationTimestamp);
        rawItems.push({
          source: base.id,
          sourceName: base.name,
          sourceId: textValue(job.id),
          title: textValue(position.title || job.title),
          company: textValue(job.company?.detail?.name || job.company?.name),
          region: textValue(position.location?.name),
          education: textValue(position['required-education-level']?.name),
          career: textValue(position['experience-level']?.name),
          employmentType: textValue(position['job-type']?.name),
          deadline: textValue(job['expiration-date']),
          deadlineTimestamp: expirationTimestamp,
          deadlineText: textValue(job['close-type']?.name),
          url: textValue(job.url),
          description: [
            keywords,
            textValue(position.industry?.name),
            textValue(position['job-mid-code']?.name),
            textValue(position['job-code']?.name)
          ].join(' ')
        });
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const normalized = rawItems.map(normalizeItem).filter(shouldKeep);
  const ok = errors.length < queries.length;
  return {
    items: normalized,
    status: sourceStatus(base, {
      ok,
      itemCount: normalized.length,
      message: ok
        ? `정상 확인, 후보 ${normalized.length}건`
        : `연결 실패: ${errors.slice(0, 2).join('; ')}`
    })
  };
}

function disabledSource(id, name, message, sourceUrl = '') {
  return {
    items: [],
    status: sourceStatus({
      id,
      name,
      type: 'official-api-pending',
      sourceUrl,
      configured: false
    }, { message })
  };
}

async function main() {
  const results = [];
  results.push(await fetchWork24OpenRecruit());
  results.push(await fetchSaraminJobSearch());
  results.push(disabledSource('jobkorea-official', '잡코리아 공식 연계', '공식 API/제휴 엔드포인트 확인 후 JOBKOREA_API_URL로 연결 예정'));
  results.push(disabledSource('regional-youth-job', '지역·공공 청년일자리 API', '공식 제공 API와 이용조건 확인 후 추가 예정'));

  const items = dedupeAndSort(results.flatMap((result) => result.items));
  const sourceStatusList = results.map((result) => result.status);
  const active = items.filter((item) => item.status === 'active').length;
  const deadlineSoon = items.filter((item) => item.status === 'deadline_soon').length;
  const sourcesConfigured = sourceStatusList.filter((source) => source.configured).length;

  const payload = {
    version: 1,
    generatedAt: CHECKED_AT,
    timezone: 'Asia/Seoul',
    schedule: '09:10, 14:10, 19:10 KST',
    mode: 'official-api-auto-registration',
    summary: {
      total: items.length,
      active,
      deadlineSoon,
      sourcesChecked: sourceStatusList.length,
      sourcesConfigured,
      note: sourcesConfigured
        ? '공식 API 응답을 정규화해 자동 등록했습니다.'
        : '공식 API 키가 아직 연결되지 않아 자동 수집 대기 상태입니다.'
    },
    sourceStatus: sourceStatusList,
    items
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(`${OUT_FILE}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(`${OUT_FILE}.tmp`, OUT_FILE);
  console.log(`job-feed: ${items.length} items, ${sourcesConfigured} configured sources`);
}

main().catch(async (error) => {
  const payload = {
    version: 1,
    generatedAt: CHECKED_AT,
    timezone: 'Asia/Seoul',
    schedule: '09:10, 14:10, 19:10 KST',
    mode: 'official-api-auto-registration',
    summary: {
      total: 0,
      active: 0,
      deadlineSoon: 0,
      sourcesChecked: 0,
      sourcesConfigured: 0,
      note: '자동 수집 실행 중 오류가 발생했습니다.'
    },
    sourceStatus: [
      sourceStatus({
        id: 'job-feed-runner',
        name: '자동 수집 실행기',
        type: 'runner',
        sourceUrl: '',
        configured: true
      }, { message: error.message })
    ],
    items: []
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.error(`job-feed failed: ${error.message}`);
  process.exitCode = 1;
});
