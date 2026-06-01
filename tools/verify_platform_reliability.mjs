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
  fail('home.feed-url-versioned', /assets\/job-feed\.json\?v=/.test(html), '공채 피드 URL에 캐시 버전이 붙어 있습니다.');
  fail('home.feed-no-store', html.includes("cache: 'no-store'"), '공채 피드는 브라우저 캐시를 피해서 읽습니다.');
  fail('home.law-link', html.includes('https://gyo6-law-info.web.app'), '법률정보 시스템 연결 URL이 유지되어 있습니다.');
  fail('home.closed-label', html.includes('application_closed') && html.includes('원서 마감'), '원서 마감 상태 표시 로직이 있습니다.');
  fail('home.teacher-briefing-ui', html.includes('취업부 브리핑') && html.includes('teacherBriefing'), '공채 카드에 취업부 브리핑 UI가 연결되어 있습니다.');
  fail('home.hero-image-versioned', /platform-hero-vocational\.png\?v=/.test(html), '플랫폼 대표 이미지에 캐시 버전이 붙어 있습니다.');
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

  for (const item of items) {
    const prefix = `${item.source || 'source'}:${item.title || item.id || 'untitled'}`;
    if (!item.id || !item.title || !item.company || !item.sourceName || !item.url || !item.verifiedAt) itemProblems.push(prefix);
    if (!isHttpUrl(item.url) || !isHttpUrl(item.primaryOfficialUrl || item.url)) itemProblems.push(`${prefix} URL`);
    if (!['active', 'deadline_soon', 'application_closed', 'needs_review'].includes(item.status)) itemProblems.push(`${prefix} status=${item.status}`);
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 GYO6 reliability verifier',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    return { ok: response.status < 500 && response.status !== 404, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
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
  }
  warn('links.official-url-reachable', broken.length === 0, `공식 원문 URL ${checked}개를 확인했습니다.`, broken.slice(0, 8).join(' | '));
}

async function main() {
  validateProjectScope();
  await validateStaticFiles();
  await validateSecretSafety();
  await validateWorkflow();
  await validateHomepage();
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
