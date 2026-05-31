import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'assets', 'job-feed.json');

const NOW = new Date();
const CHECKED_AT = NOW.toISOString();
const MAX_ITEMS = 40;
const REQUEST_TIMEOUT_MS = 18000;
const APPLICATION_CLOSED_RETAIN_DAYS = 21;
const JOB_ALIO_SCAN_LIMIT = 40;

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
const PROFESSIONAL_ONLY_TERMS = ['전문의', '의사', '약사', '간호사', '방사선사', '면허 소지', '면허소지', '석사', '박사', '기술사'];

const WORK24_OPEN_RECRUIT_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L21.do';
const SARAMIN_JOB_SEARCH_URL = 'https://oapi.saramin.co.kr/job-search';
const JOB_ALIO_RECRUIT_URL = 'https://job.alio.go.kr/recruit.do';

const SOURCE_CATALOG = [
  {
    id: 'work24-open-recruit',
    name: '고용24 공채속보',
    type: 'official-api',
    sourceUrl: WORK24_OPEN_RECRUIT_URL,
    group: 'public-private',
    trackHint: 'balanced',
    status: 'active',
    secretNames: ['WORK24_AUTH_KEY', 'WORKNET_AUTH_KEY']
  },
  {
    id: 'saramin-job-search',
    name: '사람인 채용공고 API',
    type: 'official-api',
    sourceUrl: SARAMIN_JOB_SEARCH_URL,
    group: 'private-platform',
    trackHint: 'balanced',
    status: 'active',
    secretNames: ['SARAMIN_ACCESS_KEY']
  },
  {
    id: 'job-alio-openapi',
    name: '잡알리오 공공기관 채용',
    type: 'official-public-web',
    sourceUrl: JOB_ALIO_RECRUIT_URL,
    group: 'public-institution',
    trackHint: 'exam',
    status: 'active',
    secretNames: [],
    message: '잡알리오 공식 공개 채용목록과 상세 원문을 제한적으로 확인'
  },
  {
    id: 'gojobs-narailter',
    name: '나라일터 일반·공무직 채용',
    type: 'official-channel-pending',
    sourceUrl: 'https://gojobs.go.kr',
    group: 'government',
    trackHint: 'exam',
    status: 'pending',
    secretNames: ['NARAILTER_API_KEY', 'NARAILTER_API_URL'],
    message: '인사혁신처 나라일터 공식 API 또는 허용된 데이터 경로 확인 후 연결'
  },
  {
    id: 'military-recruit',
    name: '군 부사관·군무원 채용',
    type: 'official-channel-pending',
    sourceUrl: 'https://www.mma.go.kr',
    group: 'military',
    trackHint: 'exam',
    status: 'pending',
    secretNames: ['MILITARY_RECRUIT_API_KEY', 'MILITARY_RECRUIT_API_URL'],
    message: '국방부·각 군 공식 모집/채용 공고 데이터 경로 확인 후 연결'
  },
  {
    id: 'jobkorea-rookie',
    name: '잡코리아 고졸채용 루키',
    type: 'official-partner-pending',
    sourceUrl: 'https://www.jobkorea.co.kr',
    group: 'private-platform',
    trackHint: 'direct',
    status: 'pending',
    secretNames: ['JOBKOREA_API_KEY', 'JOBKOREA_API_URL'],
    message: '잡코리아 공식 제휴 또는 이용 허가된 API 확인 후 연결'
  },
  {
    id: 'incruit-highschool',
    name: '인크루트 고졸·신입 채용',
    type: 'official-partner-pending',
    sourceUrl: 'https://www.incruit.com',
    group: 'private-platform',
    trackHint: 'balanced',
    status: 'pending',
    secretNames: ['INCRUIT_API_KEY', 'INCRUIT_API_URL'],
    message: '공식 제휴/API 또는 허용된 데이터 경로 확인 후 연결'
  },
  {
    id: 'albamon-youth',
    name: '알바몬 청소년·고졸 채용',
    type: 'official-partner-pending',
    sourceUrl: 'https://www.albamon.com',
    group: 'part-time',
    trackHint: 'direct',
    status: 'pending',
    secretNames: ['ALBAMON_API_KEY', 'ALBAMON_API_URL'],
    message: '공식 제휴/API 또는 허용된 데이터 경로 확인 후 연결'
  },
  {
    id: 'alba-youth',
    name: '알바천국 청소년·고졸 채용',
    type: 'official-partner-pending',
    sourceUrl: 'https://www.alba.co.kr',
    group: 'part-time',
    trackHint: 'direct',
    status: 'pending',
    secretNames: ['ALBA_API_KEY', 'ALBA_API_URL'],
    message: '공식 제휴/API 또는 허용된 데이터 경로 확인 후 연결'
  },
  {
    id: 'regional-education-job',
    name: '지역별 교육청 취업지원센터',
    type: 'official-channel-pending',
    sourceUrl: '',
    group: 'education-office',
    trackHint: 'balanced',
    status: 'pending',
    secretNames: ['EDU_JOB_CENTER_FEEDS'],
    message: '교육청별 공식 RSS/API/게시판 허용 범위 조사 후 지역 피드 묶음으로 연결'
  },
  {
    id: 'nonprofit-recruit',
    name: '비영리·공익기관 채용',
    type: 'official-channel-pending',
    sourceUrl: '',
    group: 'nonprofit',
    trackHint: 'balanced',
    status: 'pending',
    secretNames: ['NONPROFIT_RECRUIT_API_KEY', 'NONPROFIT_RECRUIT_API_URL'],
    message: '비영리기관 공식 채용 공고 경로와 이용 조건 확인 후 연결'
  }
];

