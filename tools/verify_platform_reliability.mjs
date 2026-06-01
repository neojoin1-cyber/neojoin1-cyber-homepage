import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const DO_LIVE = args.has('--live');
const DO_EXTERNAL_LINKS = args.has('--external-links');
const LIVE_HOME = 'https://gyo6.kr/';
const LIVE_FEED = 'https://gyo6.kr/assets/job-feed.json';
const MAX_FEED_AGE_HOURS = 48;
const HIGH_SCHOOL_STRONG_TERMS = ['고졸', '특성화고', '직업계고', '마이스터고', '학교장 추천', '학교장추천'];
const ENTRY_LEVEL_TERMS = ['고졸', '고등학교', '특성화고', '직업계고', '마이스터고', '졸업예정', '졸업 예정', '학교장 추천', '학교장추천', '고졸제한', '고졸 제한', '사회형평 고졸', '신입', '경력무관', '신입+경력', '신입·경력', '청년인턴', '채용형 인턴', '공무직', '업무지원직', '기간제', '9급', '지역인재', '기능인재'];
const SENIOR_ROLE_PATTERN = /(원장|센터장|기관장|본부장|부원장|개방형\s*직위|전문계약직|연봉계약직|임원|상임감사|비상임감사|감사위원|이사장|대표이사)/;
const RESTRICTED_ROLE_PATTERN = /(관리직|별정직|책임연구원|선임연구원|교수)/;

const checks = [];

function record(severity, id, ok, message, detail = '') {
  checks.push({ severity, id, ok, message, detail });
}

function fail(id, ok, message, detail = '') {
  record('fail', id, ok, message, detail);
}

function warn(id, ok, message, detail = '') {
  record('warn', id, ok, message, detail);
}

function info(id, ok, message, detail = '') {
  record('info', id, ok, message, detail);
}

async function readText(relativePath) {
  return fs.readFile(path.join(ROOT_DIR, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value || '').slice(0, 90);
  }
}

function hoursSince(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / 3600000;
}

function countItems(items, predicate) {
  return items.filter(predicate).length;
}

function countText(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function indexOrder(text, needles) {
  let cursor = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, cursor + 1);
    if (next <= cursor) return false;
    cursor = next;
  }
  return true;
}

function sectionBetween(text, start, end) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return '';
  const endIndex = text.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? text.slice(startIndex) : text.slice(startIndex, endIndex);
}

