import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const DO_LIVE = args.has('--live');
const DO_EXTERNAL_LINKS = args.has('--external-links');
const LIVE_HOME = 'https://gyo6.kr/';
const LIVE_FEED = 'https://gyo6.kr/assets/job-feed.json';
const MAX_FEED_AGE_HOURS = 48;
const HIGH_SCHOOL_STRONG_TERMS = ['고졸', '특성화고', '직업계고', '마이스터고', '학교장 추천', '학교장추천'];
const ENTRY_LEVEL_TERMS = ['고졸', '고등학교', '특성화고', '직업계고', '마이스터고', '졸업예정', '졸업 예정', '학교장 추천', '학교장추천', '고졸제한', '고졸 제한', '사회형평 고졸', '신입', '경력무관', '신입+경력', '신입·경력', '청년인턴', '채용형 인턴', '공무직', '업무지원직', '기간제', '9급', '지역인재', '기능인재'];
const SENIOR_ROLE_PATTERN = /(원장|센터장|기관장|본부장|부원장|교장|공모교장|교감|원감|사무총장|총장|개방형\s*직위|전문계약직|연봉계약직|임원|상임감사|비상임감사|감사위원|이사장|대표이사)/;
const RESTRICTED_ROLE_PATTERN = /(관리직|별정직|책임연구원|선임연구원|교수)/;
const ADVANCED_EDU_PATTERN = /(대졸\s*이상|대졸\([^)]*\)|전문대졸|4년제|대학교\s*졸업|학사\s*이상|석사|박사)/;
const PROFESSIONAL_ONLY_PATTERN = /(전문의|의사|약사|간호사|간호조무사|간호조무|요양보호사|요양보호직|치과위생사|임상병리사|물리치료사|작업치료사|방사선사|청능사|보건의료정보관리사|영양사|공인회계사|회계사|변호사|세무사|노무사|법무사|건축사|정교사|교원자격|교사\s*자격|보육교사|면허\s*소지|면허소지|기술사)/;
const STUDENT_UNSUITABLE_HEALTHCARE_ROLE_PATTERN = /(요양보호(?:사|직)|간호조무(?:사|직)?|병동\s*간호조무|치과위생사|임상병리사|임상심리사|정신건강전문요원|사회복지사|물리치료사|작업치료사|방사선사|청능사|보건의료정보관리사|영양사|장례지도사|완화의료|호스피스)/;
const STUDENT_UNSUITABLE_RECRUIT_PATTERN = /(급식|취사|조리\s*실무사|조리\s*종사원|조리원|조리사|배식|요양보호(?:사|직)?|병동\s*간호조무|간호조무사|응급구조사|미화|청소|경비원|경비|주차|보안직|환경관리|수익시설)/;
const VOCATIONAL_MAJOR_FIT_PATTERN = /((조리|식품|외식|제과|제빵|호텔|관광|보건|간호|복지|보안|경비|시설|전기|기계|환경|안전|위생).{0,36}(전공|학과|계열|기능사|산업기사|자격|우대|관련|실무))|((전공|학과|계열|기능사|산업기사|자격|우대|관련|실무).{0,36}(조리|식품|외식|제과|제빵|호텔|관광|보건|간호|복지|보안|시설|전기|기계|환경|안전|위생))/;
const FORMAL_PUBLIC_RECRUIT_PROCESS_PATTERN = /(공채|공개채용|공개\s*채용|공개\s*경쟁|채용\s*공고|모집\s*공고|공고문|블라인드\s*채용|NCS|직업기초능력|직무수행능력|서류전형|필기전형|면접전형|전형절차|원서접수|입사지원)/;
const CAREER_LADDER_EMPLOYMENT_PATTERN = /(정규직|무기계약직|신입직|신입직원|신규직원|신입사원|신입행원|일반직\s*[B]?\s*신입|4직급|5급|6급|7급|채용형\s*인턴|채용형인턴|채용\s*연계|채용연계|전환형\s*인턴|전환\s*형\s*인턴)/;
const STUDENT_RECOMMENDED_ROLE_PATTERN = /(신입직|신입사원|신입행원|신규직원|직원\s*공개채용|정규직|무기계약직|일반직|행정직|사무직|전산직|기술직|생산직|업무지원직|교육행정|연구행정|일반행정|전문행정|연구지원|사업관리|회계|총무|정보화|IT|디지털|데이터|기계|전기|전자|토목|건축|안전관리|지역인재|기능인재|고졸인재|사회형평|공채|공개채용|공개\s*경쟁|블라인드\s*채용)/i;
const LIMITED_PUBLIC_RECRUIT_PATTERN = /(기간제|비정규직|계약직|한시적|대체인력|휴직자\s*대체|육아휴직|임시직|촉탁|위촉|단기|특수직|실무직|국립공원지킴이|소포직|행정지원직\s*\(휴직|휴직\s*대체|공고\s*취소|공고취소|채용\s*취소|채용취소)/;
const CANCELED_RECRUIT_PATTERN = /(공고\s*취소|공고취소|채용\s*취소|채용취소|취소\s*공고)/;
const WRITTEN_EXAM_SIGNAL_PATTERN = /(NCS|필기|인적성|논술|전공\s*(?:시험|평가|필기)|직업기초능력|직무수행능력)/i;
const COLLEGE_APPLICANT_PATTERN = /(대학생|대학\s*(?:재학생|휴학생|졸업\s*예정|졸업예정)|대학교\s*(?:재학생|휴학생|졸업\s*예정|졸업예정)|재학생\s*(?:및|·|,|또는)\s*휴학생|휴학생\s*(?:및|·|,|또는)\s*재학생)/;
const COLLEGE_APPLICANT_DISQUALIFIED_PATTERN = /(대학(?:교)?\s*(?:재학생|휴학생|졸업생)|대학생|재학생\s*(?:및|·|,|또는)\s*휴학생|휴학생\s*(?:및|·|,|또는)\s*재학생).{0,40}(지원\s*불가|지원불가|지원\s*제외|제외|불인정)/;
const DEGREE_ONLY_APPLICANT_PATTERN = /(전문학사|대졸|학사\s*(?:이상|학위|졸업)|석사|박사)/;
const DEGREE_PREFERENCE_PATTERN = /(우대|가점|우대조건|우대사항|우대함).{0,32}(전문학사|대졸|학사|석사|박사)|(전문학사|대졸|학사|석사|박사).{0,32}(우대|가점|우대조건|우대사항|우대함)/;
const MIXED_HIGH_SCHOOL_RECRUIT_PATTERN = /(대졸\s*수준\s*(?:및|·|,|\/|와|과)\s*고졸\s*수준|고졸\s*수준\s*(?:및|·|,|\/|와|과)\s*대졸\s*수준|고졸\s*(?:전형|채용|구분|직군|직렬)|고등학교\s*졸업(?:예정)?자?\s*(?:지원|응시)\s*가능)/;
const PAID_TEASER_COPY_PHRASES = ['무료', '첫 챕터', '공개'].map((prefix) => `${prefix} 맛보기`);
const MIN_FINANCE_LARGE_COMPANY_WATCH_COUNT = 80;
const REQUIRED_FINANCE_LARGE_COMPANY_WATCH_EMPLOYERS = [
  '삼성',
  '현대자동차',
  'SK하이닉스',
  'LG',
  '포스코',
  'KB국민은행',
  '신한은행',
  '하나은행',
  '우리은행',
  'NH농협은행',
  'KB국민카드',
  '신협',
  '저축은행중앙회',
  '신세계',
  '농심',
  '아모레퍼시픽',
  '현대백화점그룹'
];
const MIN_REGIONAL_EDUCATION_WATCH_COUNT = 7;
const REQUIRED_REGIONAL_EDUCATION_WATCH_EMPLOYERS = [
  '인천광역시교육청',
  '경기도교육청',
  '울산광역시교육청',
  '충청북도교육청',
  '경상북도교육청',
  '세종특별자치시교육청',
  '제주특별자치도교육청',
  '경상남도교육청',
  '부산광역시교육청'
];
const REQUIRED_CURRENT_CRITICAL_RECRUITS = [
  {
    id: 'kepco-2026-highschool-4grade',
    sourceId: '301166',
    company: '한국전력공사',
    titleTerms: ['고졸', '신입사원'],
    bodyTerms: ['고등학교', '졸업예정'],
    deadline: '2026-06-12'
  },
  {
    id: 'kca-2026-highschool-admin',
    sourceId: '301041',
    company: '한국방송통신전파진흥원',
    titleTerms: ['경력', '신입', '직원'],
    bodyTerms: ['사무행정', '고졸전형'],
    deadline: '2026-06-11'
  },
  {
    id: 'komipo-2026-2nd-grade4-highschool',
    sourceId: '302314',
    company: '한국중부발전',
    titleTerms: ['제2차', '4직급', '신입직원'],
    bodyTerms: ['고졸수준', '고졸 채용'],
    deadline: '2026-07-22'
  },
  {
    id: 'kised-2026-2nd-new-staff-admin',
    sourceId: '302422',
    company: '창업진흥원',
    titleTerms: ['신규직원', '일반행정'],
    bodyTerms: ['학력무관', '정규직'],
    deadline: '2026-07-20'
  }
];

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

function staleFallbackCountForSource(items, sourceId) {
  return countItems(items, (item) => item.source === sourceId && item.staleSourceFallback);
}

function sourceFallbackProtected(items, sourceStatus, sourceId) {
  return Boolean(sourceStatus?.fallbackProtected)
    || Number(sourceStatus?.fallbackItemCount || 0) > 0
    || staleFallbackCountForSource(items, sourceId) > 0;
}

function sourceOperationalOrPreserved(items, sourceStatus, sourceId) {
  return Boolean(sourceStatus?.ok) || sourceFallbackProtected(items, sourceStatus, sourceId);
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

function hasPaidTeaserCopy(text) {
  return PAID_TEASER_COPY_PHRASES.some((phrase) => text.includes(phrase));
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

function deadlineDateTextFromParts(yearValue, monthValue, dayValue) {
  let year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (String(yearValue).length === 2) year += 2000;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return '';
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDay) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function malformedDeadlineFragments(value) {
  const text = String(value || '');
  const fragments = [];
  for (const match of text.matchAll(/(\d{2,4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*(?:원서\s*)?마감/g)) {
    if (!deadlineDateTextFromParts(match[1], match[2], match[3])) fragments.push(match[0]);
  }
  return fragments;
}

function malformedDeadlineFields(item) {
  const fields = [
    ['deadlineText', item.deadlineText],
    ['publicRecruitDetails.application', item.publicRecruitDetails?.application],
    ...(Array.isArray(item.teacherBriefing?.scheduleLines)
      ? item.teacherBriefing.scheduleLines.map((line, index) => [`teacherBriefing.scheduleLines[${index}]`, line])
      : []),
    ['teacherBriefing.teacherShareText', item.teacherBriefing?.teacherShareText]
  ];
  return fields.flatMap(([name, value]) => malformedDeadlineFragments(value).map((fragment) => `${name}=${fragment}`));
}

function unresolvedDeadlineFields(item) {
  const pattern = /마감일\s*(확인\s*필요|원문\s*확인|자동\s*추출\s*대기)|공식\s*원문에서\s*확인/;
  const fields = [
    ['deadlineText', item.deadlineText],
    ['publicRecruitDetails.application', item.publicRecruitDetails?.application],
    ...(Array.isArray(item.teacherBriefing?.scheduleLines)
      ? item.teacherBriefing.scheduleLines.map((line, index) => [`teacherBriefing.scheduleLines[${index}]`, line])
      : [])
  ];
  return fields
    .filter(([, value]) => pattern.test(String(value || '')))
    .map(([name, value]) => `${name}=${String(value || '').slice(0, 80)}`);
}

function unresolvedQualificationFields(item) {
  const pattern = /^원문\s*확인(?:\s*·|$)/;
  const fields = [
    ['education', item.education],
    ['publicRecruitDetails.eligibility', item.publicRecruitDetails?.eligibility],
    ...(Array.isArray(item.teacherBriefing?.summaryLines)
      ? item.teacherBriefing.summaryLines.map((line, index) => [`teacherBriefing.summaryLines[${index}]`, line])
      : []),
    ...(Array.isArray(item.teacherBriefing?.schoolCheckSections)
      ? item.teacherBriefing.schoolCheckSections.map((section, index) => [`teacherBriefing.schoolCheckSections[${index}]`, section?.text])
      : [])
  ];
  return fields
    .filter(([, value]) => pattern.test(String(value || '').replace(/^학력·자격:\s*/, '')))
    .map(([name, value]) => `${name}=${String(value || '').slice(0, 100)}`);
}

function isKbMainPageRecruitLink(item) {
  const company = String(item.company || '');
  const title = String(item.title || item.baseTitle || '');
  const url = String(item.url || item.primaryOfficialUrl || '').replace(/\/+$/, '');
  return company.includes('KB국민은행')
    && /하계\s*체험형\s*인턴십|고졸·졸업예정\s*채용\s*공고\s*원문\s*확인/.test(title)
    && url === 'https://kbstar.careerlink.kr';
}

function companyTitleCompareText(value) {
  return String(value || '')
    .replace(/\(주\)|㈜|주식회사/g, '')
    .replace(/[\s·ㆍ\-\[\]\(\){}.,:;'"“”‘’]/g, '')
    .toLowerCase();
}

function titleIncludesCompanyName(item) {
  const company = companyTitleCompareText(item.company);
  const title = companyTitleCompareText(item.title || item.baseTitle);
  if (!company || !title) return true;
  return title.includes(company);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function feedItemEligibilityText(item) {
  return [
    item.sourceId,
    item.title,
    item.company,
    item.education,
    item.career,
    item.employmentType,
    item.recruitField,
    item.detailText
  ].filter(Boolean).join(' ');
}

function activeRequiredCriticalRecruits() {
  return REQUIRED_CURRENT_CRITICAL_RECRUITS.filter((job) => {
    const deadline = new Date(`${job.deadline}T23:59:59+09:00`);
    if (Number.isNaN(deadline.getTime())) return true;
    return Date.now() <= deadline.getTime();
  });
}

function criticalRecruitText(item) {
  return [
    item.sourceId,
    item.title,
    item.baseTitle,
    item.company,
    item.education,
    item.career,
    item.recruitField,
    item.detailText,
    item.publicRecruitDetails?.eligibility,
    item.publicRecruitDetails?.process,
    item.teacherBriefing?.teacherShareText
  ].filter(Boolean).join(' ');
}

function matchesRequiredCriticalRecruit(item, job) {
  const text = criticalRecruitText(item);
  if (String(item.sourceId || '') === job.sourceId) return true;
  if (!text.includes(job.company)) return false;
  return [...job.titleTerms, ...job.bodyTerms].every((term) => text.includes(term));
}

function hasOfficialPublicRecruitSource(item) {
  const sourceUrl = String(item.sourceOfficialUrl || item.originalUrl || item.url || '');
  return /job\.alio\.go\.kr\/recruitview\.do\?idx=\d+/i.test(sourceUrl)
    && Array.isArray(item.attachments)
    && item.attachments.some((attachment) => /공고문|직무기술서|입사지원서/.test(String(attachment?.title || '')));
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

function hasEducationOpenSignal(item) {
  return /학력\s*무관/.test(feedItemEligibilityText(item));
}

function careerLadderEmploymentText(value) {
  return String(value || '')
    .replace(/정규직\s*전환\s*(?:없음|불가|제외|미실시)/g, ' ')
    .replace(/비정규직/g, ' ');
}

function hasCareerLadderEmploymentSignal(value) {
  return CAREER_LADDER_EMPLOYMENT_PATTERN.test(careerLadderEmploymentText(value));
}

function hasLimitedTemporaryRecruitSignal(value) {
  const text = String(value || '')
    .replace(/무기계약직/g, ' ')
    .replace(/채용형\s*인턴|채용형인턴|채용\s*연계|채용연계|전환형\s*인턴|전환\s*형\s*인턴/g, ' ');
  return LIMITED_PUBLIC_RECRUIT_PATTERN.test(text);
}

function hasWrittenExamSignal(value) {
  return WRITTEN_EXAM_SIGNAL_PATTERN.test(String(value || ''));
}

function isFormalPublicRecruitSource(item) {
  const text = [
    item.source,
    item.sourceName,
    item.sector,
    item.sectorName,
    item.company,
    item.servicePolicyLabel
  ].filter(Boolean).join(' ');
  return /(job-alio-openapi|잡알리오|공공기관|공기업|준정부기관|기타공공기관|금융권|금융공기업|은행|대기업|상장기업|public-institution|finance|finance-large-company|large-company)/.test(text);
}

function isFormalPublicStudentRecruitCandidate(item) {
  const text = feedItemEligibilityText(item);
  const labels = Array.isArray(item.processLabels) ? item.processLabels.join(' ') : String(item.processLabels || '');
  if (!isFormalPublicRecruitSource(item)) return false;
  if (/학생추천 제외|전문자격 분리|현장형 분리/.test(labels)) return false;
  if (CANCELED_RECRUIT_PATTERN.test(text)) return false;
  if (!hasStrongHighSchoolSignal(item) && !hasEducationOpenSignal(item)) return false;
  if (hasStudentRecommendationMismatchSignal(item)) return false;
  if (STUDENT_UNSUITABLE_HEALTHCARE_ROLE_PATTERN.test(text)) return false;
  if (PROFESSIONAL_ONLY_PATTERN.test(text) && !hasStrongHighSchoolSignal(item)) return false;
  if (hasLimitedTemporaryRecruitSignal(text)
    && !hasWrittenExamSignal(text)
    && !hasStrongHighSchoolSignal(item)) return false;
  return hasCareerLadderEmploymentSignal(text)
    && STUDENT_RECOMMENDED_ROLE_PATTERN.test(text)
    && FORMAL_PUBLIC_RECRUIT_PROCESS_PATTERN.test(text);
}

function hasStudentRecommendationMismatchSignal(item) {
  if (item?.studentChannelAssessment && typeof item.studentChannelAssessment.hardBlocked === 'boolean') {
    return item.studentChannelAssessment.hardBlocked;
  }
  const text = feedItemEligibilityText(item);
  if (!STUDENT_UNSUITABLE_RECRUIT_PATTERN.test(text)) return false;
  if (VOCATIONAL_MAJOR_FIT_PATTERN.test(text)
    && (hasStrongHighSchoolSignal(item) || hasEducationOpenSignal(item))
    && hasCareerLadderEmploymentSignal(text)
    && FORMAL_PUBLIC_RECRUIT_PROCESS_PATTERN.test(text)) {
    return false;
  }
  return true;
}

function hasCollegeOnlyApplicantSignal(item) {
  const text = feedItemEligibilityText(item);
  if (COLLEGE_APPLICANT_PATTERN.test(text) && !COLLEGE_APPLICANT_DISQUALIFIED_PATTERN.test(text)) return true;
  if (!DEGREE_ONLY_APPLICANT_PATTERN.test(text) || DEGREE_PREFERENCE_PATTERN.test(text)) return false;
  return !MIXED_HIGH_SCHOOL_RECRUIT_PATTERN.test(text);
}

function isCareerOnlyWithoutStudentSignal(item) {
  const career = String(item.career || '').trim();
  if (!career || career === '원문 확인') return false;
  if (/신입|무관/.test(career)) return false;
  return /경력|경력직/.test(career) && !hasStrongHighSchoolSignal(item) && !hasEducationOpenSignal(item);
}

function highSchoolSuitabilityProblem(item) {
  const text = feedItemEligibilityText(item);
  const strongHighSchool = hasStrongHighSchoolSignal(item);
  const entryLevel = hasEntryLevelSignal(item);
  const educationOpen = hasEducationOpenSignal(item);
  if (CANCELED_RECRUIT_PATTERN.test(text)) return 'canceled-recruit';
  if (hasCollegeOnlyApplicantSignal(item)) return 'college-or-degree-only';
  if (hasStudentRecommendationMismatchSignal(item)) return 'student-recommendation-mismatch';
  if (STUDENT_UNSUITABLE_HEALTHCARE_ROLE_PATTERN.test(text)) return 'student-unsuitable-professional-healthcare';
  if (SENIOR_ROLE_PATTERN.test(text)) return 'senior-role';
  if (!strongHighSchool && PROFESSIONAL_ONLY_PATTERN.test(text)) return 'professional-only';
  if (!strongHighSchool && !educationOpen && ADVANCED_EDU_PATTERN.test(text)) return 'advanced-education-only';
  if (!strongHighSchool && !entryLevel && !educationOpen && RESTRICTED_ROLE_PATTERN.test(text)) return 'restricted-role';
  if (isCareerOnlyWithoutStudentSignal(item)) return 'career-only';
  return '';
}

function validateProjectScope() {
  const normalized = ROOT_DIR.toLowerCase().replaceAll('\\', '/');
  const isHomepageProject = normalized.endsWith('/neojoin1-cyber-homepage')
    || normalized.endsWith('/_audit_neojoin1-cyber-homepage')
    || normalized.endsWith('/neojoin-job-feed-publish')
    || normalized.endsWith('/meister-platform/portal');
  fail('scope.project-folder', isHomepageProject, '작업 폴더가 gyo6.kr portal 프로젝트입니다.', ROOT_DIR);
  fail('scope.no-ebook-path', !normalized.includes('gyo6_secure_ebook_platform_v2'), '전자책 기존 프로젝트 경로가 검증 대상에 포함되지 않았습니다.');
}

async function validateStaticFiles() {
  const requiredFiles = [
    'index.html',
    'assets/job-feed.json',
    'assets/job-detail-vault.json',
    'assets/job-feed-health.json',
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

async function validateProtectedJobVault(feed) {
  const vault = await readJson('assets/job-detail-vault.json');
  const encryptedItems = vault?.items && typeof vault.items === 'object' ? vault.items : {};
  const requiredIds = new Set([...(feed.items || []), ...(feed.archiveItems || [])].map((item) => item.id).filter(Boolean));
  const missing = [...requiredIds].filter((id) => !encryptedItems[id]);
  const malformed = Object.entries(encryptedItems).filter(([, item]) => !item?.wrappedKey || !item?.iv || !item?.authTag || !item?.ciphertext);
  const firstTitle = feed.items?.[0]?.title || '';
  fail('jobs.vault.version', vault.version === 1 && vault.algorithm === 'RSA-OAEP-256+A256GCM', '채용 상세 저장소가 RSA-OAEP와 AES-GCM 이중 암호화를 사용합니다.');
  fail('jobs.vault.coverage', missing.length === 0 && Number(vault.itemCount || 0) === Object.keys(encryptedItems).length, '공개 목록과 마감 보관함의 모든 공고 상세가 암호화 저장소에 존재합니다.', missing.slice(0, 5).join(', '));
  fail('jobs.vault.shape', malformed.length === 0, '모든 암호화 공고가 래핑키·IV·인증태그·암호문을 갖습니다.', malformed.slice(0, 5).map(([id]) => id).join(', '));
  fail('jobs.vault.no-plaintext-title', !firstTitle || !JSON.stringify(vault).includes(firstTitle), '암호화 저장소에 채용 제목이나 상세정보 평문이 남지 않습니다.');
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
  fail('workflow.schedule-3x-kst', workflow.includes('10 0,5,14 * * *'), '공채 자동 수집이 09:10, 14:10, 23:10 KST 기준으로 예약되어 있습니다.');
  fail('workflow.backup-schedule-3x-kst', workflow.includes('40 0,5,14 * * *'), '정규 수집 30분 뒤 백업 수집이 다시 실행됩니다.');
  fail('workflow.no-cancel-in-progress', workflow.includes('cancel-in-progress: false'), '진행 중인 자동 수집을 새 실행이 취소하지 않고 순차 처리합니다.');
  fail('workflow.manual-dispatch', workflow.includes('workflow_dispatch'), '수동 재실행 트리거가 있습니다.');
  fail('workflow.syntax-gate', workflow.includes('node --check tools/fetch_vocational_jobs.mjs'), '수집 전 문법 검사를 실행합니다.');
  fail('workflow.health-commit', workflow.includes('assets/job-feed-health.json') && workflow.includes('Commit automation health diagnostics'), '자동수집 건강 상태 파일을 정상·실패 경로 모두에서 게시할 수 있습니다.');
  fail('workflow.encrypted-detail-vault', workflow.includes('assets/job-detail-vault.json'), '자동수집이 암호화 채용 상세 저장소를 공개 피드와 함께 게시합니다.');
  for (const name of ['DATA_GO_KR_SERVICE_KEY', 'MPM_PUBLIC_JOB_SERVICE_KEY', 'MOEF_PUBLIC_RECRUIT_SERVICE_KEY', 'SARAMIN_ACCESS_KEY', 'JOB_ALIO_EXTRA_WATCH_ORGS', 'EDU_JOB_CENTER_FEEDS', 'FINANCE_RECRUIT_FEEDS', 'LARGE_COMPANY_RECRUIT_FEEDS']) {
    fail(`workflow.secret.${name}`, workflow.includes(name), `${name} Secret 이름이 워크플로에 연결되어 있습니다.`);
  }
}

async function validateJobFetcherRules() {
  const fetcher = await readText('tools/fetch_vocational_jobs.mjs');
  const directTerms = sectionBetween(fetcher, 'const DIRECT_TERMS = [', '];');
  const examTerms = sectionBetween(fetcher, 'const EXAM_TERMS = [', '];');
  const writtenExamTerms = sectionBetween(fetcher, 'const WRITTEN_EXAM_TERMS = [', '];');
  fail('fetcher.source-failure-isolation', fetcher.includes('function runSource') && fetcher.includes('sourceFailureResult') && fetcher.includes('수집원 예외 격리'), '개별 수집원 예외가 전체 자동수집 실패로 번지지 않도록 격리합니다.');
  fail('fetcher.pending-source-concurrency', fetcher.includes('PENDING_SOURCE_CONCURRENCY') && fetcher.includes('return mapWithConcurrency(pending, PENDING_SOURCE_CONCURRENCY'), '보조 수집원은 제한 병렬로 점검해 느린 소스 하나가 전체 시간을 잡아먹지 않게 합니다.');
  fail('fetcher.publication-safety-guard', fetcher.includes('function applyPublicationSafetyGuards') && fetcher.includes('publicationBlockReason') && fetcher.includes('publicationSafety'), '검증 실패를 일으킬 공고는 게시 직전 자동 보정하거나 차단합니다.');
  fail('fetcher.health-report', fetcher.includes('job-feed-health.json') && fetcher.includes('function buildFeedHealth') && fetcher.includes('writeJsonAtomic(HEALTH_FILE'), '자동 수집 건강 상태 파일을 매 실행마다 생성합니다.');
  fail('fetcher.core-source-publication-hold', fetcher.includes('function publicFeedHoldReason') && fetcher.includes('CORE_PUBLICATION_SOURCE_IDS') && fetcher.includes('degraded-held'), '잡알리오 같은 핵심 수집원이 실패한 실행은 정상 공개 피드를 덮어쓰지 않고 건강 진단만 남깁니다.');
  fail('fetcher.source-fallback-diagnostics', fetcher.includes('function annotateSourceFallbackProtection') && fetcher.includes('fallbackProtected') && fetcher.includes('sourceFallbackProtected'), '일시 실패한 공식 수집원은 직전 정상 공고 보존 건수를 피드와 건강 상태에 남깁니다.');
  fail('fetcher.job-track-refine', fetcher.includes('function shouldForceFieldDirectRecruit') && fetcher.includes('function hasWrittenExamSignal') && fetcher.includes('function hasFormalPublicStudentRecruitSignal') && fetcher.includes('CAREER_LADDER_EMPLOYMENT_PATTERN') && fetcher.includes('공채 상세 정보') && fetcher.includes('면접중심·현장형 채용') && fetcher.includes('일반·면접형 취업정보') && fetcher.includes('Math.max(36, Math.floor(MAX_ITEMS * 0.4))') && !/공개\s*경쟁|공채|공무원|군무원|부사관/.test(writtenExamTerms) && !/공개\s*경쟁|공채|공무원|군무원|부사관/.test(examTerms), '자동 수집 단계에서 필기·NCS 신호뿐 아니라 정규직·무기계약직·채용형 인턴 등 학생 추천 공식 공채를 공채 상세 정보로 보호하고, 일반·면접형 취업정보의 피드 몫을 확보합니다.');
  fail('fetcher.student-exclusion-overrides-eligibility', fetcher.includes('DEGREE_PREFERENCE_PATTERN') && !fetcher.includes('if (HIGH_SCHOOL_ELIGIBLE_PATTERN.test(text)) return false;'), '대학생·휴학생·학위 전용 제외 신호는 학력무관 또는 고졸 관련 문구보다 우선합니다.');
  fail('fetcher.important-recruit-review-safety-net', fetcher.includes('function importantRecruitSafetySignals') && fetcher.includes('function studentRecruitReviewSample') && fetcher.includes('studentRecruitReviewSamples') && fetcher.includes('중요 공채 후보 안전검토') && fetcher.includes('studentRecruitSafetyReviewRule'), '좌측 추천에서 제외된 중요 공채 후보는 안전검토 큐에 남겨 조용히 누락되지 않게 합니다.');
  fail('fetcher.student-fit-exception-guard', fetcher.includes('function hasStudentRecommendationFitException') && fetcher.includes('VOCATIONAL_MAJOR_FIT_PATTERN') && fetcher.includes('전공 적합성') && fetcher.includes('경력 사다리'), '학생 추천 제외는 특정 직무명만으로 무조건 처리하지 않고 전공 적합성, 학생 접근 가능성, 경력 사다리, 공식 전형을 함께 봅니다.');
  fail('fetcher.professional-healthcare-guard', fetcher.includes('function hasStudentUnsuitableProfessionalRole') && fetcher.includes('요양보호') && fetcher.includes('간호조무') && fetcher.includes('전문자격 분리'), '학력무관이어도 전문면허·전문자격 중심 채용은 학생 추천 공채 후보에서 분리합니다.');
  fail('fetcher.unverified-education-placeholder-guard', fetcher.includes("replace(/고졸·특성화고\\s*관련\\s*원문\\s*확인/g, ' ')") && fetcher.includes('advancedRoleMismatch'), '관련 원문 확인 같은 임시 학력 문구를 응시 가능 확정값으로 쓰지 않고 연구·고학력 직무는 별도 검증합니다.');
  fail('fetcher.encrypted-member-detail', fetcher.includes('buildProtectedJobArtifacts') && fetcher.includes('RSA-OAEP-256+A256GCM') && fetcher.includes('publicJobListItem'), '공개 목록과 승인 회원 전용 암호화 상세를 자동으로 분리합니다.');
  fail('fetcher.internship-not-direct-term', !directTerms.includes('채용연계'), '채용연계·채용형 인턴은 직접 분리 키워드에서 제외되어 학생 추천 채용으로 검토됩니다.');
  fail('fetcher.deadline-text-sanitizer', fetcher.includes('function safeDeadlineDisplayText') && fetcher.includes('function kstDateFromParts') && fetcher.includes('containsStructuredDatePattern'), '자동 수집 단계에서 불가능한 마감일 숫자를 원문 확인 문구로 정제합니다.');
  fail('fetcher.job-alio-dynamic-current-scan', fetcher.includes('JOB_ALIO_RECENT_DETAIL_DAYS') && fetcher.includes('function selectJobAlioRowsForDetail') && fetcher.includes('function buildJobAlioDynamicDiscovery') && fetcher.includes('dynamic-current-job-alio-detail-scan'), '잡알리오 최근 등록 공고는 기관 화이트리스트나 제목 키워드와 무관하게 상세 원문을 열어 오늘 기준 후보 누락을 점검합니다.');
}

async function validateHomepage() {
  const html = await readText('index.html');
  const staleAxisTerms = ['기업자료', '공채·기업자료', 'AI 활용 실험실', 'lab-branch-home', '기록 보관소', '디지털 기록', 'KBS NOVA'];
  const staleAxisHits = staleAxisTerms.filter((term) => html.includes(term));

  fail('home.feed-link-present', html.includes('assets/job-feed.json'), '특성화고 플랫폼 채용 피드 진입 링크가 유지되어 있습니다.');
  fail('home.core-content-links', html.includes('jobs.html') && html.includes('resources.html') && html.includes('채용정보와 상담자료실은 설탕과소금의 핵심 콘텐츠입니다'), '대표 홈에서 채용정보와 상담자료실 핵심 콘텐츠 진입이 유지됩니다.');
  fail('home.no-public-manual-job-feed-run', !html.includes('actions/workflows/job-feed.yml') && !html.includes('수동수집 실행'), '공개 홈에는 GitHub Actions 수동수집 버튼을 노출하지 않습니다.');
  fail('home.law-link', html.includes('https://gyo6-law-info.web.app'), '법률정보 시스템 연결 URL이 유지되어 있습니다.');
  fail('home.no-legacy-ebook-link', !html.includes('https://gyo6--ebook.web.app'), '대표 홈페이지는 기존 전자책 서재 링크를 노출하지 않습니다.');
  fail('home.ebook-placeholder-only', html.includes('전자책은 메뉴만 남기고, 새로 설계합니다.') && html.includes('현재의 전자책 메뉴 내용은 이번 대표 홈페이지에 사용하지 않습니다.'), '전자책은 재설계 예정 메뉴로만 표시됩니다.');
  fail('home.ebook-no-paid-teaser-copy', !hasPaidTeaserCopy(html), '전자책 안내에서 유료 전환처럼 보일 수 있는 맛보기 표현을 쓰지 않습니다.');
  fail('home.hero-brand-copy', html.includes('대한민국 교육격차 해소를 위해 노력하는 기업') && html.includes('gyo6.kr · 교육.한국'), '대표 홈은 설탕과소금 기업 모토와 gyo6.kr의 교육.한국 의미를 전면에 둡니다.');
  fail('home.learning-app-not-ebook', html.includes('설탕과소금 학습 앱') && html.includes('직업공통능력 인증교재') && html.includes('NCS 직업기초능력교재') && html.includes('면접스킬') && html.includes('인성검사'), '설탕과소금 앱은 전자책이 아니라 취업 준비 학습 앱으로 설명됩니다.');
  fail('home.today-where-positioning', html.includes('역사적 인물, 장소, 사건') && html.includes('가정 체험학습') && html.includes('체험학습 보고서'), '오늘어디가는 가족 여행과 가정 체험학습, 보고서 연계 앱으로 설명됩니다.');
  fail('home.adventure-positioning', html.includes('미취학 아동') && html.includes('동화책과 가까운 정서'), '모험동화 앱은 미취학 아동의 독서 정서 형성 앱으로 설명됩니다.');
  fail('home.novastar-positioning', html.includes('잠시의 휴식') && html.includes('별자리 타일 매치'), '노바스타는 휴식형 퍼즐 게임으로 설명됩니다.');
  fail('home.vocational-two-axis', html.includes('채용정보와 상담자료실만 분명하게 남깁니다.') && html.includes('단톡방') && html.includes('서식·법령·지침'), '특성화고 플랫폼은 채용정보와 상담자료실 두 축으로 설명됩니다.');
  fail('home.business-area-simple', html.includes('복잡한 설명보다') && html.includes('사업 영역을 분명하게 정리합니다.'), '대표 홈페이지는 복잡한 기능보다 사업 영역 정리에 집중합니다.');
  fail('home.thirty-years-proud-story', html.includes('30여 년의 특성화고 경험은 설탕과소금의 가장 소중한 포트폴리오입니다.') && html.includes('앞으로도 이어가고 싶은 인연'), '30여 년 특성화고 경험을 자랑스러운 포트폴리오와 이어가고 싶은 인연으로 표현합니다.');
  fail('home.hero-image-versioned', /brand-(entrance-story|horizontal-sign|entrance-glass)\.png/.test(html), '첨부된 설탕과소금 간판·홍보 디자인 자산이 대표 홈페이지에 반영되어 있습니다.');
  fail('home.no-stale-axis-copy', staleAxisHits.length === 0, '이전 4축/기업자료/실험실 문구가 홈페이지에서 제거되어 있습니다.', staleAxisHits.join(', '));

  const ids = new Set(collectMatches(html, /\bid="([^"]+)"/g).map((match) => match[1]));
  const navigationProblems = [];

  for (const match of collectMatches(html, /href="#([^"]+)"/g)) {
    const [, chapterId] = match;
    if (!ids.has(chapterId)) navigationProblems.push(`hash:${chapterId}`);
  }
  fail('home.navigation-targets', navigationProblems.length === 0, '홈페이지 내부 이동 버튼의 대상 ID가 모두 존재합니다.', navigationProblems.slice(0, 10).join(', '));
}

async function validateCoreContentPages() {
  const vocational = await readText('vocational.html');
  const jobs = await readText('jobs.html');
  const resources = await readText('resources.html');

  fail('core.vocational-content-weight', vocational.includes('가장 심혈을 기울이는 특성화고 핵심 콘텐츠') && vocational.includes('Ollama 보강 요약') && vocational.includes('공개 자료실과 승인 회원 상담실'), '특성화고 플랫폼 페이지가 채용정보와 상담자료실을 핵심 콘텐츠로 설명합니다.');
  fail('core.jobs-content-weight', jobs.includes('특성화고 공채, 먼저 보이게.') && jobs.includes('공기업·공공기관·공무원·금융권·대기업 공채') && jobs.includes('상담자료실 안내'), '채용정보 페이지가 핵심 공채 우선 노출과 상담자료실 연결을 명확히 안내합니다.');
  fail('core.jobs-sort-search', jobs.includes('data-sort-mode="new"') && jobs.includes('data-sort-mode="deadline"') && jobs.includes('job-search-input') && jobs.includes('job-search-button') && jobs.includes('isCorePublicRecruit') && jobs.includes('core-recruit'), '채용정보 페이지가 신규순·마감일자순·검색·핵심 공채 강조 UI를 제공합니다.');
  fail('core.resources-page', resources.includes('상담자료실은 학교 현장의 반복 검색을 줄이기 위한') && resources.includes('https://gyo6-law-info.web.app') && resources.includes('법률 자문이나 사건 판단을 대신하지 않습니다'), '상담자료실 안내 페이지가 공식자료 연결과 한계를 분명히 안내합니다.');
}

async function validateDirectionDocs() {
  info('docs.direction-skip', true, '이번 티켓은 사용자 지시에 따라 docs를 수정하지 않고 홈페이지 구현만 검증합니다.');
}

function validateFeed(feed, label = 'local') {
  const items = Array.isArray(feed.items) ? feed.items : [];
  const sourceStatus = Array.isArray(feed.sourceStatus) ? feed.sourceStatus : [];
  const summary = feed.summary || {};
  const secretReadiness = feed.secretReadiness || {};
  const collectionReview = feed.collectionReview || {};
  const protectedDetailFeed = feed.detailAccess?.policy === 'approved-member-api';
  const publicBriefingFeed = feed.detailAccess?.policy === 'public-feed-briefing';
  const aiBriefing = feed.aiBriefing || {};
  const ollamaRequired = process.env.OLLAMA_REQUIRED === '1';

  fail(`${label}.feed.version`, feed.version === 4, `${label} 피드 버전이 4입니다.`);
  fail(`${label}.feed.items-array`, Array.isArray(feed.items), `${label} 피드 items 배열이 존재합니다.`);
  fail(`${label}.feed.member-detail-policy`, protectedDetailFeed || publicBriefingFeed, `${label} 공개 피드는 승인 회원 API 또는 공개 브리핑 정책을 명시합니다.`);
  fail(`${label}.feed.ollama-policy`, !ollamaRequired || /Ollama/.test(String(feed.collectionPolicy?.ollamaBriefingRule || '')), `${label} 하루 3회 자동 수집의 Ollama 브리핑 정책이 기록됩니다.`);
  fail(`${label}.feed.ollama-required`, !ollamaRequired || (aiBriefing.engine === 'ollama' && aiBriefing.status === 'ok' && Number(aiBriefing.succeeded || 0) > 0), `${label} OLLAMA_REQUIRED=1이면 Ollama 브리핑 보강이 성공해야 합니다.`, JSON.stringify(aiBriefing));
  fail(`${label}.feed.non-empty`, items.length > 0, `${label} 피드에 자동 등록 후보가 있습니다.`, `${items.length}건`);
  fail(`${label}.feed.total-count`, summary.total === items.length, `${label} summary.total이 items 수와 일치합니다.`, `${summary.total} / ${items.length}`);
  fail(`${label}.feed.sources-count`, sourceStatus.length === summary.sourcesChecked, `${label} sourceStatus 수와 sourcesChecked가 일치합니다.`, `${sourceStatus.length} / ${summary.sourcesChecked}`);
  fail(`${label}.feed.secret-total`, secretReadiness.totalSources === sourceStatus.length, `${label} Secret 준비 상태의 소스 수가 sourceStatus와 일치합니다.`);
  fail(`${label}.feed.review-next-actions`, Array.isArray(collectionReview.nextActions) && collectionReview.nextActions.length > 0, `${label} 누락·공식공고·소스보강 다음 조치가 기록됩니다.`);
  fail(`${label}.feed.critical-review-field`, collectionReview.criticalCoverage && Array.isArray(collectionReview.criticalCoverage.missingCurrent), `${label} 핵심 공기업 고졸 공채 감시 결과가 기록됩니다.`);
  fail(`${label}.feed.dynamic-job-alio-review-field`, collectionReview.jobAlioDynamicDiscovery?.policy === 'dynamic-current-job-alio-detail-scan', `${label} 잡알리오 최근 상세 원문 기반 동적 누락 점검 결과가 기록됩니다.`);
  fail(`${label}.feed.dynamic-job-alio-no-gap`, Number(collectionReview.dynamicJobAlioGapCount || 0) === 0 && Number(collectionReview.jobAlioDynamicDiscovery?.missingCandidateCount || 0) === 0, `${label} 잡알리오 최근 상세에서 확인된 고졸·학력무관 후보가 최종 피드에서 빠지지 않았습니다.`, (collectionReview.jobAlioDynamicDiscovery?.missingCandidates || []).map((item) => `${item.company}:${item.title}`).join(' | '));

  const age = hoursSince(feed.generatedAt);
  fail(`${label}.feed.generated-at-valid`, age !== null, `${label} generatedAt이 유효한 날짜입니다.`, feed.generatedAt || '');
  warn(`${label}.feed.freshness`, age === null || age <= MAX_FEED_AGE_HOURS, `${label} 피드 생성 시각이 ${MAX_FEED_AGE_HOURS}시간 이내입니다.`, age === null ? '' : `${age.toFixed(1)}시간 경과`);

  const requiredCritical = activeRequiredCriticalRecruits();
  const missingCritical = requiredCritical.filter((job) => !items.some((item) => matchesRequiredCriticalRecruit(item, job)));
  fail(`${label}.feed.critical-current-recruits`, missingCritical.length === 0, `${label} 현재 진행 중 핵심 공기업·공공기관 공채가 피드에 포함되어 있습니다.`, missingCritical.map((job) => `${job.company}:${job.sourceId}`).join(', '));

  const misplacedFormalPublicRecruits = items
    .filter((item) => isFormalPublicStudentRecruitCandidate(item) && item.processTrack !== 'exam-formal')
    .map((item) => `${item.company}:${item.title}`)
    .slice(0, 12);
  fail(`${label}.feed.formal-public-recruit-left-track`, misplacedFormalPublicRecruits.length === 0, `${label} 학력무관 공식 정규 공채 후보는 공채 상세 정보에 남습니다.`, misplacedFormalPublicRecruits.join(' | '));

  const studentExcludedLeftTrack = items
    .filter((item) => {
      const labels = Array.isArray(item.processLabels) ? item.processLabels.join(' ') : String(item.processLabels || '');
      const note = String(item.processNote || '');
      return item.processTrack === 'exam-formal'
        && (/학생추천\s*제외/.test(labels) || /공채\s*상세\s*정보에서\s*제외|학생\s*추천\s*공채에서는\s*제외|추천하기\s*어려운\s*직무/.test(note));
    })
    .map((item) => `${item.company}:${item.title}`)
    .slice(0, 12);
  fail(`${label}.feed.student-excluded-not-left-track`, studentExcludedLeftTrack.length === 0, `${label} 학생추천 제외 공고는 공채 상세 정보에 남지 않습니다.`, studentExcludedLeftTrack.join(' | '));

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
  const companyNoticeCheckedStatuses = ['company_notice_confirmed', 'company_notice_reachable', 'job_alio_detail_confirmed'];
  const officialDoubleCheckStatuses = [...companyNoticeCheckedStatuses];
  const checkedCount = countItems(items, (item) => companyNoticeCheckedStatuses.includes(item.sourceVerification?.doubleCheckStatus));
  const regionalEducationVerifiedCount = countItems(items, (item) => item.regionalEducationVerification?.count > 0);
  const regionalEducationDirectItems = items.filter((item) => {
    const text = [item.source, item.sourceName, item.title, item.detailLevel].join(' ');
    return item.source === 'regional-education-job'
      || item.source === 'seoul-highjob'
      || item.detailLevel === 'regional-education-verified-recruit'
      || item.detailLevel === 'regional-education-verification-source'
      || /교육청\s*(취업지원센터|하이잡)|공채캘린더/.test(text);
  });
  const missedCount = countItems(items, (item) => item.collectionAudit?.missedReviewNeeded);
  const staleCount = countItems(items, (item) => item.staleSourceFallback);
  const sourceFallbackCount = countItems(items, (item) => item.collectionAudit?.sourceFallback);
  const briefingCount = countItems(items, (item) => item.teacherBriefing?.teacherShareText);

  fail(`${label}.summary.exam-count`, summary.examFormal === examCount, `${label} 공채 상세 정보 카운터가 실제 항목과 일치합니다.`, `${summary.examFormal} / ${examCount}`);
  fail(`${label}.summary.direct-count`, summary.directInterview === directCount, `${label} 면접중심·현장형 채용 카운터가 실제 항목과 일치합니다.`, `${summary.directInterview} / ${directCount}`);
  fail(`${label}.summary.status-count`, summary.active === activeCount && summary.deadlineSoon === soonCount && summary.applicationClosed === closedCount, `${label} 진행/마감임박/원서마감 카운터가 실제 항목과 일치합니다.`);
  fail(`${label}.summary.official-check-count`, protectedDetailFeed || summary.companyNoticeChecked === checkedCount, `${label} 공식 공고 확인 카운터가 일치하거나 회원 전용 상세로 보호됩니다.`, `${summary.companyNoticeChecked} / ${checkedCount}`);
  fail(`${label}.summary.regional-education-count`, protectedDetailFeed || (summary.regionalEducationVerificationLinked || summary.regionalEducationVerified || 0) === regionalEducationVerifiedCount, `${label} 교육청 보조검증 연계 카운터가 일치하거나 회원 전용 상세로 보호됩니다.`, `${summary.regionalEducationVerificationLinked || summary.regionalEducationVerified || 0} / ${regionalEducationVerifiedCount}`);
  fail(`${label}.summary.missed-count`, summary.missedReviewNeeded === missedCount, `${label} 누락점검 카운터가 실제 항목과 일치합니다.`, `${summary.missedReviewNeeded} / ${missedCount}`);
  fail(`${label}.summary.dynamic-job-alio-gap-count`, Number(summary.dynamicJobAlioGapCount || 0) === Number(collectionReview.dynamicJobAlioGapCount || 0), `${label} 잡알리오 동적 누락 카운터가 검토 결과와 일치합니다.`, `${summary.dynamicJobAlioGapCount || 0} / ${collectionReview.dynamicJobAlioGapCount || 0}`);
  fail(`${label}.summary.stale-count`, summary.staleFallbackItems === staleCount, `${label} 임시 보존 공고 카운터가 실제 항목과 일치합니다.`, `${summary.staleFallbackItems} / ${staleCount}`);
  fail(`${label}.summary.source-fallback-count`, (summary.sourceFallbackProtected || 0) === sourceFallbackCount, `${label} 실패 소스 보존 공고 카운터가 실제 항목과 일치합니다.`, `${summary.sourceFallbackProtected || 0} / ${sourceFallbackCount}`);
  fail(`${label}.summary.briefing-count`, protectedDetailFeed || summary.briefingReady === briefingCount, `${label} 취업부 브리핑 카운터가 일치하거나 회원 전용 상세로 보호됩니다.`, `${summary.briefingReady} / ${briefingCount}`);
  fail(`${label}.summary.ollama-count`, !aiBriefing.enabled || Number(summary.ollamaBriefingReady || 0) === Number(aiBriefing.succeeded || 0), `${label} Ollama 브리핑 카운터가 실행 결과와 일치합니다.`, `${summary.ollamaBriefingReady || 0} / ${aiBriefing.succeeded || 0}`);

  const itemProblems = [];
  const negativeLag = [];
  const closedTitleProblems = [];
  const examDetailProblems = [];
  const briefingProblems = [];
  const directPolicyProblems = [];
  const weakOfficialPublicRecruit = [];
  const suitabilityProblems = [];
  const malformedDeadlineProblems = [];
  const unresolvedDeadlineProblems = [];
  const unresolvedQualificationProblems = [];
  const mainPageRecruitLinkProblems = [];
  const titleCompanyProblems = [];
  const assessmentProblems = [];
  const blockedPublicationProblems = [];
  const militaryUnservedExamItems = [];
  const militaryLimitedExamItems = [];
  const qualityDirectItems = [];
  const publicDetailLeaks = [];

  for (const item of items) {
    const prefix = `${item.source || 'source'}:${item.title || item.id || 'untitled'}`;
    const assessment = item.studentChannelAssessment;
    if (protectedDetailFeed && (item.url || item.primaryOfficialUrl || item.attachments || item.detailText || item.publicRecruitDetails || item.teacherBriefing || item.sourceVerification)) {
      publicDetailLeaks.push(prefix);
    }
    const suitabilityProblem = highSchoolSuitabilityProblem(item);
    const deadlineProblems = malformedDeadlineFields(item);
    const unresolvedDeadline = unresolvedDeadlineFields(item);
    const unresolvedQualification = unresolvedQualificationFields(item);
    if (!item.id || !item.title || !item.company || !item.sourceName || (!protectedDetailFeed && !item.url) || !item.verifiedAt) itemProblems.push(prefix);
    if (!protectedDetailFeed && (!isHttpUrl(item.url) || !isHttpUrl(item.primaryOfficialUrl || item.url))) itemProblems.push(`${prefix} URL`);
    if (!['active', 'deadline_soon', 'application_closed', 'needs_review'].includes(item.status)) itemProblems.push(`${prefix} status=${item.status}`);
    if (suitabilityProblem) suitabilityProblems.push(`${prefix} ${suitabilityProblem}`);
    if (deadlineProblems.length) malformedDeadlineProblems.push(`${prefix} ${deadlineProblems.slice(0, 3).join(', ')}`);
    if (!protectedDetailFeed && item.status !== 'application_closed' && item.processTrack === 'exam-formal' && item.detailLevel === 'detailed-public-recruit' && unresolvedDeadline.length) {
      unresolvedDeadlineProblems.push(`${prefix} ${unresolvedDeadline.slice(0, 2).join(', ')}`);
    }
    if (!protectedDetailFeed && item.status !== 'application_closed' && item.processTrack === 'exam-formal' && item.detailLevel === 'detailed-public-recruit' && unresolvedQualification.length) {
      unresolvedQualificationProblems.push(`${prefix} ${unresolvedQualification.slice(0, 2).join(', ')}`);
    }
    if (!titleIncludesCompanyName(item)) titleCompanyProblems.push(`${prefix} company=${item.company}`);
    if (!assessment || assessment.version !== 1 || typeof assessment.highSchoolEligible !== 'boolean' || typeof assessment.militaryUnservedEligible !== 'boolean') {
      assessmentProblems.push(prefix);
    } else {
      if (assessment.hardBlocked) blockedPublicationProblems.push(`${prefix} ${assessment.reasons?.join(', ') || ''}`);
      if (item.processTrack === 'exam-formal' && item.status !== 'application_closed') {
        if (assessment.militaryUnservedEligible) militaryUnservedExamItems.push(item);
        if (assessment.militaryCompletionRequired) militaryLimitedExamItems.push(item);
      }
      if (item.processTrack === 'direct-interview' && item.status !== 'application_closed' && assessment.directQuality && assessment.militaryUnservedEligible) {
        qualityDirectItems.push(item);
      }
    }
    if (!protectedDetailFeed && isKbMainPageRecruitLink(item)) mainPageRecruitLinkProblems.push(`${prefix} ${item.url}`);
    if ((item.collectionAudit?.detectionLagDays ?? 0) < 0) negativeLag.push(prefix);
    if (item.status === 'application_closed' && !String(item.title).endsWith('(원서 마감)')) closedTitleProblems.push(prefix);
    if (item.status === 'application_closed' && item.processTrack !== 'exam-formal') closedTitleProblems.push(`${prefix} direct-closed`);
    if (!protectedDetailFeed && (!item.teacherBriefing?.teacherShareText || !Array.isArray(item.teacherBriefing?.schoolActionItems) || !Array.isArray(item.teacherBriefing?.studentActionItems))) {
      briefingProblems.push(prefix);
    }
    if (item.processTrack === 'exam-formal') {
      if (!protectedDetailFeed && (!item.publicRecruitDetails || !item.sourceVerification?.doubleCheckStatus)) examDetailProblems.push(prefix);
      if (!protectedDetailFeed && !officialDoubleCheckStatuses.includes(item.sourceVerification?.doubleCheckStatus) && !hasOfficialPublicRecruitSource(item)) weakOfficialPublicRecruit.push(prefix);
    } else if (item.detailLevel !== 'brief-company-contact') {
      directPolicyProblems.push(prefix);
    }
  }

  fail(`${label}.items.required-fields`, itemProblems.length === 0, `${label} 모든 공고가 필수 표시 필드를 갖습니다.`, itemProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-negative-lag`, negativeLag.length === 0, `${label} 첫날수집 계산에 음수 지연이 없습니다.`, negativeLag.slice(0, 5).join(' | '));
  fail(`${label}.items.closed-title-suffix`, closedTitleProblems.length === 0, `${label} 원서 마감 공고는 제목 끝에 (원서 마감)이 붙습니다.`, closedTitleProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.exam-detail`, examDetailProblems.length === 0, `${label} 공채 상세 정보는 상세 정보와 2중확인 상태를 갖습니다.`, examDetailProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.teacher-briefing`, briefingProblems.length === 0, `${label} 모든 공고가 취업부 브리핑과 공유 문안을 갖습니다.`, briefingProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.direct-policy`, directPolicyProblems.length === 0, `${label} 면접중심·현장형 채용은 간단 안내로 분리되고 교육청 소스는 직접 표시되지 않습니다.`, directPolicyProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-regional-education-direct-card`, regionalEducationDirectItems.length === 0, `${label} 지역 교육청·학교 취업지원 소식은 직접 결과 카드로 노출되지 않습니다.`, regionalEducationDirectItems.slice(0, 5).map((item) => `${item.source}:${item.title}`).join(' | '));
  fail(`${label}.items.high-school-suitability`, suitabilityProblems.length === 0, `${label} 고졸·졸업예정자 코너에 학생 추천 적합성이 낮거나 경력·전문자격 전용인 공고가 섞이지 않습니다.`, suitabilityProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-malformed-deadline-text`, malformedDeadlineProblems.length === 0, `${label} 마감일 표시에 존재하지 않는 날짜 조각이 없습니다.`, malformedDeadlineProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-unresolved-current-deadline`, unresolvedDeadlineProblems.length === 0, `${label} 진행중 공채 상세는 공식 원문 재확인 후 확정 마감일을 표시합니다.`, unresolvedDeadlineProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-unresolved-current-qualification`, unresolvedQualificationProblems.length === 0, `${label} 진행중 공채 상세는 공식 원문 재확인 후 자격요건을 구체적으로 표시합니다.`, unresolvedQualificationProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-kb-main-page-recruit-link`, mainPageRecruitLinkProblems.length === 0, `${label} KB국민은행 공고는 채용 메인페이지가 아니라 상세 공고 URL로 연결합니다.`, mainPageRecruitLinkProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.title-includes-company`, titleCompanyProblems.length === 0, `${label} 채용 공고 제목에는 기관명·기업명이 포함됩니다.`, titleCompanyProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.student-channel-assessment`, assessmentProblems.length === 0, `${label} 모든 공고가 고졸 지원·병역 미필·채널 품질 판정 결과를 갖습니다.`, assessmentProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.no-hard-blocked-publication`, blockedPublicationProblems.length === 0, `${label} 대학생·학위 전용, 전문자격 전용 등 고졸 학생이 지원할 수 없는 공고는 게시하지 않습니다.`, blockedPublicationProblems.slice(0, 5).join(' | '));
  fail(`${label}.items.military-unserved-exam-options`, militaryUnservedExamItems.length >= 3, `${label} 병역 미필 고졸 학생이 실제 도전할 수 있는 진행 중 추천 공채를 3건 이상 확보합니다.`, `eligible=${militaryUnservedExamItems.length}, limited=${militaryLimitedExamItems.length}`);
  fail(`${label}.items.quality-direct-options`, qualityDirectItems.length >= 12, `${label} 병역 미필 일반 고졸 학생에게 고용안정·전공연계·복리후생 가능성이 있는 일반 취업정보를 12건 이상 확보합니다.`, `qualityDirect=${qualityDirectItems.length}`);
  fail(`${label}.items.no-public-detail-leak`, publicDetailLeaks.length === 0, `${label} 공개 목록 JSON에 원문·첨부·상세자격·전형·브리핑이 노출되지 않습니다.`, publicDetailLeaks.slice(0, 5).join(' | '));
  warn(`${label}.items.official-double-check`, weakOfficialPublicRecruit.length === 0, `${label} 공채 상세 정보 항목은 회사·기관·채용대행 또는 잡알리오 상세 공식 공고 확인이 필요합니다.`, weakOfficialPublicRecruit.slice(0, 5).join(' | '));

  const readySources = sourceStatus.filter((source) => source.configured && sourceOperationalOrPreserved(items, source, source.id)).length;
  const jobAlioStatus = sourceStatus.find((source) => source.id === 'job-alio-openapi');
  const financeLargeCompanyStatus = sourceStatus.find((source) => source.id === 'finance-large-company-recruit');
  const regionalEducationStatus = sourceStatus.find((source) => source.id === 'regional-education-job');
  const watchedEmployers = Array.isArray(financeLargeCompanyStatus?.watchEmployers) ? financeLargeCompanyStatus.watchEmployers : [];
  const missingWatchEmployers = REQUIRED_FINANCE_LARGE_COMPANY_WATCH_EMPLOYERS
    .filter((employer) => !watchedEmployers.some((watched) => String(watched).includes(employer) || employer.includes(String(watched))));
  const watchedRegionalEmployers = Array.isArray(regionalEducationStatus?.watchEmployers) ? regionalEducationStatus.watchEmployers : [];
  const missingRegionalWatchEmployers = REQUIRED_REGIONAL_EDUCATION_WATCH_EMPLOYERS
    .filter((employer) => !watchedRegionalEmployers.some((watched) => String(watched).includes(employer) || employer.includes(String(watched))));
  const jobAlioItemCount = items.filter((item) => item.source === 'job-alio-openapi').length;
  const jobAlioFallbackCount = staleFallbackCountForSource(items, 'job-alio-openapi');
  const jobAlioFallbackProtected = sourceFallbackProtected(items, jobAlioStatus, 'job-alio-openapi');
  const jobAlioLiveOk = Boolean(jobAlioStatus?.ok);
  const jobAlioMissingCurrent = jobAlioStatus?.criticalCoverage?.missingCurrent || [];
  fail(`${label}.sources.job-alio-ok`, jobAlioLiveOk || jobAlioFallbackProtected, `${label} 잡알리오 공식 채용 수집원이 정상 동작하거나 직전 정상 공고를 보존합니다.`, jobAlioStatus?.message || `보존 항목 ${jobAlioItemCount}건`);
  warn(`${label}.sources.job-alio-live-reachable`, jobAlioLiveOk, `${label} 잡알리오 공식 채용 실시간 접속 상태를 확인합니다.`, jobAlioStatus?.message || '');
  fail(`${label}.sources.job-alio-expanded-scan`, jobAlioLiveOk
    ? Number(jobAlioStatus?.scanTargetCount || 0) >= 10 && Number(jobAlioStatus?.candidateRowCount || 0) >= requiredCritical.length
    : jobAlioFallbackProtected, `${label} 잡알리오는 검색어·핵심기관 경로를 훑거나 일시 장애 시 기존 정상 공고를 보존합니다.`, `scanTarget=${jobAlioStatus?.scanTargetCount || 0}, candidate=${jobAlioStatus?.candidateRowCount || 0}, preserved=${jobAlioFallbackCount || jobAlioItemCount}`);
  fail(`${label}.sources.job-alio-dynamic-current-scan`, jobAlioLiveOk
    ? Number(jobAlioStatus?.dynamicDiscovery?.recentRowsDetailed || 0) > 0
      && Number(jobAlioStatus?.dynamicDiscovery?.missingCandidateCount || 0) === 0
    : jobAlioFallbackProtected, `${label} 잡알리오는 오늘 기준 최근 등록 공고 상세를 열어 고졸·학력무관 후보 누락을 자동 점검합니다.`, `recentDetailed=${jobAlioStatus?.dynamicDiscovery?.recentRowsDetailed || 0}, missing=${jobAlioStatus?.dynamicDiscovery?.missingCandidateCount || 0}`);
  fail(`${label}.sources.job-alio-critical-coverage`, jobAlioLiveOk ? jobAlioMissingCurrent.length === 0 : (jobAlioFallbackProtected || jobAlioMissingCurrent.length === 0), `${label} 잡알리오 핵심 공고 감시 대상 누락이 없습니다.`, jobAlioMissingCurrent.map((job) => `${job.company}:${job.idx}`).join(', '));
  const financeLargeCompanyProtected = sourceFallbackProtected(items, financeLargeCompanyStatus, 'finance-large-company-recruit');
  fail(`${label}.sources.finance-large-company-ok`, Boolean(financeLargeCompanyStatus?.ok) || financeLargeCompanyProtected, `${label} 금융권·대기업 공식 채용 페이지 감시원이 정상 동작하거나 직전 정상 공고를 보존합니다.`, financeLargeCompanyStatus?.message || '');
  fail(`${label}.sources.finance-large-company-watch-count`, financeLargeCompanyProtected || (Number(financeLargeCompanyStatus?.watchEmployerCount || 0) >= MIN_FINANCE_LARGE_COMPANY_WATCH_COUNT && Number(financeLargeCompanyStatus?.builtInFeedCount || 0) >= MIN_FINANCE_LARGE_COMPANY_WATCH_COUNT), `${label} 대기업·1금융·2금융 공식 채용 감시 대상이 충분하거나 일시 장애 시 기존 정상 공고를 보존합니다.`, `watch=${financeLargeCompanyStatus?.watchEmployerCount || 0}, builtIn=${financeLargeCompanyStatus?.builtInFeedCount || 0}, preserved=${staleFallbackCountForSource(items, 'finance-large-company-recruit')}`);
  fail(`${label}.sources.finance-large-company-required-watch`, financeLargeCompanyProtected || missingWatchEmployers.length === 0, `${label} 핵심 대기업·금융권 공식 채용 채널이 감시 목록에 포함되어 있거나 보존 공고로 보호됩니다.`, missingWatchEmployers.join(', '));
  warn(`${label}.sources.finance-large-company-url-failures`, Number(financeLargeCompanyStatus?.checkedUrlCount || 0) >= Math.ceil(Number(financeLargeCompanyStatus?.builtInFeedCount || 0) * 0.5), `${label} 금융권·대기업 공식 채용 페이지 절반 이상에 접속했습니다.`, `checked=${financeLargeCompanyStatus?.checkedUrlCount || 0}, failed=${financeLargeCompanyStatus?.failedUrlCount || 0}`);
  fail(`${label}.sources.regional-education-ok`, Boolean(regionalEducationStatus?.ok), `${label} 지역별 교육청 취업지원센터 감시원이 정상 동작합니다.`, regionalEducationStatus?.message || '');
  fail(`${label}.sources.regional-education-watch-count`, Number(regionalEducationStatus?.watchEmployerCount || 0) >= MIN_REGIONAL_EDUCATION_WATCH_COUNT && Number(regionalEducationStatus?.builtInFeedCount || 0) >= MIN_REGIONAL_EDUCATION_WATCH_COUNT, `${label} 지역 교육청 공식 취업지원센터 감시 대상이 충분합니다.`, `watch=${regionalEducationStatus?.watchEmployerCount || 0}, builtIn=${regionalEducationStatus?.builtInFeedCount || 0}`);
  fail(`${label}.sources.regional-education-required-watch`, missingRegionalWatchEmployers.length === 0, `${label} 핵심 시도교육청 취업지원센터가 감시 목록에 포함되어 있습니다.`, missingRegionalWatchEmployers.join(', '));
  const regionalRule = String(feed.collectionPolicy?.regionalEducationSourceRule || '');
  fail(`${label}.sources.regional-education-source-rule`, regionalRule.includes('직접 결과 카드로 노출하지') && regionalRule.includes('잡알리오') && regionalRule.includes('보조검증'), `${label} 지역 교육청·학교 소식은 직접 노출하지 않고 보조검증으로만 쓰는 정책이 기록되어 있습니다.`, regionalRule);
  warn(`${label}.sources.regional-education-url-failures`, Number(regionalEducationStatus?.checkedUrlCount || 0) >= Math.ceil(Number(regionalEducationStatus?.builtInFeedCount || 0) * 0.5), `${label} 지역 교육청 공식 취업지원센터 절반 이상에 접속했습니다.`, `checked=${regionalEducationStatus?.checkedUrlCount || 0}, failed=${regionalEducationStatus?.failedUrlCount || 0}`);
  warn(`${label}.sources.ready-count`, readySources >= 2, `${label} 현재 정상 수집 가능한 공식 소스가 2개 이상입니다.`, `${readySources}개`);
  warn(`${label}.sources.public-data-next`, secretReadiness.easiestNextAction?.id === 'mpm-public-job' || secretReadiness.readySources > 2, `${label} 다음 확장 우선순위가 인사혁신처 공공취업 API입니다.`, secretReadiness.easiestNextAction?.id || '');

  return { items };
}

function validateFeedHealth(health, feed, label = 'local') {
  const summary = feed.summary || {};
  const healthSummary = health.summary || {};
  const sourceStatus = Array.isArray(feed.sourceStatus) ? feed.sourceStatus : [];
  const configuredSources = sourceStatus.filter((source) => source.configured);
  const failedConfiguredSources = configuredSources.filter((source) => !source.ok);
  const healthSourceFailures = Array.isArray(health.sourceFailures) ? health.sourceFailures : [];
  const safety = feed.publicationSafety || {};
  const feedGeneratedAt = new Date(feed.generatedAt || '');
  const healthFeedGeneratedAt = new Date(health.feedGeneratedAt || '');
  const isNewerDiagnostic = health.feedGeneratedAt !== feed.generatedAt
    && !Number.isNaN(feedGeneratedAt.getTime())
    && !Number.isNaN(healthFeedGeneratedAt.getTime())
    && healthFeedGeneratedAt.getTime() >= feedGeneratedAt.getTime()
    && health.status !== 'ok'
    && healthSourceFailures.length > 0;

  fail(`${label}.health.version`, health.version === 1, `${label} 자동수집 건강 상태 파일 버전이 1입니다.`);
  fail(`${label}.health.generated-at`, hoursSince(health.generatedAt) !== null, `${label} 자동수집 건강 상태 생성 시각이 유효합니다.`, health.generatedAt || '');
  fail(`${label}.health.feed-generated-at-match`, health.feedGeneratedAt === feed.generatedAt || isNewerDiagnostic, `${label} 건강 상태 파일이 현재 피드 또는 더 최신 부분실패 진단을 가리킵니다.`, `${health.feedGeneratedAt || ''} / ${feed.generatedAt || ''}`);
  fail(`${label}.health.total-match`, isNewerDiagnostic || healthSummary.total === summary.total, `${label} 건강 상태 총 공고 수가 피드 summary와 일치합니다.`, `${healthSummary.total} / ${summary.total}`);
  fail(`${label}.health.source-failure-count`, isNewerDiagnostic ? healthSummary.sourcesFailed === healthSourceFailures.length : healthSummary.sourcesFailed === failedConfiguredSources.length, `${label} 건강 상태 소스 실패 수가 기록과 일치합니다.`, `${healthSummary.sourcesFailed} / ${isNewerDiagnostic ? healthSourceFailures.length : failedConfiguredSources.length}`);
  fail(`${label}.health.source-fallback-count`, isNewerDiagnostic || (healthSummary.sourceFallbackProtected || 0) === (summary.sourceFallbackProtected || 0), `${label} 건강 상태의 실패 소스 보존 공고 수가 피드 summary와 일치합니다.`, `${healthSummary.sourceFallbackProtected || 0} / ${summary.sourceFallbackProtected || 0}`);
  fail(`${label}.health.publication-safety`, safety.policy === 'pre-publication-safety-guard-v1' && health.publicationSafety?.policy === safety.policy, `${label} 게시 직전 안전 필터 결과가 피드와 건강 상태 파일에 기록됩니다.`);
  fail(`${label}.health.no-failed-status-with-items`, health.status !== 'failed' || summary.total === 0, `${label} 공고가 있는 피드는 건강 상태가 failed로 표시되지 않습니다.`, health.status || '');
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
  let liveFeedUrl = `${LIVE_FEED}?${cacheBust}`;
  try {
    const home = await fetchText(`${LIVE_HOME}?${cacheBust}`);
    fail('live.home.status', home.ok, '라이브 홈페이지가 HTTP 200 계열로 응답합니다.', `status ${home.status}`);
    fail('live.home.job-hub', home.text.includes('직업계고 취업지도 허브'), '라이브 홈페이지에 공채 허브가 포함되어 있습니다.');
    fail('live.home.feed-url', home.text.includes('assets/job-feed.json?v='), '라이브 홈페이지가 버전이 붙은 공채 피드를 참조합니다.');
    fail('live.home.regional-education-display-guard', home.text.includes('isRegionalEducationDisplayBlocked'), '라이브 홈페이지가 오래된 교육청 보조자료 직접 카드를 클라이언트에서 차단합니다.');
    const feedUrlMatch = home.text.match(/assets\/job-feed\.json\?v=[^'"<\s)]+/);
    if (feedUrlMatch) liveFeedUrl = new URL(feedUrlMatch[0], LIVE_HOME).toString();
  } catch (error) {
    fail('live.home.fetch', false, '라이브 홈페이지 확인에 실패했습니다.', error.message);
  }

  try {
    const separator = liveFeedUrl.includes('?') ? '&' : '?';
    const feedResponse = await fetchText(`${liveFeedUrl}${separator}${cacheBust}`);
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
  const curlResult = await checkUrlWithCurl(url).catch((error) => ({ ok: false, status: 0, error: error.message }));
  if (curlResult.ok) return { ...curlResult, attempt: 'curl', fetchError: lastError };
  return { ok: false, status: 0, error: lastError || 'fetch failed' };
}

async function checkUrlWithCurl(url) {
  const commands = process.platform === 'win32' ? ['curl.exe', 'curl'] : ['curl', 'curl.exe'];
  const outputTarget = process.platform === 'win32' ? 'NUL' : '/dev/null';
  let lastError = '';
  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync(command, [
        '-L',
        '--max-time',
        '20',
        '--silent',
        '--show-error',
        '--output',
        outputTarget,
        '--write-out',
        '%{http_code}',
        url
      ], { timeout: 24000, maxBuffer: 1024 * 32 });
      const status = Number(String(stdout).trim().slice(-3));
      if (Number.isFinite(status) && status > 0) {
        return { ok: status < 500 && status !== 404, status };
      }
    } catch (error) {
      lastError = error.message;
    }
  }
  return { ok: false, status: 0, error: lastError || 'curl failed' };
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
  await validateJobFetcherRules();
  await validateHomepage();
  await validateCoreContentPages();
  await validateDirectionDocs();
  const localFeed = await readJson('assets/job-feed.json');
  const localHealth = await readJson('assets/job-feed-health.json');
  await validateProtectedJobVault(localFeed);
  const { items } = validateFeed(localFeed, 'local');
  validateFeedHealth(localHealth, localFeed, 'local');

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