const EXAM_TERMS = [
  '필기',
  '필기시험',
  '필기전형',
  'NCS',
  '직무능력검사',
  '인적성',
  '논술',
  '전공시험',
  '체력검정',
  '체력시험',
  '군무원',
  '공무원',
  '부사관',
  '공개경쟁',
  '공개채용'
];

const DIRECT_TERMS = [
  '면접',
  '수시채용',
  '상시채용',
  '채용연계',
  '현장실습',
  '산학협력',
  '서류전형',
  '실무면접',
  '입사일 협의',
  '알바',
  '파트타임'
];

const COMPANY_NOTICE_TERMS = ['채용', '모집', '공고', '입사지원', '응시자격', '전형절차', '서류전형', '면접전형'];
const GENERIC_NOTICE_TERMS = new Set([
  '채용',
  '모집',
  '공고',
  '직원',
  '기간제',
  '근로자',
  '신입',
  '경력',
  '공개',
  '무관',
  '계약직',
  '정규직'
]);

const SECTOR_TERMS = {
  military: ['부사관', '군무원', '육군', '해군', '공군', '해병대', '국방부'],
  government: ['공무원', '공무직', '임기제', '기간제근로자', '나라일터', '인사혁신처'],
  nonprofit: ['비영리', '공익', '재단', '협회', '사회복지', '법인'],
  'public-institution': ['공공기관', '공기업', '준정부기관', '잡알리오', 'NCS'],
  'large-company': ['대기업', '그룹', '공채', '공개채용', '인적성'],
  'mid-sme': ['중견기업', '중소기업', '강소기업', '일학습병행', '도제학교'],
  'part-time': ['알바', '파트타임', '시간제']
};

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