function collectMatches(text, regex) {
  return Array.from(text.matchAll(regex));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function feedItemEligibilityText(item) {
  return [
    item.title,
    item.company,
    item.education,
    item.career,
    item.employmentType,
    item.recruitField,
    item.detailText
  ].filter(Boolean).join(' ');
}

function hasStrongHighSchoolSignal(item) {
  const text = feedItemEligibilityText(item);
  return HIGH_SCHOOL_STRONG_TERMS.some((term) => text.includes(term))
    || /고졸\s*(제한|전형|채용|구분|사회형평)/.test(text);
}

function hasEntryLevelSignal(item) {
  const text = feedItemEligibilityText(item);
  return ENTRY_LEVEL_TERMS.some((term) => text.includes(term));
}

function isCareerOnlyWithoutStudentSignal(item) {
  const career = String(item.career || '').trim();
  if (!career || career === '원문 확인') return false;
  if (/신입|무관/.test(career)) return false;
  return /경력|경력직/.test(career) && !hasStrongHighSchoolSignal(item);
}

function highSchoolSuitabilityProblem(item) {
  const text = feedItemEligibilityText(item);
  if (SENIOR_ROLE_PATTERN.test(text)) return 'senior-role';
  if (!hasStrongHighSchoolSignal(item) && RESTRICTED_ROLE_PATTERN.test(text)) return 'restricted-role';
  if (isCareerOnlyWithoutStudentSignal(item)) return 'career-only';
  if (item.education?.includes('학력무관') && !hasEntryLevelSignal(item)) return 'education-open-without-entry-signal';
  return '';
}

function validateProjectScope() {
  const normalized = ROOT_DIR.toLowerCase().replaceAll('\\', '/');
  fail('scope.project-folder', normalized.endsWith('/neojoin1-cyber-homepage'), '작업 폴더가 개인 홈페이지 프로젝트입니다.', ROOT_DIR);
  fail('scope.no-ebook-path', !normalized.includes('gyo6_secure_ebook_platform_v2'), '전자책 기존 프로젝트 경로가 검증 대상에 포함되지 않았습니다.');
}

async function validateStaticFiles() {
  const requiredFiles = [
    'index.html',
    'assets/job-feed.json',
    'assets/platform-hero-vocational.png',
    'tools/fetch_vocational_jobs.mjs',
    '.github/workflows/job-feed.yml',
    '.gitignore',
    '.env.example'
  ];

  for (const file of requiredFiles) {
    try {
      await fs.access(path.join(ROOT_DIR, file));
      fail(`file.${file}`, true, `${file} 파일이 존재합니다.`);
    } catch {
      fail(`file.${file}`, false, `${file} 파일이 없습니다.`);
    }
  }
}

async function validateSecretSafety() {
  const gitignore = await readText('.gitignore');
  fail('secret.gitignore-env', gitignore.includes('.env') && gitignore.includes('.env.*'), '.env 계열 파일이 Git에서 제외됩니다.');
  fail('secret.gitignore-example', gitignore.includes('!.env.example'), '.env.example placeholder는 추적 가능하도록 예외 처리되어 있습니다.');

  const envExample = await readText('.env.example');
  const filled = envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => /=\s*.+/.test(line));
  fail('secret.env-example-placeholder-only', filled.length === 0, '.env.example에는 실제 값이 없습니다.', filled.map((line) => line.replace(/=.*/, '=***')).join(', '));

  const textFiles = [
    'index.html',
    'tools/fetch_vocational_jobs.mjs',
    '.github/workflows/job-feed.yml',
    'docs/JOB_FEED_AUTOMATION.md',
    'docs/JOB_FEED_SECRET_SETUP_SIMPLE.md',
    '.env.example'
  ];
  const secretPattern = /(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN PRIVATE KEY-----|(?:OPENAI|ANTHROPIC|CLOUDFLARE|TOKEN|AUTH_KEY|SERVICE_KEY)[^\S\r\n]*=[^\S\r\n]*[^\s#]+)/;
  const hits = [];
  for (const file of textFiles) {
    const content = await readText(file);
    if (secretPattern.test(content)) hits.push(file);
  }
  fail('secret.no-obvious-secret-patterns', hits.length === 0, '검증 대상 텍스트 파일에서 명백한 키 패턴이 발견되지 않았습니다.', hits.join(', '));
}

async function validateWorkflow() {
  const workflow = await readText('.github/workflows/job-feed.yml');
  fail('workflow.schedule-3x-kst', workflow.includes('10 0,5,10 * * *'), '공채 자동 수집이 하루 3회 KST 기준으로 예약되어 있습니다.');
  fail('workflow.manual-dispatch', workflow.includes('workflow_dispatch'), '수동 재실행 트리거가 있습니다.');
  fail('workflow.syntax-gate', workflow.includes('node --check tools/fetch_vocational_jobs.mjs'), '수집 전 문법 검사를 실행합니다.');
  for (const name of ['DATA_GO_KR_SERVICE_KEY', 'MPM_PUBLIC_JOB_SERVICE_KEY', 'MOEF_PUBLIC_RECRUIT_SERVICE_KEY', 'SARAMIN_ACCESS_KEY', 'EDU_JOB_CENTER_FEEDS']) {
    fail(`workflow.secret.${name}`, workflow.includes(name), `${name} Secret 이름이 워크플로에 연결되어 있습니다.`);
  }
}

async function validateHomepage() {
  const html = await readText('index.html');
  const staleAxisTerms = ['기업자료', '공채·기업자료', 'AI 활용 실험실', 'lab-branch-home', '기록 보관소', '디지털 기록'];
  const staleAxisHits = staleAxisTerms.filter((term) => html.includes(term));
  const branchSection = sectionBetween(html, '<div class="branch-grid">', '<div class="ebook-portal-panel"');
  const systemGridSection = sectionBetween(html, '<div class="system-grid">', '<div class="portal-note">');
  const portalBriefSection = sectionBetween(html, '<div class="portal-brief"', '<img src=');

  fail('home.feed-url-versioned', /assets\/job-feed\.json\?v=/.test(html), '공채 피드 URL에 캐시 버전이 붙어 있습니다.');
  fail('home.feed-no-store', html.includes("cache: 'no-store'"), '공채 피드는 브라우저 캐시를 피해서 읽습니다.');
  fail('home.law-link', html.includes('https://gyo6-law-info.web.app'), '법률정보 시스템 연결 URL이 유지되어 있습니다.');
  fail('home.ebook-link', html.includes('https://gyo6--ebook.web.app/'), '전자책 서재 연결 URL이 유지되어 있습니다.');
  fail('home.closed-label', html.includes('application_closed') && html.includes('원서 마감'), '원서 마감 상태 표시 로직이 있습니다.');
  fail('home.teacher-briefing-ui', html.includes('취업부 브리핑') && html.includes('teacherBriefing'), '공채 카드에 취업부 브리핑 UI가 연결되어 있습니다.');
  fail('home.hero-image-versioned', /platform-hero-vocational\.png\?v=/.test(html), '플랫폼 대표 이미지에 캐시 버전이 붙어 있습니다.');
  fail('home.three-axis-copy', html.includes('공채정보, 전자책, 법률정보에 집중합니다.'), '메인 카피가 공채정보·전자책·법률정보 3축에 집중합니다.');
  fail('home.no-stale-axis-copy', staleAxisHits.length === 0, '이전 4축/기업자료/실험실 문구가 홈페이지에서 제거되어 있습니다.', staleAxisHits.join(', '));
  fail('home.platform-action-count', countText(html, 'class="platform-action"') === 3, '첫 화면 주요 버튼이 3개 축으로 고정되어 있습니다.', `${countText(html, 'class="platform-action"')}개`);
  fail('home.mobile-platform-actions-fit', html.includes('@media(max-width:480px){.platform-actions{grid-template-columns:1fr!important;max-width:100%!important}'), '작은 모바일 화면에서 3축 버튼이 화면 밖으로 넘치지 않도록 세로 배치됩니다.');
  fail('home.flow-card-count', countText(html, 'class="flow-card"') === 3, '업무 흐름 카드가 3개 축으로 고정되어 있습니다.', `${countText(html, 'class="flow-card"')}개`);
  fail('home.branch-card-count', countText(html, 'class="branch-card ') === 3, '시스템 분기 카드가 3개 축으로 고정되어 있습니다.', `${countText(html, 'class="branch-card ')}개`);
  fail('home.branch-axis-order', indexOrder(branchSection, ['직업계고 공채정보', '교육·강의 전자책 서재', 'AI 법률정보 도우미']), '시스템 분기 순서가 공채정보 → 전자책 → 법률정보입니다.');
  fail('home.system-grid-axis-order', indexOrder(systemGridSection, ['직업계고 취업지도 허브', '교육·강의 전자책 서재', 'AI 법률정보 도우미']), '보조 운영 목록 순서가 공채정보 → 전자책 → 법률정보입니다.');
  fail('home.portal-brief-axis-order', indexOrder(portalBriefSection, ['공채 원문', '전자책 서재', '법률정보']), '포털 맵 보조 문구 순서가 공채정보 → 전자책 → 법률정보입니다.');

  const ids = new Set(collectMatches(html, /\bid="([^"]+)"/g).map((match) => match[1]));
  const pages = new Set(collectMatches(html, /\bid="page-([^"]+)"/g).map((match) => match[1]));
  const navigationProblems = [];

  for (const match of collectMatches(html, /showPage\('([^']+)'(?:,'([^']+)')?\)/g)) {
    const [, pageId, chapterId] = match;
    if (!pages.has(pageId)) navigationProblems.push(`page:${pageId}`);
    if (chapterId && !ids.has(chapterId)) navigationProblems.push(`chapter:${chapterId}`);
  }
  for (const match of collectMatches(html, /mobGoto\('([^']+)'\)/g)) {
    const [, pageId] = match;
    if (!pages.has(pageId)) navigationProblems.push(`mobile-page:${pageId}`);
  }
  for (const match of collectMatches(html, /scrollToChapter\('([^']+)'/g)) {
    const [, chapterId] = match;
    if (!ids.has(chapterId)) navigationProblems.push(`scroll:${chapterId}`);
  }
  for (const match of collectMatches(html, /document\.getElementById\('([^']+)'\)\.scrollIntoView/g)) {
    const [, chapterId] = match;
    if (!ids.has(chapterId)) navigationProblems.push(`inline-scroll:${chapterId}`);
  }
  fail('home.navigation-targets', navigationProblems.length === 0, '홈페이지 내부 이동 버튼의 대상 ID가 모두 존재합니다.', navigationProblems.slice(0, 10).join(', '));
}

async function validateDirectionDocs() {
  const direction = await readText('docs/PROJECT_DIRECTION.md');
  fail('docs.direction-three-axis', direction.includes('직업계고 공채정보, 전자책 서재, 법률정보를 플랫폼의 3대 핵심 축으로 둔다'), '프로젝트 방향 문서가 3대 핵심 축을 명시합니다.');
  fail('docs.direction-company-scope', direction.includes('기업정보는 별도 서비스 축으로 키우지 않고'), '기업정보를 별도 축으로 확장하지 않는 범위 통제가 문서화되어 있습니다.');
  fail('docs.direction-no-old-expansion-axis', !direction.includes('AI 도구, 기록 보관소') && !direction.includes('기업자료'), '방향 문서에서 이전 확장축 표현이 제거되어 있습니다.');
}

function validateFeed(feed, label = 'local') {
  const items = Array.isArray(feed.items) ? feed.items : [];
  const sourceStatus = Array.isArray(feed.sourceStatus) ? feed.sourceStatus : [];
  const summary = feed.summary || {};
  const secretReadiness = feed.secretReadiness || {};
  const collectionReview = feed.collectionReview || {};

  fail(`${label}.feed.version`, feed.version === 4, `${label} 피드 버전이 4입니다.`);
  fail(`${label}.feed.items-array`, Array.isArray(feed.items), `${label} 피드 items 배열이 존재합니다.`);
  fail(`${label}.feed.non-empty`, items.length > 0, `${label} 피드에 자동 등록 후보가 있습니다.`, `${items.length}건`);
  fail(`${label}.feed.total-count`, summary.total === items.length, `${label} summary.total이 items 수와 일치합니다.`, `${summary.total} / ${items.length}`);
  fail(`${label}.feed.sources-count`, sourceStatus.length === summary.sourcesChecked, `${label} sourceStatus 수와 sourcesChecked가 일치합니다.`, `${sourceStatus.length} / ${summary.sourcesChecked}`);
  fail(`${label}.feed.secret-total`, secretReadiness.totalSources === sourceStatus.length, `${label} Secret 준비 상태의 소스 수가 sourceStatus와 일치합니다.`);
  fail(`${label}.feed.review-next-actions`, Array.isArray(collectionReview.nextActions) && collectionReview.nextActions.length > 0, `${label} 누락·공식공고·소스보강 다음 조치가 기록됩니다.`);

  const age = hoursSince(feed.generatedAt);
  fail(`${label}.feed.generated-at-valid`, age !== null, `${label} generatedAt이 유효한 날짜입니다.`, feed.generatedAt || '');
  warn(`${label}.feed.freshness`, age === null || age <= MAX_FEED_AGE_HOURS, `${label} 피드 생성 시각이 ${MAX_FEED_AGE_HOURS}시간 이내입니다.`, age === null ? '' : `${age.toFixed(1)}시간 경과`);

  const ids = new Set();
  const duplicates = [];
  for (const item of items) {
    if (ids.has(item.id)) duplicates.push(item.id);
    ids.add(item.id);
  }
  fail(`${label}.feed.no-duplicate-id`, duplicates.length === 0, `${label} 공고 id 중복이 없습니다.`, duplicates.join(', '));

  const examCount = countItems(items, (item) => item.processTrack === 'exam-formal');
  const directCount = countItems(items, (item) => item.processTrack !== 'exam-formal');
  const activeCount = countItems(items, (item) => item.status === 'active');
  const soonCount = countItems(items, (item) => item.status === 'deadline_soon');
  const closedCount = countItems(items, (item) => item.status === 'application_closed');
  const checkedCount = countItems(items, (item) => ['company_notice_confirmed', 'company_notice_reachable'].includes(item.sourceVerification?.doubleCheckStatus));
  const missedCount = countItems(items, (item) => item.collectionAudit?.missedReviewNeeded);
  const staleCount = countItems(items, (item) => item.staleSourceFallback);
  const briefingCount = countItems(items, (item) => item.teacherBriefing?.teacherShareText);

  fail(`${label}.summary.exam-count`, summary.examFormal === examCount, `${label} 필기·공식전형 카운터가 실제 항목과 일치합니다.`, `${summary.examFormal} / ${examCount}`);
  fail(`${label}.summary.direct-count`, summary.directInterview === directCount, `${label} 면접중심·현장형 카운터가 실제 항목과 일치합니다.`, `${summary.directInterview} / ${directCount}`);
  fail(`${label}.summary.status-count`, summary.active === activeCount && summary.deadlineSoon === soonCount && summary.applicationClosed === closedCount, `${label} 진행/마감임박/원서마감 카운터가 실제 항목과 일치합니다.`);
  fail(`${label}.summary.official-check-count`, summary.companyNoticeChecked === checkedCount, `${label} 공식 공고 확인 카운터가 실제 항목과 일치합니다.`, `${summary.companyNoticeChecked} / ${checkedCount}`);
  fail(`${label}.summary.missed-count`, summary.missedReviewNeeded === missedCount, `${label} 누락점검 카운터가 실제 항목과 일치합니다.`, `${summary.missedReviewNeeded} / ${missedCount}`);
  fail(`${label}.summary.stale-count`, summary.staleFallbackItems === staleCount, `${label} 임시 보존 공고 카운터가 실제 항목과 일치합니다.`, `${summary.staleFallbackItems} / ${staleCount}`);
  fail(`${label}.summary.briefing-count`, summary.briefingReady === briefingCount, `${label} 취업부 브리핑 카운터가 실제 항목과 일치합니다.`, `${summary.briefingReady} / ${briefingCount}`);

  const itemProblems = [];
  const negativeLag = [];
  const closedTitleProblems = [];
  const examDetailProblems = [];
  const briefingProblems = [];
  const directPolicyProblems = [];
  const weakOfficialPublicRecruit = [];
  const suitabilityProblems = [];

  for (const item of items) {
    const prefix = `${item.source || 'source'}:${item.title || item.id || 'untitled'}`;
    const suitabilityProblem = highSchoolSuitabilityProblem(item);
    if (!item.id || !item.title || !item.company || !item.sourceName || !item.url || !item.verifiedAt) itemProblems.push(prefix);
    if (!isHttpUrl(item.url) || !isHttpUrl(item.primaryOfficialUrl || item.url)) itemProblems.push(`${prefix} URL`);
    if (!['active', 'deadline_soon', 'application_closed', 'needs_review'].includes(item.status)) itemProblems.push(`${prefix} status=${item.status}`);
    if (suitabilityProblem) suitabilityProblems.push(`${prefix} ${suitabilityProblem}`);
    if ((item.collectionAudit?.detectionLagDays ?? 0) < 0) negativeLag.push(prefix);
    if (item.status === 'application_closed' && !String(item.title).endsWith('(원서 마감)')) closedTitleProblems.push(prefix);
    if (item.status === 'application_closed' && item.processTrack !== 'exam-formal') closedTitleProblems.push(`${prefix} direct-closed`);
    if (!item.teacherBriefing?.teacherShareText || !Array.isArray(item.teacherBriefing?.schoolActionItems) || !Array.isArray(item.teacherBriefing?.studentActionItems)) {
      briefingProblems.push(prefix);
    }
    if (item.processTrack === 'exam-formal') {
      if (!item.publicRecruitDetails || !item.sourceVerification?.doubleCheckStatus) examDetailProblems.push(prefix);
      if (!['company_notice_confirmed', 'company_notice_reachable'].includes(item.sourceVerification?.doubleCheckStatus)) weakOfficialPublicRecruit.push(prefix);
    } else if (item.detailLevel !== 'brief-company-contact') {
      directPolicyProblems.push(prefix);
    }
  }

  fail(`${label}.items.required-fields`, itemProblems.length === 0, `${label} 모든 공고가 필수 표시 필드를 갖습니다.`, itemProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-negative-lag`, negativeLag.length === 0, `${label} 첫날수집 계산에 음수 지연이 없습니다.`, negativeLag.slice(0, 5).join(' | '));
  fail(`${label}.items.closed-title-suffix`, closedTitleProblems.length === 0, `${label} 원서 마감 공고는 제목 끝에 (원서 마감)이 붙습니다.`, closedTitleProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.exam-detail`, examDetailProblems.length === 0, `${label} 필기·공식전형 공채는 상세 정보와 2중확인 상태를 갖습니다.`, examDetailProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.teacher-briefing`, briefingProblems.length === 0, `${label} 모든 공고가 취업부 브리핑과 공유 문안을 갖습니다.`, briefingProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.direct-policy`, directPolicyProblems.length === 0, `${label} 필기 없는 채용은 간단 안내 정책으로 분리됩니다.`, directPolicyProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.high-school-suitability`, suitabilityProblems.length === 0, `${label} 고졸·졸업예정자 코너에 원장·센터장·경력전용 등 부적합 공고가 섞이지 않습니다.`, suitabilityProblems.slice(0, 5).join(' | '));
  warn(`${label}.items.official-double-check`, weakOfficialPublicRecruit.length === 0, `${label} 공채 상세 항목은 회사·기관 또는 채용대행 공식 공고 2중확인이 필요합니다.`, weakOfficialPublicRecruit.slice(0, 5).join(' | '));

  const readySources = sourceStatus.filter((source) => source.configured && source.ok).length;
  warn(`${label}.sources.ready-count`, readySources >= 2, `${label} 현재 정상 수집 가능한 공식 소스가 2개 이상입니다.`, `${readySources}개`);
  warn(`${label}.sources.public-data-next`, secretReadiness.easiestNextAction?.id === 'mpm-public-job' || secretReadiness.readySources > 2, `${label} 다음 확장 우선순위가 인사혁신처 공공취업 API입니다.`, secretReadiness.easiestNextAction?.id || '');

  return { items };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GYO6 reliability verifier/1.0',
        Accept: 'text/html,application/json,*/*;q=0.8'
      }
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateLive(localFeed) {
  const cacheBust = `v=${Date.now()}`;
  try {
    const home = await fetchText(`${LIVE_HOME}?${cacheBust}`);
    fail('live.home.status', home.ok, '라이브 홈페이지가 HTTP 200 계열로 응답합니다.', `status ${home.status}`);
    fail('live.home.job-hub', home.text.includes('직업계고 취업지도 허브'), '라이브 홈페이지에 공채 허브가 포함되어 있습니다.');
    fail('live.home.feed-url', home.text.includes('assets/job-feed.json?v='), '라이브 홈페이지가 버전이 붙은 공채 피드를 참조합니다.');
  } catch (error) {
    fail('live.home.fetch', false, '라이브 홈페이지 확인에 실패했습니다.', error.message);
  }

  try {
    const feedResponse = await fetchText(`${LIVE_FEED}?${cacheBust}`);
    fail('live.feed.status', feedResponse.ok, '라이브 공채 피드가 HTTP 200 계열로 응답합니다.', `status ${feedResponse.status}`);
    const liveFeed = JSON.parse(feedResponse.text);
    validateFeed(liveFeed, 'live');
    warn('live.feed.local-total-match', liveFeed.summary?.total === localFeed.summary?.total, '라이브 피드와 로컬 피드의 총 공고 수가 일치합니다.', `${liveFeed.summary?.total} / ${localFeed.summary?.total}`);
  } catch (error) {
    fail('live.feed.fetch', false, '라이브 공채 피드 확인에 실패했습니다.', error.message);
  }
}

async function checkUrlReachability(url) {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GYO6Reliability/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache'
        }
      });
      await response.body?.cancel().catch(() => {});
      return { ok: response.status < 500 && response.status !== 404, status: response.status, attempt };
    } catch (error) {
      lastError = error.message;
      if (attempt < 3) await sleep(700 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { ok: false, status: 0, error: lastError || 'fetch failed' };
}

async function validateExternalLinks(items) {
  const urls = Array.from(new Set(items
    .flatMap((item) => [item.primaryOfficialUrl, item.companyNoticeUrl, item.sourceOfficialUrl, item.url])
    .filter(isHttpUrl)))
    .slice(0, 24);

  let checked = 0;
  const broken = [];
  for (const url of urls) {
    const result = await checkUrlReachability(url);
    checked += 1;
    if (!result.ok) broken.push(`${safeUrl(url)} (${result.status || result.error})`);
    await sleep(160);
  }
  warn('links.official-url-reachable', broken.length === 0, `공식 원문 URL ${checked}개를 확인했습니다.`, broken.slice(0, 8).join(' | '));
}

async function main() {
  validateProjectScope();
  await validateStaticFiles();
  await validateSecretSafety();
  await validateWorkflow();
  await validateHomepage();
  await validateDirectionDocs();
  const localFeed = await readJson('assets/job-feed.json');
  const { items } = validateFeed(localFeed, 'local');

  if (DO_LIVE) await validateLive(localFeed);
  else info('live.skipped', true, '라이브 검증은 --live 옵션으로 실행합니다.');

  if (DO_EXTERNAL_LINKS) await validateExternalLinks(items);
  else info('links.skipped', true, '공식 원문 URL 검증은 --external-links 옵션으로 실행합니다.');

  const failed = checks.filter((check) => check.severity === 'fail' && !check.ok);
  const warnings = checks.filter((check) => check.severity === 'warn' && !check.ok);
  const passed = checks.filter((check) => check.ok).length;

  console.log(`\nGYO6 Platform Reliability Verification`);
  console.log(`root: ${ROOT_DIR}`);
  console.log(`passed: ${passed}, warnings: ${warnings.length}, failed: ${failed.length}`);

  for (const check of checks.filter((item) => !item.ok)) {
    const label = check.severity === 'fail' ? 'FAIL' : 'WARN';
    console.log(`[${label}] ${check.id} - ${check.message}${check.detail ? ` (${check.detail})` : ''}`);
  }

  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(`verification failed: ${error.message}`);
  process.exit(1);
});