function htmlText(value) {
  return decodeXml(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|td|th|h1|h2|h3|h4)>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function extractBetween(text, start, end) {
  const from = text.indexOf(start);
  if (from === -1) return '';
  const to = end ? text.indexOf(end, from + start.length) : -1;
  return normalizeSpace(text.slice(from + start.length, to === -1 ? undefined : to));
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
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'User-Agent': 'GYO6 vocational job feed (+https://gyo6.kr)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6',
        ...(fetchOptions.headers || {})
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return body;
  } catch (error) {
    try {
      return await fetchWithNodeHttp(url, fetchOptions, timeoutMs);
    } catch (fallbackError) {
      const cause = error.cause?.code || error.message;
      throw new Error(`${fallbackError.message}; fetch fallback after ${cause}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function fetchWithNodeHttp(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, {
      method: options.method || 'GET',
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'GYO6 vocational job feed (+https://gyo6.kr)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6',
        ...(options.headers || {})
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });

    request.on('timeout', () => request.destroy(new Error('HTTP timeout')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function significantTerms(value, limit = 8) {
  return Array.from(new Set(normalizeSpace(value)
    .replace(/[()[\]{}"'“”‘’]/g, ' ')
    .split(/[\s·,./_\-:|]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !GENERIC_NOTICE_TERMS.has(term))))
    .slice(0, limit);
}

async function checkCompanyNoticeUrl(url, company, title) {
  const companyNoticeUrl = cleanUrl(url);
  if (!companyNoticeUrl) {
    return {
      status: 'not_found',
      reachable: false,
      checkedAt: CHECKED_AT
    };
  }

  try {
    const html = await fetchWithTimeout(companyNoticeUrl, { timeoutMs: 8000 });
    const text = htmlText(html).slice(0, 50000);
    const companyMatched = includesAny(text, significantTerms(company, 4));
    const titleMatched = includesAny(text, significantTerms(title, 8));
    const processMatched = includesAny(text, COMPANY_NOTICE_TERMS);
    const matched = titleMatched || (companyMatched && processMatched);

    return {
      status: matched ? 'content_matched' : 'reachable_unmatched',
      reachable: true,
      companyMatched,
      titleMatched,
      processMatched,
      checkedAt: CHECKED_AT
    };
  } catch (error) {
    return {
      status: 'fetch_failed',
      reachable: false,
      error: normalizeSpace(error.message).slice(0, 90),
      checkedAt: CHECKED_AT
    };
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

  const shortDotted = raw.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (shortDotted) {
    const year = Number(shortDotted[1]) + 2000;
    const month = shortDotted[2].padStart(2, '0');
    const day = shortDotted[3].padStart(2, '0');
    return new Date(`${year}-${month}-${day}T23:59:59+09:00`);
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

function daysBetweenKst(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${formatDate(startDate)}T00:00:00+09:00`);
  const end = new Date(`${formatDate(endDate)}T00:00:00+09:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
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

function catalogSource(id) {
  return SOURCE_CATALOG.find((source) => source.id === id) || null;
}

function includesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

function withApplicationClosedSuffix(title) {
  const normalized = normalizeSpace(title);
  if (!normalized) return normalized;
  return normalized.endsWith('(원서 마감)') ? normalized : `${normalized}(원서 마감)`;
}

function sectorLabel(sector) {
  return {
    military: '군 채용',
    government: '정부·공무직',
    nonprofit: '비영리기관',
    'public-institution': '공공기관',
    'large-company': '대기업',
    'mid-sme': '중견·중소',
    'part-time': '시간제',
    'private-platform': '민간채용',
    'education-office': '교육청'
  }[sector] || '채용분야 확인';
}

function trackLabel(track) {
  return track === 'exam-formal' ? '필기·공식전형' : '면접중심·현장형';
}

function classifySector(raw, haystack) {
  const source = catalogSource(raw.source);
  if (source?.group && source.group !== 'public-private' && source.group !== 'private-platform') {
    return source.group;
  }
  for (const [sector, terms] of Object.entries(SECTOR_TERMS)) {
    if (includesAny(haystack, terms)) return sector;
  }
  if (source?.group === 'private-platform') return 'private-platform';
  return 'mid-sme';
}

function classifyProcess(raw) {
  const source = catalogSource(raw.source);
  const haystack = [
    raw.title,
    raw.company,
    raw.region,
    raw.education,
    raw.career,
    raw.employmentType,
    raw.description,
    raw.processText,
    raw.sourceName
  ].join(' ');
  const hasExam = includesAny(haystack, EXAM_TERMS);
  const hasDirect = includesAny(haystack, DIRECT_TERMS);
  const sector = classifySector(raw, haystack);
  const labels = [sectorLabel(sector)];

  let processTrack = 'direct-interview';
  let writtenExam = 'unknown';
  let confidence = 'review';
  let note = '전형절차는 원문에서 최종 확인해야 합니다.';

  if (hasExam) {
    processTrack = 'exam-formal';
    writtenExam = 'confirmed';
    confidence = 'high';
    labels.push('필기 확인');
    note = '필기시험 또는 공식 선발 절차가 원문 키워드에서 확인됩니다.';
  } else if (hasDirect || source?.trackHint === 'direct' || ['mid-sme', 'part-time'].includes(sector)) {
    processTrack = 'direct-interview';
    writtenExam = 'not_found';
    confidence = hasDirect || source?.trackHint === 'direct' ? 'medium' : 'review';
    labels.push(hasDirect ? '면접 중심' : '필기 미확인');
    note = '필기시험은 확인되지 않았고 서류·면접 중심 채용으로 우선 분류했습니다.';
  } else if (source?.trackHint === 'exam' || ['public-institution', 'government', 'military'].includes(sector)) {
    processTrack = 'exam-formal';
    writtenExam = 'likely';
    confidence = 'medium';
    labels.push('필기 가능성 높음');
    note = '공공·군·정부 채용 성격상 필기 또는 공식 선발 절차 가능성이 높습니다.';
  }

  if (haystack.includes('공채') || haystack.includes('공개채용')) labels.push('공채');
  if (haystack.includes('학교장 추천') || haystack.includes('학교장추천')) labels.push('학교장 추천');

  return {
    processTrack,
    trackName: trackLabel(processTrack),
    writtenExam,
    processConfidence: confidence,
    sector,
    sectorName: sectorLabel(sector),
    processLabels: compactTags(labels),
    processNote: note
  };
}

function buildSourceVerification(raw, process, displayUrl) {
  const source = catalogSource(raw.source);
  const sourceOfficialUrl = cleanUrl(raw.sourceDetailUrl || raw.portalUrl || raw.originalUrl || source?.sourceUrl || '');
  const explicitCompanyNoticeUrl = cleanUrl(raw.companyNoticeUrl || raw.companyNotice || raw.companyUrl || '');
  const displayOfficialUrl = cleanUrl(displayUrl);
  const companyNoticeUrl = explicitCompanyNoticeUrl;
  const check = raw.companyNoticeCheck || {};
  const hasCompanyNotice = Boolean(companyNoticeUrl);
  const isPublicRecruit = process.processTrack === 'exam-formal';

  let doubleCheckStatus = 'company_contact_recommended';
  let doubleCheckLabel = '회사 확인 권고';
  let verificationNote = '필기시험 없는 채용은 요약 정보만 제공하고 세부 조건은 회사 공식 공고 또는 인사담당자에게 확인해야 합니다.';

  if (isPublicRecruit) {
    if (hasCompanyNotice && check.status === 'content_matched') {
      doubleCheckStatus = 'company_notice_confirmed';
      doubleCheckLabel = '공식 공고 2중확인';
      verificationNote = '공식 채용 소스와 회사·기관 또는 채용대행 공식 공지사항 내용을 함께 확인했습니다.';
    } else if (hasCompanyNotice && check.reachable) {
      doubleCheckStatus = 'company_notice_reachable';
      doubleCheckLabel = '공식 공고 접속확인';
      verificationNote = '공식 채용 소스와 회사·기관 또는 채용대행 공식 공지사항 링크를 함께 확인했습니다. 세부 문구는 원문에서 최종 확인해야 합니다.';
    } else if (hasCompanyNotice) {
      doubleCheckStatus = 'company_notice_linked';
      doubleCheckLabel = '공식 공고 링크확인';
      verificationNote = '공식 채용 소스에서 회사·기관 또는 채용대행 공식 공지사항 링크를 확보했습니다. 접속 또는 본문 대조는 추가 확인이 필요합니다.';
    } else {
      doubleCheckStatus = 'company_notice_required';
      doubleCheckLabel = '공식 공고 확인필요';
      verificationNote = '공채 상세 제공 전 회사·기관 또는 채용대행 공식 공지사항 2중 확인이 필요합니다.';
    }
  }

  return {
    sourceOfficialUrl: sourceOfficialUrl || displayOfficialUrl,
    companyNoticeUrl,
    primaryOfficialUrl: companyNoticeUrl || sourceOfficialUrl || displayOfficialUrl,
    officialNoticePriority: companyNoticeUrl
      ? 'company-or-agency-notice-first'
      : 'source-official-pending-company-or-agency-notice',
    companyNoticeCheckStatus: check.status || (hasCompanyNotice ? 'link_found' : 'not_found'),
    companyNoticeReachable: Boolean(check.reachable),
    companyNoticeMatched: Boolean(check.titleMatched || check.companyMatched),
    companyNoticeCheckedAt: check.checkedAt || '',
    doubleCheckStatus,
    doubleCheckLabel,
    verificationNote
  };
}

function buildServicePolicy(process, verification) {
  if (process.processTrack === 'exam-formal') {
    const isDetailed = ['company_notice_confirmed', 'company_notice_reachable'].includes(verification.doubleCheckStatus);
    return {
      servicePriority: 'primary-public-recruit',
      servicePolicyLabel: isDetailed ? '공채 상세' : '공채 상세 확인중',
      detailLevel: isDetailed ? 'detailed-public-recruit' : 'official-summary-pending-company-check',
      displayNote: isDetailed
        ? '회사·기관 또는 채용대행 공식 공고를 기준으로 전형, 자격, 마감 정보를 상세 확인합니다.'
        : '공채 후보로 우선 표시하되 회사·기관 또는 채용대행 공식 공지사항 2중 확인 전에는 상세 확정으로 보지 않습니다.',
      contactAdvice: '지원 전 회사·기관 채용 공지, 채용대행 접수 시스템, 첨부 공고문을 다시 확인하세요.'
    };
  }

  return {
    servicePriority: 'support-brief-direct',
    servicePolicyLabel: '간단 안내',
    detailLevel: 'brief-company-contact',
    displayNote: '필기시험 없는 채용은 중견기업 중심으로 핵심 조건만 간단히 제공합니다.',
    contactAdvice: '근무조건, 급여, 제출서류, 미성년자 근로 가능 여부는 회사 공식 공고 또는 인사담당자에게 확인하세요.'
  };
}

function buildCollectionAudit(raw, publishedDate, firstSeenAt = CHECKED_AT) {
  const publishedAt = publishedDate ? publishedDate.toISOString() : '';
  const publishedDay = formatDate(publishedDate);
  const firstSeenDate = parseDate(firstSeenAt) || NOW;
  const firstSeenDay = formatDate(firstSeenDate);
  const detectionLagDays = publishedDate ? daysBetweenKst(publishedDate, firstSeenDate) : null;

  let firstDayStatus = 'unknown';
  if (detectionLagDays === 0) firstDayStatus = 'first_day';
  else if (detectionLagDays === 1) firstDayStatus = 'next_day';
  else if (detectionLagDays !== null && detectionLagDays > 1) firstDayStatus = 'late_detected';

  return {
    policy: 'public-recruit-first-day-collection',
    publishedAt,
    publishedDate: publishedDay,
    firstSeenAt,
    firstSeenDate: firstSeenDay,
    detectionLagDays,
    firstDayCollected: detectionLagDays === 0,
    missedReviewNeeded: detectionLagDays === null || detectionLagDays > 0,
    firstDayStatus,
    note: detectionLagDays === 0
      ? '공고 게시 첫날 자동 수집 대상입니다.'
      : detectionLagDays === null
        ? '공고 게시일 확인이 필요합니다.'
        : `공고 게시 후 ${detectionLagDays}일 뒤 자동 수집되어 누락 여부 점검 대상입니다.`
  };
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
  const source = catalogSource(raw.source);
  if (source?.trackHint === 'exam') {
    score += 8;
    labels.push('공식전형');
  }
  if (source?.trackHint === 'direct') {
    score += 6;
    labels.push('면접중심');
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
  const baseTitle = normalizeSpace(raw.title);
  const company = normalizeSpace(raw.company);
  const deadlineDate = parseDate(raw.deadline || raw.deadlineTimestamp);
  const deadline = formatDate(deadlineDate);
  const deadlineDistance = daysUntil(deadlineDate);
  const url = cleanUrl(raw.url || raw.originalUrl);
  const score = scoreItem(raw);
  const process = classifyProcess(raw);
  const sourceVerification = buildSourceVerification(raw, process, url);
  const servicePolicy = buildServicePolicy(process, sourceVerification);
  const publishedDate = parseDate(raw.publishedAt || raw.registeredAt || raw.postedAt || raw.openDate || raw.postingDate);
  const collectionAudit = buildCollectionAudit(raw, publishedDate);
  const isExamFormal = process.processTrack === 'exam-formal';
  const daysAfterDeadline = deadlineDistance !== null && deadlineDistance < 0 ? Math.abs(deadlineDistance) : 0;
  const lowerText = [
    baseTitle,
    company,
    raw.education,
    raw.career,
    raw.employmentType,
    raw.description,
    raw.processText
  ].join(' ');

  let status = 'active';
  if (deadlineDistance !== null && deadlineDistance < 0) {
    status = isExamFormal && daysAfterDeadline <= APPLICATION_CLOSED_RETAIN_DAYS ? 'application_closed' : 'expired';
  }
  else if (deadlineDistance !== null && deadlineDistance <= 5) status = 'deadline_soon';
  const title = status === 'application_closed' ? withApplicationClosedSuffix(baseTitle) : baseTitle;

  let schoolRecommendation = 'unknown';
  if (lowerText.includes('학교장 추천') || lowerText.includes('학교장추천')) {
    schoolRecommendation = 'required';
  }

  const legalCheckFlags = ['원문확인', '마감확인', '학력조건확인', '추천여부확인'];
  const guideTags = compactTags([
    process.trackName,
    process.sectorName,
    raw.employmentType || '고용형태 확인',
    raw.education || '학력조건 확인',
    schoolRecommendation === 'required' ? '학교장 추천 확인' : '추천여부 확인',
    '직무기술서 확인'
  ]);

  const item = {
    id: sha([raw.source, raw.sourceId, baseTitle, company, deadline, url].join('|')),
    source: raw.source,
    sourceName: raw.sourceName,
    title,
    baseTitle,
    company,
    region: normalizeSpace(raw.region) || '원문 확인',
    education: normalizeSpace(raw.education) || '원문 확인',
    career: normalizeSpace(raw.career) || '원문 확인',
    employmentType: normalizeSpace(raw.employmentType) || '원문 확인',
    detailText: normalizeSpace(raw.description || raw.processText).slice(0, process.processTrack === 'exam-formal' ? 620 : 180),
    deadline,
    deadlineText: status === 'application_closed'
      ? (deadline ? `${deadline} 원서 마감` : '원서 마감')
      : normalizeSpace(raw.deadlineText) || (deadline ? `${deadline} 마감` : '마감일 원문 확인'),
    url: sourceVerification.primaryOfficialUrl || sourceVerification.companyNoticeUrl || url || sourceVerification.sourceOfficialUrl,
    originalUrl: sourceVerification.sourceOfficialUrl || url,
    sourceOfficialUrl: sourceVerification.sourceOfficialUrl,
    companyNoticeUrl: sourceVerification.companyNoticeUrl,
    primaryOfficialUrl: sourceVerification.primaryOfficialUrl,
    officialNoticePriority: sourceVerification.officialNoticePriority,
    supplementarySourceUrls: compactTags([
      sourceVerification.companyNoticeUrl && sourceVerification.sourceOfficialUrl ? sourceVerification.sourceOfficialUrl : '',
      sourceVerification.companyNoticeUrl && url !== sourceVerification.companyNoticeUrl ? url : ''
    ]),
    verifiedAt: CHECKED_AT,
    publishedAt: collectionAudit.publishedAt,
    publishedDate: collectionAudit.publishedDate,
    firstSeenAt: collectionAudit.firstSeenAt,
    firstSeenDate: collectionAudit.firstSeenDate,
    collectionAudit,
    fitScore: score.score,
    fitLabels: score.labels.length ? score.labels : ['원문확인'],
    processTrack: process.processTrack,
    processTrackName: process.trackName,
    writtenExam: process.writtenExam,
    processConfidence: process.processConfidence,
    processLabels: process.processLabels,
    processNote: process.processNote,
    sector: process.sector,
    sectorName: process.sectorName,
    sourceVerification,
    servicePriority: servicePolicy.servicePriority,
    servicePolicyLabel: servicePolicy.servicePolicyLabel,
    detailLevel: servicePolicy.detailLevel,
    displayNote: servicePolicy.displayNote,
    contactAdvice: servicePolicy.contactAdvice,
    publicRecruitDetails: process.processTrack === 'exam-formal' ? {
      companyNotice: sourceVerification.companyNoticeUrl ? '회사·기관 공식 공고 확인' : '회사·기관 공식 공고 확인 필요',
      sourceCheck: sourceVerification.doubleCheckLabel,
      eligibility: [normalizeSpace(raw.education), normalizeSpace(raw.career)].filter(Boolean).join(' · ') || '응시자격 원문 확인',
      process: normalizeSpace(raw.processText || process.processNote).slice(0, 260) || '전형절차 원문 확인',
      application: status === 'application_closed'
        ? (deadline ? `${deadline} 원서 마감` : '원서 마감')
        : normalizeSpace(raw.deadlineText) || (deadline ? `${deadline} 마감` : '마감일 원문 확인')
    } : null,
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
  if (item.status === 'application_closed' && item.processTrack !== 'exam-formal') return false;
  const text = [item.title, item.company, item.education, item.career, item.employmentType, item.detailText].join(' ');
  const hasStrongHighSchool = STRONG_TERMS.some((term) => text.includes(term));
  if (!hasStrongHighSchool && PROFESSIONAL_ONLY_TERMS.some((term) => text.includes(term))) return false;
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
      const trackWeight = { 'exam-formal': 0, 'direct-interview': 1 };
      const trackDiff = (trackWeight[a.processTrack] ?? 9) - (trackWeight[b.processTrack] ?? 9);
      if (trackDiff !== 0) return trackDiff;
      const verificationWeight = {
        company_notice_confirmed: 0,
        company_notice_reachable: 1,
        company_notice_linked: 2,
        company_notice_required: 3,
        company_contact_recommended: 4
      };
      const verificationDiff = (verificationWeight[a.sourceVerification?.doubleCheckStatus] ?? 9)
        - (verificationWeight[b.sourceVerification?.doubleCheckStatus] ?? 9);
      if (verificationDiff !== 0) return verificationDiff;
      const statusWeight = { deadline_soon: 0, active: 1, application_closed: 2, needs_review: 3 };
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
    group: base.group || '',
    trackHint: base.trackHint || '',
    requiredSecrets: base.secretNames || [],
    readiness: base.status || 'active',
    configured: Boolean(base.configured),
    ok: false,
    checkedAt: CHECKED_AT,
    itemCount: 0,
    message: '',
    ...overrides
  };
}

function previousItemKeys(item) {
  return [
    item.id,
    item.sourceOfficialUrl,
    item.companyNoticeUrl,
    [item.source, item.baseTitle || item.title, item.company, item.deadline || ''].join('|').toLowerCase()
  ].filter(Boolean);
}

async function readPreviousItems() {
  try {
    const json = await fs.readFile(OUT_FILE, 'utf8');
    const payload = JSON.parse(json);
    const map = new Map();
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      for (const key of previousItemKeys(item)) {
        if (!map.has(key)) map.set(key, item);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function mergePreviousAudit(items, previousItems) {
  return items.map((item) => {
    const previous = previousItemKeys(item)
      .map((key) => previousItems.get(key))
      .find(Boolean);
    if (!previous) return item;

    const firstSeenAt = previous.firstSeenAt || previous.collectionAudit?.firstSeenAt || item.firstSeenAt || CHECKED_AT;
    const firstSeenDate = parseDate(firstSeenAt) || NOW;
    const publishedDate = parseDate(item.publishedDate || item.publishedAt);
    const collectionAudit = buildCollectionAudit(item, publishedDate, firstSeenAt);
    return {
      ...item,
      firstSeenAt,
      firstSeenDate: formatDate(firstSeenDate),
      collectionAudit
    };
  });
}

function fallbackPreviousItems(previousItems) {
  const seen = new Set();
  const items = [];
  for (const item of previousItems.values()) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push({
      ...item,
      staleSourceFallback: true,
      verifiedAt: CHECKED_AT,
      displayNote: `${item.displayNote || '공식 원문 확인 필요'} 현재 실행에서 신규 수집이 0건이라 직전 정상 데이터를 임시 보존했습니다.`,
      collectionAudit: {
        ...(item.collectionAudit || {}),
        missedReviewNeeded: true,
        fallbackFromPreviousRun: true,
        note: '현재 실행에서 공식 소스 수집이 실패해 직전 정상 데이터가 임시 보존되었습니다.'
      }
    });
  }
  return items.slice(0, MAX_ITEMS);
}

async function fetchWork24OpenRecruit() {
  const key = readSecret('WORK24_AUTH_KEY', 'WORKNET_AUTH_KEY');
  const base = { ...catalogSource('work24-open-recruit'), configured: Boolean(key) };
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
          publishedAt: getXmlText(node, 'regLogImgNm') || getXmlText(node, 'empWantedStdt') || getXmlText(node, 'regDt'),
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

function parseJobAlioRows(html) {
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (match) => match[1]);
  return rows
    .map((row) => {
      const link = row.match(/href=["']\/?recruitview\.do\?idx=(\d+)["'][^>]*\/?>([\s\S]*?)<\/a>/i);
      if (!link) return null;
      const cells = Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (match) => htmlText(match[1]));
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
    })
    .filter(Boolean);
}

async function fetchJobAlioDetail(row) {
  const detailUrl = `https://job.alio.go.kr/recruitview.do?idx=${encodeURIComponent(row.idx)}`;
  const html = await fetchWithTimeout(detailUrl);
  const text = htmlText(html);
  const originalUrl = text.match(/공고 URL\s*:\s*(https?:\/\/\S+)/);
  const education = extractBetween(text, '학력정보', '근무분야') || '원문 확인';
  const workField = extractBetween(text, '근무분야', '채용구분');
  const career = extractBetween(text, '채용구분', '고용형태') || '원문 확인';
  const employmentType = extractBetween(text, '고용형태', '대체인력여부') || row.employmentType;
  const region = extractBetween(text, '근무지', '급여정보') || row.region;
  const qualification = extractBetween(text, '응시자격', '결격사유');
  const preference = extractBetween(text, '우대내용', '전형절차/방법');
  const processText = extractBetween(text, '전형절차/방법', '공고문');
  const deadline = row.deadline.match(/\d{2}\.\d{2}\.\d{2}/)?.[0] || row.deadline;
  const companyNoticeUrl = originalUrl ? cleanUrl(originalUrl[1]) : '';
  const companyNoticeCheck = await checkCompanyNoticeUrl(companyNoticeUrl, row.company, row.title);

  return {
    source: 'job-alio-openapi',
    sourceName: '잡알리오 공공기관 채용',
    sourceId: row.idx,
    title: row.title,
    company: row.company,
    region,
    education,
    career,
    employmentType,
    deadline,
    deadlineText: deadline ? `${deadline} 마감` : '마감일 원문 확인',
    publishedAt: row.registeredAt,
    url: companyNoticeUrl || detailUrl,
    originalUrl: detailUrl,
    sourceDetailUrl: detailUrl,
    companyNoticeUrl,
    companyNoticeCheck,
    processText,
    description: [
      workField,
      qualification,
      preference,
      processText,
      row.status,
      '잡알리오 공공기관 채용'
    ].join(' ')
  };
}

async function fetchJobAlioRecruit() {
  const base = { ...catalogSource('job-alio-openapi'), configured: true };
  const rawItems = [];
  const errors = [];
  let scannedCount = 0;

  try {
    const html = await fetchWithTimeout(JOB_ALIO_RECRUIT_URL);
    const rows = parseJobAlioRows(html).slice(0, JOB_ALIO_SCAN_LIMIT);
    scannedCount = rows.length;
    for (const row of rows) {
      try {
        rawItems.push(await fetchJobAlioDetail(row));
      } catch (error) {
        errors.push(`${row.idx}: ${error.message}`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  const normalized = rawItems.map(normalizeItem).filter(shouldKeep);
  const ok = rawItems.length > 0 && errors.length < Math.max(1, rawItems.length);
  const companyChecked = normalized.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable'
  ].includes(item.sourceVerification?.doubleCheckStatus)).length;
  const firstDayCandidates = normalized.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const missedReview = normalized.filter((item) => item.collectionAudit?.missedReviewNeeded).length;
  return {
    items: normalized,
    status: sourceStatus(base, {
      ok,
      itemCount: normalized.length,
      scannedCount,
      rawItemCount: rawItems.length,
      firstDayCandidates,
      missedReviewNeeded: missedReview,
      message: ok
        ? `공식 공개 원문 ${scannedCount}건 점검, 공식 공고 확인 ${companyChecked}건, 첫날 수집 ${firstDayCandidates}건, 누락점검 ${missedReview}건`
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
  const base = { ...catalogSource('saramin-job-search'), configured: Boolean(key) };
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
          publishedAt: textValue(job['posting-date'] || job.postingDate),
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
  const catalog = catalogSource(id);
  const base = catalog || {
    id,
    name,
    type: 'official-api-pending',
    sourceUrl,
    group: '',
    trackHint: '',
    status: 'pending',
    secretNames: []
  };
  const configured = (base.secretNames || []).some((secretName) => Boolean(readSecret(secretName)));
  return {
    items: [],
    status: sourceStatus({ ...base, configured }, {
      ok: false,
      message: configured
        ? `${message || base.message || '공식 연계 어댑터 구현 필요'}`
        : `${message || base.message || '공식 연계 정보 확인 대기'}`
    })
  };
}

function pendingCatalogSources() {
  return SOURCE_CATALOG
    .filter((source) => source.status !== 'active')
    .map((source) => disabledSource(source.id, source.name, source.message, source.sourceUrl));
}

async function main() {
  const previousItems = await readPreviousItems();
  const results = [];
  results.push(await fetchWork24OpenRecruit());
  results.push(await fetchJobAlioRecruit());
  results.push(await fetchSaraminJobSearch());
  results.push(...pendingCatalogSources());

  const currentItems = dedupeAndSort(results.flatMap((result) => result.items));
  const items = currentItems.length
    ? mergePreviousAudit(currentItems, previousItems)
    : fallbackPreviousItems(previousItems);
  const sourceStatusList = results.map((result) => result.status);
  const active = items.filter((item) => item.status === 'active').length;
  const deadlineSoon = items.filter((item) => item.status === 'deadline_soon').length;
  const applicationClosed = items.filter((item) => item.status === 'application_closed').length;
  const examFormal = items.filter((item) => item.processTrack === 'exam-formal').length;
  const directInterview = items.filter((item) => item.processTrack === 'direct-interview').length;
  const companyNoticeChecked = items.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable'
  ].includes(item.sourceVerification?.doubleCheckStatus)).length;
  const detailedPublicRecruit = items.filter((item) => item.detailLevel === 'detailed-public-recruit').length;
  const briefDirect = items.filter((item) => item.detailLevel === 'brief-company-contact').length;
  const firstDayCollected = items.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const lateDetected = items.filter((item) => item.collectionAudit?.firstDayStatus === 'late_detected').length;
  const missedReviewNeeded = items.filter((item) => item.collectionAudit?.missedReviewNeeded).length;
  const staleFallbackItems = items.filter((item) => item.staleSourceFallback).length;
  const sourcesConfigured = sourceStatusList.filter((source) => source.configured).length;

  const payload = {
    version: 3,
    generatedAt: CHECKED_AT,
    timezone: 'Asia/Seoul',
    schedule: '09:10, 14:10, 19:10 KST',
    mode: 'official-public-recruit-auto-registration',
    summary: {
      total: items.length,
      active,
      deadlineSoon,
      applicationClosed,
      examFormal,
      directInterview,
      companyNoticeChecked,
      detailedPublicRecruit,
      briefDirect,
      firstDayCollected,
      lateDetected,
      missedReviewNeeded,
      staleFallbackItems,
      sourcesChecked: sourceStatusList.length,
      sourcesConfigured,
      note: staleFallbackItems
        ? '현재 실행에서 신규 수집이 0건이라 직전 정상 공고를 임시 보존하고 공식 소스 점검이 필요합니다.'
        : sourcesConfigured
        ? '공채 첫날 수집을 최우선으로 점검하고, 공식 공고 2중 확인 중심으로 자동 분류했습니다.'
        : '공식 API 키가 아직 연결되지 않아 자동 수집 대기 상태입니다.'
    },
    collectionPolicy: {
      goal: '공채는 공고 게시 첫날 수집을 최대 과제로 삼고, 늦게 발견된 공고는 누락 점검 대상으로 표시한다.',
      firstDayField: 'collectionAudit.firstDayCollected',
      missedReviewField: 'collectionAudit.missedReviewNeeded',
      applicationClosedTitleSuffix: '(원서 마감)',
      applicationClosedRetainDays: APPLICATION_CLOSED_RETAIN_DAYS,
      jobAlioScanLimit: JOB_ALIO_SCAN_LIMIT,
      primarySourceRule: '회사·기관 자체 홈페이지 또는 채용대행 공식 공고를 최우선 원문으로 사용하고, 잡알리오·고용24·사람인 등은 보완 출처로 사용한다.'
    },
    tracks: [
      {
        id: 'exam-formal',
        name: '필기·공식전형 공채',
        description: '대기업, 공공기관, 군 부사관·군무원, 정부·비영리기관처럼 공식 공채 절차가 있는 채용. 회사·기관 공지사항 2중 확인 후 상세 제공한다.'
      },
      {
        id: 'direct-interview',
        name: '면접중심·현장형 채용',
        description: '필기시험이 확인되지 않은 중견기업 중심 채용. 핵심 조건만 간단히 제공하고 세부 조건은 회사 확인을 안내한다.'
      }
    ],
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
    version: 3,
    generatedAt: CHECKED_AT,
    timezone: 'Asia/Seoul',
    schedule: '09:10, 14:10, 19:10 KST',
    mode: 'official-public-recruit-auto-registration',
    summary: {
      total: 0,
      active: 0,
      deadlineSoon: 0,
      applicationClosed: 0,
      examFormal: 0,
      directInterview: 0,
      companyNoticeChecked: 0,
      detailedPublicRecruit: 0,
      briefDirect: 0,
      firstDayCollected: 0,
      lateDetected: 0,
      missedReviewNeeded: 0,
      staleFallbackItems: 0,
      sourcesChecked: 0,
      sourcesConfigured: 0,
      note: '자동 수집 실행 중 오류가 발생했습니다.'
    },
    tracks: [
      {
        id: 'exam-formal',
        name: '필기·공식전형 공채',
        description: '대기업, 공공기관, 군 부사관·군무원, 정부·비영리기관처럼 공식 공채 절차가 있는 채용. 회사·기관 공지사항 2중 확인 후 상세 제공한다.'
      },
      {
        id: 'direct-interview',
        name: '면접중심·현장형 채용',
        description: '필기시험이 확인되지 않은 중견기업 중심 채용. 핵심 조건만 간단히 제공하고 세부 조건은 회사 확인을 안내한다.'
      }
    ],
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
