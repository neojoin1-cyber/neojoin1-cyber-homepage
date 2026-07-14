import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'assets', 'job-feed.json');
const HEALTH_FILE = path.join(ROOT_DIR, 'assets', 'job-feed-health.json');
const JOB_DETAIL_VAULT_FILE = path.join(ROOT_DIR, 'assets', 'job-detail-vault.json');
const ZIP_ATTACHMENT_EXTRACT_DIR = path.join(ROOT_DIR, 'assets', 'job-attachment-files');
const ZIP_ATTACHMENT_PUBLIC_BASE = 'assets/job-attachment-files';
const execFileAsync = promisify(execFile);
const JOB_DETAIL_PUBLIC_KEY_SPKI = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyGKYpyiaYpFN6BUhEuD4dGpRiTLW6kZ21GYg+v0sdbGvaZ+4/cxkoh8+8nXLDpimx/vgOebiUw6b/4rq2HO4TfpCJ/MJeeO5IQwDNgv9OmYqVSy9Nkuxmo8mWQAXlmArPs38Yaaml+mrDqcuztXMA4zOKA6HDaX7trAZk3uGihOPbqUJJmEhJJ5/zlDubf4tyzfwHUYxkiQBv4BFtvbmnqV0AdW8NZhiuPrWySejAR/qruWkhD92FOoKW2RDTvUEfk/bkQEOcnyyXEcktfHivyGuwZSC5nDo6rKiDPMzEswUnSfAVW4TO9E1K5q7hrNqss+u8Cmr7b8ht9BhzyXiCQIDAQAB';

await loadLocalEnvFile(path.join(ROOT_DIR, '.env.local'));

const NOW = new Date();
const CHECKED_AT = NOW.toISOString();
const MAX_ITEMS = 120;
const REQUEST_TIMEOUT_MS = 18000;
const JOB_ALIO_LIST_RETRY_TIMEOUTS_MS = [12000];
const JOB_ALIO_CRITICAL_LIST_RETRY_TIMEOUTS_MS = [12000, 18000];
const JOB_ALIO_DETAIL_TIMEOUT_MS = 12000;
const JOB_ALIO_CRITICAL_DETAIL_RETRY_TIMEOUTS_MS = [15000, 22000];
const PUBLIC_API_TIMEOUT_MS = 9000;
const DETAIL_FETCH_CONCURRENCY = 8;
const JOB_ALIO_LIST_FETCH_CONCURRENCY = 10;
const PUBLIC_API_FETCH_CONCURRENCY = 8;
const APPLICATION_CLOSED_RETAIN_DAYS = 365;
const MAX_ARCHIVE_ITEMS = 160;
const JOB_ALIO_SCAN_LIMIT = 500;
const JOB_ALIO_SCAN_PAGES = 30;
const JOB_ALIO_RECENT_DETAIL_DAYS = 21;
const JOB_ALIO_RECENT_DETAIL_LIMIT = 340;
const OFFICIAL_WATCH_TIMEOUT_MS = 15000;
const COMPANY_NOTICE_TIMEOUT_MS = 15000;
const GENERIC_OFFICIAL_FEED_CONCURRENCY = 5;
const PENDING_SOURCE_CONCURRENCY = 3;
const EXTERNAL_CLIENT_GRACE_MS = 1500;
const MIN_FALLBACK_TIMEOUT_MS = 1200;
const REACHABILITY_TIMEOUT_MS = 7000;
const ZIP_ATTACHMENT_TIMEOUT_MS = 30000;
const ZIP_ATTACHMENT_CONCURRENCY = 3;
const ZIP_ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
const ZIP_ATTACHMENT_EXTRACT_MAX_BYTES = 16 * 1024 * 1024;
const ZIP_ATTACHMENT_MAX_ENTRIES = 160;
const DEFAULT_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6'
};
const CORE_PUBLICATION_SOURCE_IDS = new Set(['job-alio-openapi']);

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
const NEGATIVE_EDU_TERMS = ['대졸 이상', '대졸(4년)', '대졸(2~3년)', '전문대졸', '4년제', '대학교 졸업', '학사 이상', '석사', '박사'];
const PROFESSIONAL_ONLY_TERMS = ['전문의', '의사', '약사', '간호사', '간호조무사', '간호조무', '요양보호사', '요양보호직', '치과위생사', '임상병리사', '물리치료사', '작업치료사', '방사선사', '청능사', '보건의료정보관리사', '영양사', '공인회계사', '회계사', '변호사', '세무사', '노무사', '법무사', '건축사', '정교사', '교원자격', '교사 자격', '보육교사', '면허 소지', '면허소지', '석사', '박사', '기술사'];
const ENTRY_LEVEL_TERMS = [
  '고졸',
  '고등학교',
  '특성화고',
  '직업계고',
  '마이스터고',
  '졸업예정',
  '졸업 예정',
  '학교장 추천',
  '학교장추천',
  '고졸제한',
  '고졸 제한',
  '사회형평 고졸',
  '신입',
  '경력무관',
  '신입+경력',
  '신입·경력',
  '청년인턴',
  '채용형 인턴',
  '공무직',
  '업무지원직',
  '기간제',
  '9급',
  '지역인재',
  '기능인재'
];
const SENIOR_ROLE_PATTERN = /(원장|센터장|기관장|본부장|부원장|교장|공모교장|교감|원감|사무총장|총장|개방형\s*직위|전문계약직|연봉계약직|임원|상임감사|비상임감사|감사위원|이사장|대표이사)/;
const RESTRICTED_ROLE_PATTERN = /(관리직|별정직|책임연구원|선임연구원|교수)/;
const STUDENT_UNSUITABLE_HEALTHCARE_ROLE_PATTERN = /(요양보호(?:사|직)|간호조무(?:사|직)?|병동\s*간호조무|치과위생사|임상병리사|임상심리사|정신건강전문요원|사회복지사|물리치료사|작업치료사|방사선사|청능사|보건의료정보관리사|영양사|장례지도사|완화의료|호스피스)/;

const WORK24_OPEN_RECRUIT_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L21.do';
const SARAMIN_JOB_SEARCH_URL = 'https://oapi.saramin.co.kr/job-search';
const JOB_ALIO_RECRUIT_URL = 'https://job.alio.go.kr/recruit.do';
const RECRUITER_JOBFLEX_LIST_URL = 'https://api-recruiter.recruiter.co.kr/position/v1/jobflex';
const RECRUITER_JOBFLEX_DETAIL_BASE_URL = 'https://api-recruiter.recruiter.co.kr/position/v2/jobflex';
const RECRUITER_JOBFLEX_PAGE_SIZE = 80;
const RECRUITER_JOBFLEX_DETAIL_CONCURRENCY = 3;
const SEOUL_HIGHJOB_RECRUIT_URL = 'https://high-job.sen.go.kr/FUS/JO/EMList.do';
const SEOUL_HIGHJOB_DETAIL_URL = 'https://high-job.sen.go.kr/FUS/JO/EMView.do';
const SEOUL_HIGHJOB_SCAN_PAGES = 2;
const MOEF_PUBLIC_RECRUIT_DATA_URL = 'https://www.data.go.kr/data/15125273/openapi.do';
const MOEF_PUBLIC_RECRUIT_LIST_URL = 'https://apis.data.go.kr/1051000/recruitment/list';
const MPM_PUBLIC_JOB_DATA_URL = 'https://www.data.go.kr/data/15156780/openapi.do';
const MPM_PUBLIC_JOB_LIST_URL = 'https://apis.data.go.kr/1760000/PblJobService/getList';
const MPM_PUBLIC_JOB_ENDPOINT_CANDIDATES = [
  MPM_PUBLIC_JOB_LIST_URL,
  'https://apis.data.go.kr/1760000/PublicJobInformationService/getPublicJobInfo',
  'https://apis.data.go.kr/1760000/PublicJobInfoService/getPublicJobInfo',
  'https://apis.data.go.kr/1760000/PublicEmploymentInfoService/getPublicEmploymentInfo',
  'https://apis.data.go.kr/1741000/PublicJobInformationService/getPublicJobInfo'
];
const MPM_PUBLIC_JOB_NOTICE_TYPES = ['e01', 'e02', 'e03', 'e04', 'e06', 'e07', 'e08'];
const MPM_PUBLIC_JOB_INSTITUTION_TYPES = ['g01', 'g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08'];
const PUBLIC_DATA_PAGE_SIZE = 60;
const JOB_ALIO_KEYWORD_QUERIES = [
  { searchType: 'title', keyword: '고졸' },
  { searchType: 'title', keyword: '특성화고' },
  { searchType: 'title', keyword: '직업계고' },
  { searchType: 'title', keyword: '마이스터고' },
  { searchType: 'title', keyword: '졸업예정' },
  { searchType: 'title', keyword: '학력무관' },
  { searchType: 'title', keyword: '청년인턴' },
  { searchType: 'title', keyword: '채용형 인턴' },
  { searchType: 'title', keyword: '기능인재' },
  { searchType: 'title', keyword: '지역인재' },
  { searchType: 'elig', keyword: '고졸' },
  { searchType: 'elig', keyword: '고등학교' },
  { searchType: 'elig', keyword: '고교' },
  { searchType: 'elig', keyword: '졸업예정' },
  { searchType: 'elig', keyword: '특성화고' },
  { searchType: 'elig', keyword: '직업계고' },
  { searchType: 'elig', keyword: '학력무관' },
  { searchType: 'elig', keyword: '기술직' },
  { searchType: 'elig', keyword: '업무지원직' }
];
const CRITICAL_JOB_ALIO_ORGS = [
  { orgCode: 'C0247', orgName: '한국전력공사', aliases: ['한전', 'KEPCO'] },
  { orgCode: 'C0187', orgName: '한국방송통신전파진흥원', aliases: ['KCA'] },
  { orgCode: 'C0306', orgName: '한전KDN', aliases: [] },
  { orgCode: 'C0305', orgName: '한전KPS(주)', aliases: ['한전KPS'] },
  { orgCode: 'C0248', orgName: '한국전력기술주식회사', aliases: ['한국전력기술'] },
  { orgCode: 'C0220', orgName: '한국수력원자력', aliases: ['한수원'] },
  { orgCode: 'C0259', orgName: '한국중부발전(주)', aliases: ['한국중부발전', 'KOMIPO'] },
  { orgCode: 'C0042', orgName: '한국남동발전(주)', aliases: ['한국남동발전', 'KOEN'] },
  { orgCode: 'C0043', orgName: '한국남부발전(주)', aliases: ['한국남부발전', 'KOSPO'] },
  { orgCode: 'C0066', orgName: '한국동서발전(주)', aliases: ['한국동서발전', 'EWP'] },
  { orgCode: 'C0082', orgName: '한국서부발전(주)', aliases: ['한국서부발전', 'KOWEPO'] },
  { orgCode: 'C0147', orgName: '한국가스공사', aliases: ['KOGAS'] },
  { orgCode: 'C0183', orgName: '한국도로공사', aliases: [] },
  { orgCode: 'C0268', orgName: '한국철도공사', aliases: ['코레일'] },
  { orgCode: 'C0157', orgName: '한국공항공사', aliases: ['KAC'] },
  { orgCode: 'C0105', orgName: '인천국제공항공사', aliases: [] },
  { orgCode: 'C0210', orgName: '한국산업은행', aliases: ['KDB산업은행'] },
  { orgCode: 'C0127', orgName: '중소기업은행', aliases: ['IBK기업은행', '기업은행'] },
  { orgCode: 'C0223', orgName: '한국수출입은행', aliases: [] },
  { orgCode: 'C0035', orgName: '근로복지공단', aliases: [] },
  { orgCode: 'C0026', orgName: '국민건강보험공단', aliases: [] },
  { orgCode: 'C0028', orgName: '국민연금공단', aliases: [] },
  { orgCode: 'C0242', orgName: '한국장애인고용공단', aliases: [] },
  { orgCode: 'C0211', orgName: '한국산업인력공단', aliases: [] },
  { orgCode: 'C0213', orgName: '한국석유공사', aliases: [] },
  { orgCode: 'C0253', orgName: '한국조폐공사', aliases: [] },
  { orgCode: 'C0258', orgName: '한국지역난방공사', aliases: [] },
  { orgCode: 'C0249', orgName: '한국전기안전공사', aliases: [] },
  { orgCode: 'C0148', orgName: '한국가스기술공사', aliases: [] },
  { orgCode: 'C0217', orgName: '한국수자원공사', aliases: ['K-water'] },
  { orgCode: 'C0231', orgName: '한국토지주택공사', aliases: ['LH'] },
  { orgCode: 'C0207', orgName: '한국산업안전보건공단', aliases: [] },
  { orgCode: 'C0144', orgName: '한국관광공사', aliases: [] },
  { orgCode: 'C0165', orgName: '한국마사회', aliases: [] },
  { orgCode: 'C0005', orgName: '예금보험공사', aliases: [] },
  { orgCode: 'C0232', orgName: '한국주택금융공사', aliases: [] },
  { orgCode: 'C0074', orgName: '신용보증기금', aliases: [] },
  { orgCode: 'C0022', orgName: '기술보증기금', aliases: [] },
  { orgCode: 'C0245', orgName: '한국자산관리공사', aliases: ['캠코'] },
  { orgCode: 'C0061', orgName: '주택도시보증공사', aliases: ['HUG', '주택보증공사'] },
  { orgCode: 'C0150', orgName: '한국농어촌공사', aliases: [] },
  { orgCode: 'C0166', orgName: '한국방송광고진흥공사', aliases: ['코바코'] },
  { orgCode: 'C0251', orgName: '한국인터넷진흥원', aliases: ['KISA'] },
  { orgCode: 'C0261', orgName: '한국직업능력연구원', aliases: [] }
];
const PUBLIC_INSTITUTION_CATEGORY_WATCH_ORGS = [
  { orgName: '한국광해광업공단', aliases: ['광해광업공단'] },
  { orgName: '한국환경공단', aliases: [] },
  { orgName: '한국교통안전공단', aliases: [] },
  { orgName: '한국국토정보공사', aliases: ['LX'] },
  { orgName: '국가철도공단', aliases: [] },
  { orgName: '한국해양교통안전공단', aliases: [] },
  { orgName: '한국소방산업기술원', aliases: [] },
  { orgName: '한국승강기안전공단', aliases: [] },
  { orgName: '한국가스안전공사', aliases: [] },
  { orgName: '한국에너지공단', aliases: [] },
  { orgName: '국토안전관리원', aliases: [] },
  { orgName: '도로교통공단', aliases: [] },
  { orgName: '공무원연금공단', aliases: [] },
  { orgName: '사립학교교직원연금공단', aliases: ['사학연금'] },
  { orgName: '국가철도공단', aliases: [] },
  { orgName: '한국고용정보원', aliases: [] },
  { orgName: '소상공인시장진흥공단', aliases: [] },
  { orgName: '중소벤처기업진흥공단', aliases: ['중진공'] },
  { orgName: '창업진흥원', aliases: ['KISED'] },
  { orgName: '한국무역보험공사', aliases: [] },
  { orgName: '서민금융진흥원', aliases: [] },
  { orgName: '한국투자공사', aliases: ['KIC'] },
  { orgName: '한국벤처투자', aliases: [] },
  { orgName: '한국콘텐츠진흥원', aliases: [] },
  { orgName: '정보통신산업진흥원', aliases: ['NIPA'] },
  { orgName: '한국지능정보사회진흥원', aliases: ['NIA'] },
  { orgName: '한국데이터산업진흥원', aliases: [] },
  { orgName: '한국산업기술진흥원', aliases: ['KIAT'] },
  { orgName: '한국산업기술기획평가원', aliases: ['KEIT'] },
  { orgName: '한국에너지기술평가원', aliases: [] },
  { orgName: '한국보건산업진흥원', aliases: [] },
  { orgName: '한국사회보장정보원', aliases: [] },
  { orgName: '건강보험심사평가원', aliases: ['심평원'] },
  { orgName: '한국교육학술정보원', aliases: ['KERIS'] },
  { orgName: '한국장학재단', aliases: [] },
  { orgName: '국가평생교육진흥원', aliases: [] },
  { orgName: '한국청소년활동진흥원', aliases: [] },
  { orgName: '한국문화예술위원회', aliases: [] },
  { orgName: '한국문화관광연구원', aliases: [] },
  { orgName: '한국언론진흥재단', aliases: [] },
  { orgName: '한국보훈복지의료공단', aliases: [] },
  { orgName: '한국보건복지인재원', aliases: [] },
  { orgName: '한국노인인력개발원', aliases: [] },
  { orgName: '한국사회복지협의회', aliases: [] },
  { orgName: '한국농수산식품유통공사', aliases: ['aT'] },
  { orgName: '축산물품질평가원', aliases: [] },
  { orgName: '농림식품기술기획평가원', aliases: [] },
  { orgName: '한국어촌어항공단', aliases: [] },
  { orgName: '한국해양수산연수원', aliases: [] },
  { orgName: '한국산림복지진흥원', aliases: [] },
  { orgName: '한국임업진흥원', aliases: [] }
];
const JOB_ALIO_EXTRA_WATCH_ORG_SECRET_NAMES = ['JOB_ALIO_EXTRA_WATCH_ORGS', 'JOB_ALIO_WATCH_ORGS'];
const CRITICAL_CURRENT_JOB_ALIO_ITEMS = [
  {
    id: 'kepco-2026-highschool-4grade',
    idx: '301166',
    company: '한국전력공사',
    titleHint: '2026년도 4직급 고졸 신입사원 채용공고',
    titleTerms: ['고졸', '신입사원'],
    bodyTerms: ['고등학교', '졸업예정'],
    deadline: '2026-06-12'
  },
  {
    id: 'kca-2026-highschool-admin',
    idx: '301041',
    company: '한국방송통신전파진흥원',
    titleHint: '한국방송통신전파진흥원 경력·신입 직원 채용 공고',
    titleTerms: ['경력', '신입', '직원'],
    bodyTerms: ['사무행정', '고졸전형'],
    deadline: '2026-06-11'
  },
  {
    id: 'hug-2026-entry-regular',
    idx: '301943',
    company: '주택도시보증공사',
    titleHint: '2026년도 주택도시보증공사 정규직(신입직) 채용공고',
    titleTerms: ['정규직', '신입직'],
    bodyTerms: ['고졸', '학력무관'],
    deadline: '2026-07-08'
  },
  {
    id: 'komipo-2026-2nd-grade4-highschool',
    idx: '302314',
    company: '한국중부발전',
    titleHint: '2026년도 제2차 4직급 신입직원 채용공고',
    titleTerms: ['제2차', '4직급', '신입직원'],
    bodyTerms: ['고졸수준', '고졸 채용'],
    deadline: '2026-07-22'
  },
  {
    id: 'kised-2026-2nd-new-staff-admin',
    idx: '302422',
    company: '창업진흥원',
    titleHint: '2026년 제2차 신규직원 채용 공고(일반행정)',
    titleTerms: ['신규직원', '일반행정'],
    bodyTerms: ['학력무관', '정규직'],
    deadline: '2026-07-20'
  }
];

const OFFICIAL_HTML_RECRUIT_TERMS = [
  '채용',
  '모집',
  '공고',
  '입사지원',
  '지원서',
  '원서접수',
  '접수기간',
  'recruit',
  'career',
  'careers',
  'job'
];

const OFFICIAL_HTML_HIGH_SCHOOL_SIGNALS = [
  '고졸',
  '고등학교',
  '고교',
  '특성화고',
  '직업계고',
  '마이스터고',
  '졸업예정',
  '졸업 예정',
  '학력무관',
  '학력 무관',
  '고졸전형',
  '고졸 전형',
  '고졸채용',
  '고졸 채용',
  '고졸공채',
  '고졸 공채',
  '사회형평',
  '지역인재',
  '기능인재',
  '기술직',
  '기능직',
  '생산직',
  '현장직',
  '전문기술직',
  '업무지원직',
  '공무직',
  '무기계약직',
  '기간제',
  '청년인턴',
  '채용형 인턴',
  '행원',
  '텔러',
  '창구',
  '일반직 5급',
  '일반직 6급',
  '일반직 7급',
  '5급',
  '6급',
  '7급',
  '초대졸 이하'
];

const OFFICIAL_HTML_STRONG_HIGH_SCHOOL_SIGNALS = [
  '고졸',
  '고등학교',
  '고교',
  '특성화고',
  '직업계고',
  '마이스터고',
  '졸업예정',
  '졸업 예정',
  '학력무관',
  '학력 무관',
  '고졸전형',
  '고졸 전형',
  '고졸채용',
  '고졸 채용',
  '고졸공채',
  '고졸 공채',
  '초대졸 이하'
];

const OFFICIAL_HTML_SKIP_LINK_TERMS = [
  '개인정보',
  '이용약관',
  '채용문의',
  'FAQ',
  '로그인',
  '회원가입',
  '합격조회',
  '지원서 수정',
  '인재상',
  '복리후생',
  '채용절차'
];

const REGIONAL_EDUCATION_RECRUIT_LINK_TERMS = [
  '채용공고',
  '채용 정보',
  '채용정보',
  '채용의뢰',
  '구인정보',
  '구인',
  '취업정보',
  '모집공고',
  '원서접수',
  '입사지원',
  '지원서',
  '공채',
  '일자리'
];

const REGIONAL_EDUCATION_CONCRETE_POST_TERMS = [
  '접수기간',
  '원서접수',
  '접수마감',
  '마감',
  '채용공고',
  '채용 정보',
  '채용정보',
  '채용의뢰',
  '고졸 채용공고',
  '고졸채용',
  '채용부문',
  '채용분야',
  '모집분야',
  '지원자격',
  '응시자격',
  '전형일정',
  '필기',
  '면접',
  '첨부',
  '붙임',
  '공고문',
  '직무기술서'
];

const REGIONAL_EDUCATION_BOARD_ONLY_TERMS = [
  '공채캘린더',
  '고졸채용',
  '고졸 채용',
  '고졸 채용공고',
  '채용정보',
  '채용 정보',
  '취업정보',
  '채용의뢰',
  '구인정보',
  '일자리'
];

const REGIONAL_VERIFICATION_MATCH_STOP_TERMS = new Set([
  '채용',
  '채용공고',
  '모집',
  '모집공고',
  '고졸',
  '고등학교',
  '특성화고',
  '직업계고',
  '마이스터고',
  '졸업예정',
  '원문',
  '확인',
  '공식',
  '공고',
  '채용정보',
  '취업정보',
  '구인정보',
  '교육청',
  '취업지원센터',
  '하이잡',
  '서울특별시교육청',
  '경상남도교육청',
  '부산광역시교육청'
]);

const REGIONAL_EDUCATION_SKIP_LINK_TERMS = [
  '특성화고란',
  '학교소개',
  '세종미래고등학교',
  '세종여자고등학교',
  '세종장영실고등학교',
  '직업계고학점제',
  'NCS기반교육과정',
  '직업기초능력평가',
  '글로벌현장학습',
  '학습중심현장실습',
  '일반고직업교육위탁과정',
  '선취업후학습',
  '현장실습운영',
  '취업처발굴',
  '홍보자료',
  '보도자료',
  '자료실',
  '찾아오시는길'
];

const FINANCE_LARGE_COMPANY_OFFICIAL_WATCHLIST = [
  { employer: '삼성', group: 'large-company', url: 'https://www.samsungcareers.com/', tags: ['대기업', '그룹공채'] },
  { employer: '현대자동차', group: 'large-company', url: 'https://talent.hyundai.com/main/main.hc', tags: ['대기업', '완성차'] },
  { employer: '기아', group: 'large-company', url: 'https://career.kia.com/', tags: ['대기업', '완성차'] },
  { employer: 'SK', group: 'large-company', url: 'https://www.skcareers.com/', tags: ['대기업', '그룹공채'] },
  { employer: 'SK하이닉스', group: 'large-company', url: 'https://recruit.skhynix.com/', tags: ['대기업', '반도체'] },
  { employer: 'LG', group: 'large-company', url: 'https://careers.lg.com/', tags: ['대기업', '그룹공채'] },
  { employer: 'LG CNS', group: 'large-company', url: 'https://www.lgcns.com/kr/careers/apply', tags: ['대기업', 'IT'] },
  { employer: '포스코', group: 'large-company', url: 'https://recruit.posco.com/h22a01-front/', tags: ['대기업', '철강'] },
  { employer: '포스코퓨처엠', group: 'large-company', url: 'https://recruit.posco.com/h22a01-front/', tags: ['대기업', '소재', '포스코그룹공식'] },
  { employer: '롯데', group: 'large-company', url: 'https://recruit.lotte.co.kr/', tags: ['대기업', '그룹공채'] },
  { employer: 'CJ', group: 'large-company', url: 'https://recruit.cj.net/', tags: ['대기업', '그룹공채'] },
  { employer: '한화', group: 'large-company', url: 'https://www.hanwhain.com/', tags: ['대기업', '그룹공채'] },
  { employer: 'HD현대', group: 'large-company', url: 'https://recruit.hd.com/', tags: ['대기업', '중공업'] },
  { employer: '두산', group: 'large-company', url: 'https://career.doosan.com/', tags: ['대기업', '그룹공채'] },
  { employer: 'LS', group: 'large-company', url: 'https://www.lsholdings.com/ko/careers/recruitment-guide', tags: ['대기업', '전기전자'] },
  { employer: 'KT', group: 'large-company', url: 'https://recruit.kt.com/', tags: ['대기업', '통신'] },
  { employer: 'KT&G', group: 'large-company', url: 'https://ktng.recruiter.co.kr/', tags: ['대기업', '채용대행공식'] },
  { employer: 'S-OIL', group: 'large-company', url: 'https://s-oil.recruiter.co.kr/', tags: ['대기업', '채용대행공식'] },
  { employer: 'GS칼텍스', group: 'large-company', url: 'https://gscaltex.recruiter.co.kr/', tags: ['대기업', '채용대행공식'] },
  { employer: '현대제철', group: 'large-company', url: 'https://hyundai-steel.recruiter.co.kr/', tags: ['대기업', '채용대행공식'] },
  { employer: '현대모비스', group: 'large-company', url: 'https://mobis.recruiter.co.kr/', tags: ['대기업', '채용대행공식'] },
  { employer: '네이버', group: 'large-company', url: 'https://recruit.navercorp.com/', tags: ['대기업', 'IT'] },
  { employer: '카카오', group: 'large-company', url: 'https://careers.kakao.com/', tags: ['대기업', 'IT'] },
  { employer: 'KB국민은행', group: 'finance', url: 'https://kbstar.careerlink.kr/', tags: ['1금융권', '은행'] },
  { employer: '신한은행', group: 'finance', url: 'https://shinhan.recruiter.co.kr/', tags: ['1금융권', '은행'] },
  { employer: '하나은행', group: 'finance', url: 'https://hanabank.recruiter.co.kr/', tags: ['1금융권', '은행'] },
  { employer: '우리은행', group: 'finance', url: 'https://wooribank.recruiter.co.kr/', tags: ['1금융권', '은행'] },
  { employer: 'NH농협은행', group: 'finance', url: 'https://with.nonghyup.com/jbnf/jbnfLst.do?srcAuthDsc=1', fallbackUrls: ['https://with.nonghyup.com/'], timeoutMs: 24000, tags: ['1금융권', '은행'] },
  { employer: 'IBK기업은행', group: 'finance', url: 'https://ibk.incruit.com/hire/hirelist.asp', fallbackUrls: ['https://ibk.incruit.com/index_main_2025.asp'], timeoutMs: 18000, tags: ['금융공기업', '은행'] },
  { employer: 'DGB대구은행', group: 'finance', url: 'https://im.recruiter.co.kr/', tags: ['1금융권', '지방은행', 'iM뱅크'] },
  { employer: 'BNK부산은행', group: 'finance', url: 'https://busanbank.recruiter.co.kr/', tags: ['1금융권', '지방은행'] },
  { employer: 'BNK경남은행', group: 'finance', url: 'https://knbank.recruiter.co.kr/', tags: ['1금융권', '지방은행'] },
  { employer: '광주은행', group: 'finance', url: 'https://www.kjbank.com/index.jsp', tags: ['1금융권', '지방은행', '공식홈페이지'] },
  { employer: '광주은행', group: 'finance', url: 'https://www.incruit.com/company/670180/job', tags: ['1금융권', '지방은행', '채용관보조'] },
  { employer: '전북은행', group: 'finance', url: 'https://jbbank.recruiter.co.kr/', tags: ['1금융권', '지방은행'] },
  { employer: '제주은행', group: 'finance', url: 'https://jejubank.recruiter.co.kr/', tags: ['1금융권', '지방은행'] },
  { employer: '수협은행', group: 'finance', url: 'https://shbank.incruit.com/hire/hirelist.asp', tags: ['1금융권', '은행'] },
  { employer: '카카오뱅크', group: 'finance', url: 'https://recruit.kakaobank.com/', tags: ['1금융권', '인터넷은행'] },
  { employer: '토스뱅크', group: 'finance', url: 'https://toss.im/career/jobs?company=tossbank', tags: ['1금융권', '인터넷은행'] },
  { employer: '새마을금고중앙회', group: 'finance', url: 'https://www.kfcc.co.kr/index.do', tags: ['2금융권'] },
  { employer: '신협', group: 'finance', url: 'https://cu.incruit.com/', tags: ['2금융권'] },
  { employer: '저축은행중앙회', group: 'finance', url: 'https://www.fsb.or.kr/index.act', tags: ['2금융권'] }
];

const LISTED_MID_COMPANY_OFFICIAL_WATCHLIST = [
  { employer: '신세계', group: 'listed-company', url: 'https://job.shinsegae.com/', tags: ['상장·중견', '유통'] },
  { employer: '이마트', group: 'listed-company', url: 'https://job.shinsegae.com/', tags: ['상장·중견', '유통'] },
  { employer: '현대백화점그룹', group: 'listed-company', url: 'https://recruit.ehyundai.com/', tags: ['상장·중견', '유통'] },
  { employer: 'GS리테일', group: 'listed-company', url: 'https://gsretail.recruiter.co.kr/', tags: ['상장·중견', '유통', '채용대행공식'] },
  { employer: 'BGF리테일', group: 'listed-company', url: 'https://bgf.recruiter.co.kr/', tags: ['상장·중견', '유통', '채용대행공식'] },
  { employer: '농심', group: 'listed-company', url: 'https://recruit.nongshim.com/', tags: ['상장·중견', '식품'] },
  { employer: '오뚜기', group: 'listed-company', url: 'https://www.ottogi.co.kr/recruit/recruitMain', tags: ['상장·중견', '식품'] },
  { employer: '오리온', group: 'listed-company', url: 'https://orion.recruiter.co.kr/', tags: ['상장·중견', '식품', '채용대행공식'] },
  { employer: 'SPC', group: 'listed-company', url: 'https://spc.recruiter.co.kr/', tags: ['상장·중견', '식품', '채용대행공식'] },
  { employer: '삼양그룹', group: 'listed-company', url: 'https://samyang.recruiter.co.kr/', tags: ['상장·중견', '화학·식품', '채용대행공식'] },
  { employer: '아모레퍼시픽', group: 'listed-company', url: 'https://careers.apgroup.com/', tags: ['상장·중견', '소비재', '공식채용'] },
  { employer: '코오롱', group: 'listed-company', url: 'https://kolon.recruiter.co.kr/', tags: ['상장·중견', '화학·패션', '채용대행공식'] },
  { employer: '효성', group: 'listed-company', url: 'https://hyosung.recruiter.co.kr/', tags: ['상장·중견', '소재', '채용대행공식'] },
  { employer: 'DB그룹', group: 'listed-company', url: 'https://dbgroup.recruiter.co.kr/', tags: ['상장·중견', '그룹공채', '채용대행공식'] },
  { employer: '셀트리온', group: 'listed-company', url: 'https://celltrion.recruiter.co.kr/', tags: ['상장·중견', '바이오', '채용대행공식'] },
  { employer: 'GC녹십자', group: 'listed-company', url: 'https://gc.recruiter.co.kr/', tags: ['상장·중견', '바이오', '채용대행공식'] },
  { employer: '종근당', group: 'listed-company', url: 'https://ckd.recruiter.co.kr/', tags: ['상장·중견', '제약', '채용대행공식'] },
  { employer: '유한양행', group: 'listed-company', url: 'https://www.yuhan.co.kr/Recruit', tags: ['상장·중견', '제약'] },
  { employer: '일동제약', group: 'listed-company', url: 'https://ildong.recruiter.co.kr/', tags: ['상장·중견', '제약', '채용대행공식'] },
  { employer: '한미약품', group: 'listed-company', url: 'https://hanmi.recruiter.co.kr/', tags: ['상장·중견', '제약', '채용대행공식'] },
  { employer: '현대오토에버', group: 'listed-company', url: 'https://hyundai-autoever.recruiter.co.kr/', tags: ['상장·중견', 'IT', '채용대행공식'] },
  { employer: '롯데이노베이트', group: 'listed-company', url: 'https://recruit.lotte.co.kr/', tags: ['상장·중견', 'IT', '롯데그룹공식'] },
  { employer: '카카오페이', group: 'listed-company', url: 'https://kakaopay.recruiter.co.kr/', tags: ['상장·중견', '핀테크', '채용대행공식'] },
  { employer: '네이버파이낸셜', group: 'listed-company', url: 'https://recruit.navercorp.com/', tags: ['상장·중견', '핀테크'] },
  { employer: '크래프톤', group: 'listed-company', url: 'https://krafton.com/careers/', tags: ['상장·중견', '게임'] },
  { employer: '엔씨소프트', group: 'listed-company', url: 'https://careers.ncsoft.com/', tags: ['상장·중견', '게임'] },
  { employer: '넷마블', group: 'listed-company', url: 'https://company.netmarble.com/rem/www/careers/recruit.jsp', tags: ['상장·중견', '게임'] },
  { employer: '카카오게임즈', group: 'listed-company', url: 'https://kakaogames.recruiter.co.kr/', tags: ['상장·중견', '게임', '채용대행공식'] },
  { employer: '한글과컴퓨터', group: 'listed-company', url: 'https://www.hancom.com/career', tags: ['상장·중견', 'IT'] },
  { employer: '더존비즈온', group: 'listed-company', url: 'https://douzone.recruiter.co.kr/', tags: ['상장·중견', 'IT', '채용대행공식'] },
  { employer: '한솔그룹', group: 'listed-company', url: 'https://hansol.recruiter.co.kr/', tags: ['상장·중견', '소재', '채용대행공식'] },
  { employer: '세아그룹', group: 'listed-company', url: 'https://seah.recruiter.co.kr/', tags: ['상장·중견', '철강', '채용대행공식'] },
  { employer: '동원그룹', group: 'listed-company', url: 'https://careers.dongwon.com/', tags: ['상장·중견', '식품·물류'] }
];

const SECOND_THIRD_FINANCE_OFFICIAL_WATCHLIST = [
  { employer: 'KB증권', group: 'finance-secondary', url: 'https://kbsec.recruiter.co.kr/', tags: ['증권', '금융권', '채용대행공식'] },
  { employer: '신한투자증권', group: 'finance-secondary', url: 'https://shinhansec.recruiter.co.kr/', tags: ['증권', '금융권', '채용대행공식'] },
  { employer: '미래에셋증권', group: 'finance-secondary', url: 'https://miraeassetsecurities.recruiter.co.kr/', tags: ['증권', '금융권', '채용대행공식'] },
  { employer: '한국투자증권', group: 'finance-secondary', url: 'https://koreainvestment.recruiter.co.kr/', tags: ['증권', '금융권', '채용대행공식'] },
  { employer: '삼성증권', group: 'finance-secondary', url: 'https://www.samsungcareers.com/', tags: ['증권', '금융권', '삼성그룹공식'] },
  { employer: 'NH투자증권', group: 'finance-secondary', url: 'https://nhqv.recruiter.co.kr/', tags: ['증권', '금융권', '채용대행공식'] },
  { employer: '키움증권', group: 'finance-secondary', url: 'https://kiwoom.recruiter.co.kr/', tags: ['증권', '금융권', '채용대행공식'] },
  { employer: 'KB손해보험', group: 'finance-secondary', url: 'https://kbinsure.recruiter.co.kr/', tags: ['보험', '금융권', '채용대행공식'] },
  { employer: 'DB손해보험', group: 'finance-secondary', url: 'https://dbins.recruiter.co.kr/', tags: ['보험', '금융권', '채용대행공식'] },
  { employer: '메리츠화재', group: 'finance-secondary', url: 'https://meritzfire.recruiter.co.kr/', tags: ['보험', '금융권', '채용대행공식'] },
  { employer: '현대해상', group: 'finance-secondary', url: 'https://hi.recruiter.co.kr/', tags: ['보험', '금융권', '채용대행공식'] },
  { employer: '교보생명', group: 'finance-secondary', url: 'https://kyobo.recruiter.co.kr/', tags: ['보험', '금융권', '채용대행공식'] },
  { employer: 'KB국민카드', group: 'finance-secondary', url: 'https://kbcard.recruiter.co.kr/', tags: ['카드', '2금융권', '채용대행공식'] },
  { employer: '신한카드', group: 'finance-secondary', url: 'https://shinhancard.recruiter.co.kr/', tags: ['카드', '2금융권', '채용대행공식'] },
  { employer: '현대카드', group: 'finance-secondary', url: 'https://hyundaicard.recruiter.co.kr/', tags: ['카드', '2금융권', '채용대행공식'] },
  { employer: '롯데카드', group: 'finance-secondary', url: 'https://lottecard.recruiter.co.kr/', tags: ['카드', '2금융권', '채용대행공식'] },
  { employer: '하나카드', group: 'finance-secondary', url: 'https://hanacard.recruiter.co.kr/', tags: ['카드', '2금융권', '채용대행공식'] },
  { employer: '우리카드', group: 'finance-secondary', url: 'https://wooricard.recruiter.co.kr/', tags: ['카드', '2금융권', '채용대행공식'] },
  { employer: 'KB캐피탈', group: 'finance-secondary', url: 'https://kbcapital.recruiter.co.kr/', tags: ['캐피탈', '2금융권', '채용대행공식'] },
  { employer: '현대캐피탈', group: 'finance-secondary', url: 'https://hyundaicapital.recruiter.co.kr/', tags: ['캐피탈', '2금융권', '채용대행공식'] },
  { employer: '하나캐피탈', group: 'finance-secondary', url: 'https://hanacapital.recruiter.co.kr/', tags: ['캐피탈', '2금융권', '채용대행공식'] },
  { employer: '우리금융캐피탈', group: 'finance-secondary', url: 'https://woorifcapital.recruiter.co.kr/', tags: ['캐피탈', '2금융권', '채용대행공식'] },
  { employer: 'OK금융그룹', group: 'finance-secondary', url: 'https://ok.recruiter.co.kr/', tags: ['저축은행', '2금융권', '채용대행공식'] },
  { employer: 'SBI저축은행', group: 'finance-secondary', url: 'https://sbi.recruiter.co.kr/', tags: ['저축은행', '2금융권', '채용대행공식'] }
];

const FINANCE_LARGE_COMPANY_EXPANDED_WATCHLIST = [
  ...FINANCE_LARGE_COMPANY_OFFICIAL_WATCHLIST,
  ...LISTED_MID_COMPANY_OFFICIAL_WATCHLIST,
  ...SECOND_THIRD_FINANCE_OFFICIAL_WATCHLIST
];

const REGIONAL_EDUCATION_OFFICIAL_WATCHLIST = [
  { employer: '인천광역시교육청 직업계고 취업지원센터', group: 'education-office', url: 'https://www.ice.go.kr/jci/main.do', tags: ['교육청', '직업계고', '채용정보'] },
  { employer: '경기도교육청 취창업지원센터', group: 'education-office', url: 'https://more.goe.go.kr/gajago/index.do', tags: ['교육청', '직업계고', '취창업지원'] },
  { employer: '울산광역시교육청 취업지원센터', group: 'education-office', url: 'https://use.go.kr/jobgo/index.do', tags: ['교육청', '직업계고', '채용정보'] },
  { employer: '충청북도교육청 취업지원센터', group: 'education-office', url: 'https://www.cbe.go.kr/job/', tags: ['교육청', '직업계고', '고졸채용'] },
  { employer: '경상북도교육청 취업지원센터', group: 'education-office', url: 'https://www.gbe.kr/cheerup/main.do', tags: ['교육청', '직업계고', '채용정보'] },
  { employer: '세종특별자치시교육청 취업지원센터', group: 'education-office', url: 'https://www.sje.go.kr/job/main.do', tags: ['교육청', '직업계고', '취업지원'] },
  { employer: '제주특별자치도교육청 취업지원센터', group: 'education-office', url: 'https://www.jje.go.kr/job/', tags: ['교육청', '직업계고', '채용정보'] },
  { employer: '경상남도교육청 취업지원센터', group: 'education-office', url: 'https://jinhak.gne.go.kr/hi-job/contents.do?MID=040700', tags: ['교육청', '직업계고', '채용정보'] },
  { employer: '부산광역시교육청 취업지원센터', group: 'education-office', url: 'https://www.pen.go.kr/main/cm/cntnts/cntntsView.do?cntntsId=634&mi=31900', tags: ['교육청', '직업계고', '채용의뢰'] }
];

const BUILT_IN_OFFICIAL_FEEDS = {
  'finance-large-company-recruit': FINANCE_LARGE_COMPANY_EXPANDED_WATCHLIST,
  'regional-education-job': REGIONAL_EDUCATION_OFFICIAL_WATCHLIST
};

const GENERIC_OFFICIAL_SOURCE_CONFIG = {
  'gojobs-narailter': {
    urlSecrets: ['NARAILTER_API_URL'],
    keySecrets: ['NARAILTER_API_KEY'],
    setupHint: '나라일터 공식 API URL 또는 허용된 데이터 피드 URL을 NARAILTER_API_URL에 저장하면 즉시 점검한다.'
  },
  'military-recruit': {
    urlSecrets: ['MILITARY_RECRUIT_API_URL'],
    keySecrets: ['MILITARY_RECRUIT_API_KEY'],
    setupHint: '국방부·각 군 공식 모집/채용 API 또는 공개 피드 URL을 MILITARY_RECRUIT_API_URL에 저장하면 즉시 점검한다.'
  },
  'jobkorea-rookie': {
    urlSecrets: ['JOBKOREA_API_URL'],
    keySecrets: ['JOBKOREA_API_KEY'],
    setupHint: '잡코리아 공식 제휴 API URL과 키가 확보되면 고졸채용 루키 후보를 자동 정규화한다.'
  },
  'incruit-highschool': {
    urlSecrets: ['INCRUIT_API_URL'],
    keySecrets: ['INCRUIT_API_KEY'],
    setupHint: '인크루트 공식 API 또는 허용된 피드 URL을 연결하면 고졸·신입 공채 후보를 자동 정규화한다.'
  },
  'albamon-youth': {
    urlSecrets: ['ALBAMON_API_URL'],
    keySecrets: ['ALBAMON_API_KEY'],
    setupHint: '알바몬 공식 제휴 API URL과 키가 확보되면 청소년·고졸 채용 후보를 간단 안내로 정규화한다.'
  },
  'alba-youth': {
    urlSecrets: ['ALBA_API_URL'],
    keySecrets: ['ALBA_API_KEY'],
    setupHint: '알바천국 공식 제휴 API URL과 키가 확보되면 청소년·고졸 채용 후보를 간단 안내로 정규화한다.'
  },
  'regional-education-job': {
    urlSecrets: ['EDU_JOB_CENTER_FEEDS'],
    keySecrets: [],
    setupHint: '기본 내장 감시 목록으로 주요 시도교육청 취업지원센터를 확인하며, 추가 공식 RSS/API URL은 EDU_JOB_CENTER_FEEDS에 저장해 확장한다.'
  },
  'finance-large-company-recruit': {
    urlSecrets: ['FINANCE_RECRUIT_FEEDS', 'LARGE_COMPANY_RECRUIT_FEEDS'],
    keySecrets: ['FINANCE_RECRUIT_API_KEY', 'LARGE_COMPANY_RECRUIT_API_KEY'],
    setupHint: '기본 내장 감시 목록으로 주요 대기업·금융권 공식 채용 페이지를 확인하며, 추가 공식 공지/RSS/API URL은 FINANCE_RECRUIT_FEEDS 또는 LARGE_COMPANY_RECRUIT_FEEDS에 저장해 확장한다.'
  },
  'nonprofit-recruit': {
    urlSecrets: ['NONPROFIT_RECRUIT_API_URL'],
    keySecrets: ['NONPROFIT_RECRUIT_API_KEY'],
    setupHint: '비영리·공익기관 공식 채용 피드 URL과 키가 확보되면 공개채용 후보를 자동 정규화한다.'
  }
};

const SOURCE_ONBOARDING = {
  'mpm-public-job': {
    priority: 'P0',
    actionLabel: '인사혁신처 공공취업 API 키 등록',
    impact: '나라일터 계열 국가기관·지방자치단체·교육청·공공기관 채용 후보를 확보한다.',
    easySteps: [
      '공공데이터포털에서 발급받은 인증키를 MPM_PUBLIC_JOB_SERVICE_KEY Secret에 저장한다.',
      '같은 공공데이터포털 키를 공통으로 쓰는 경우 DATA_GO_KR_SERVICE_KEY에도 저장할 수 있다.',
      'API 명세 경로가 바뀌면 NARAILTER_API_URL에 공식 URL을 저장해 우선 점검한다.'
    ]
  },
  'moef-public-recruit': {
    priority: 'P0',
    actionLabel: '기재부 공공기관 채용 API 키 등록',
    impact: '공공기관 채용공시 목록·상세를 구조화해 잡알리오 축을 보강한다.',
    easySteps: [
      '공공데이터포털에서 발급받은 인증키를 MOEF_PUBLIC_RECRUIT_SERVICE_KEY Secret에 저장한다.',
      '같은 공공데이터포털 키를 공통으로 쓰는 경우 DATA_GO_KR_SERVICE_KEY에도 저장할 수 있다.',
      '자동 수집 후 회사·기관 또는 채용대행 공식 공고 URL을 2중 확인한다.'
    ]
  },
  'job-alio-openapi': {
    priority: 'P0',
    actionLabel: '이미 자동 수집 중',
    impact: '공공기관 공개채용의 기본 축이다.',
    easySteps: ['현재는 추가 작업 없이 공식 공개 목록과 상세 원문을 점검한다.']
  },
  'work24-open-recruit': {
    priority: 'P0',
    actionLabel: '고용24 인증키 등록',
    impact: '민간·공공 채용 공고 폭을 넓히는 핵심 공식 API다.',
    easySteps: [
      '공공데이터 또는 고용24 OPEN-API 인증키를 확보한다.',
      'GitHub 저장소 Settings > Secrets and variables > Actions로 이동한다.',
      'New repository secret에서 WORK24_AUTH_KEY 또는 WORKNET_AUTH_KEY 이름으로 저장한다.'
    ]
  },
  'saramin-job-search': {
    priority: 'P0',
    actionLabel: '사람인 API 키 등록',
    impact: '대기업·금융권·중견기업 공채속보 후보를 넓히는 핵심 민간 공식 API다.',
    easySteps: [
      '사람인 Open API 접근키를 확보한다.',
      'GitHub Actions Secret에 SARAMIN_ACCESS_KEY 이름으로 저장한다.',
      '다음 자동 실행에서 고졸·특성화고·마이스터고·금융권·대기업 키워드 공채를 점검한다.'
    ]
  },
  'finance-large-company-recruit': {
    priority: 'P0',
    actionLabel: '금융권·대기업 공식 공채 상시 감시',
    impact: '은행·금융공기업·2/3금융권·대기업·상장/중견기업의 고졸 공개채용을 내장 공식 채용 페이지와 추가 공식 피드 기준으로 보강한다.',
    easySteps: [
      '기본 실행만으로 주요 대기업·상장/중견기업·1금융권·2/3금융권 공식 채용 페이지를 매일 3회 감시한다.',
      '추가 확인한 공식 공지/RSS/API URL은 줄바꿈 또는 쉼표로 묶어 FINANCE_RECRUIT_FEEDS 또는 LARGE_COMPANY_RECRUIT_FEEDS Secret에 저장한다.',
      '공채 후보는 공식 원문과 채용대행 원문을 2중 확인한 뒤 전형일정·첨부자료 중심으로 상세화한다.'
    ]
  },
  'seoul-highjob': {
    priority: 'P0',
    actionLabel: '서울 하이잡 공식 채용정보 자동수집',
    impact: '서울 지역 특성화고 학생 대상 대기업·공공기관 공고와 매칭형 채용정보를 공식 교육청 소스로 보강한다.',
    easySteps: [
      '별도 API 키 없이 서울특별시교육청 하이잡 공식 공개 채용정보를 자동 확인한다.',
      '매칭데이·주요행사 게시판까지 공식 구조가 확인되면 같은 방식으로 전용 어댑터를 추가한다.',
      '다른 시도교육청도 공식 채용정보 URL이 확인되는 순서대로 EDU_JOB_CENTER_FEEDS 또는 전용 어댑터로 확장한다.'
    ]
  },
  'gojobs-narailter': {
    priority: 'P1',
    actionLabel: '나라일터 공식 피드 확인',
    impact: '공무직·정부기관 공개채용과 공식 공채 전형을 보강한다.',
    easySteps: [
      '나라일터 공식 API 또는 허용된 데이터 피드 URL을 확인한다.',
      '필요하면 키를 NARAILTER_API_KEY, URL을 NARAILTER_API_URL Secret에 저장한다.',
      'URL이 JSON/XML/RSS이면 범용 공식 피드 어댑터가 먼저 정규화를 시도한다.'
    ]
  },
  'military-recruit': {
    priority: 'P1',
    actionLabel: '군 채용 공식 피드 확인',
    impact: '부사관·군무원·국방 관련 공개채용을 보강한다.',
    easySteps: [
      '각 군 또는 국방부 공식 모집/채용 데이터 경로를 확인한다.',
      '키는 MILITARY_RECRUIT_API_KEY, URL은 MILITARY_RECRUIT_API_URL Secret에 저장한다.',
      '필기·NCS·인적성·전공시험 신호 또는 학생 추천 공식 공채 신호가 있는 채용은 공채 상세 정보로 우선 분류한다.'
    ]
  },
  'regional-education-job': {
    priority: 'P1',
    actionLabel: '교육청 취업지원센터 상시 감시',
    impact: '지역별 특성화고 취업지원센터 소식과 교육청 매칭형 채용정보를 한곳으로 모으는 기반이다.',
    easySteps: [
      '기본 실행만으로 주요 시도교육청 취업지원센터 공식 페이지를 매일 3회 감시한다.',
      '추가 교육청 공식 RSS/API/게시판 URL은 줄바꿈 또는 쉼표로 묶어 EDU_JOB_CENTER_FEEDS Secret에 저장한다.',
      '공식 피드 구조가 확인되는 지역은 전용 어댑터로 정확도를 높인다.'
    ]
  },
  'jobkorea-rookie': {
    priority: 'P2',
    actionLabel: '잡코리아 공식 제휴/API 확인',
    impact: '고졸채용 루키와 중견기업 채용 후보를 보강한다.',
    easySteps: [
      '잡코리아 공식 제휴 또는 허용된 API 경로를 확인한다.',
      '키는 JOBKOREA_API_KEY, URL은 JOBKOREA_API_URL Secret에 저장한다.',
      '면접중심·현장형 채용은 공식 소스 자동요약과 변동 항목 재수집 중심으로 표시한다.'
    ]
  },
  'incruit-highschool': {
    priority: 'P2',
    actionLabel: '인크루트 공식 제휴/API 확인',
    impact: '고졸·신입·중견기업 채용 후보를 보강한다.',
    easySteps: [
      '인크루트 공식 제휴 또는 허용된 API 경로를 확인한다.',
      '키는 INCRUIT_API_KEY, URL은 INCRUIT_API_URL Secret에 저장한다.',
      '공채 성격이 강한 건은 회사 공식 공고 확인 후 상세화한다.'
    ]
  },
  'nonprofit-recruit': {
    priority: 'P2',
    actionLabel: '비영리·공익기관 공식 피드 확인',
    impact: '재단·협회·공익기관 공개채용 후보를 보강한다.',
    easySteps: [
      '비영리기관 공식 채용 피드 또는 API 경로를 확인한다.',
      '키는 NONPROFIT_RECRUIT_API_KEY, URL은 NONPROFIT_RECRUIT_API_URL Secret에 저장한다.',
      '공개채용·정규직·무기계약직·채용형 인턴 등 학생 추천 공채 여부를 원문 중심으로 분류한다.'
    ]
  },
  'albamon-youth': {
    priority: 'P3',
    actionLabel: '알바몬 공식 제휴/API 확인',
    impact: '청소년·고졸 가능 일자리 중 간단 안내 대상을 보강한다.',
    easySteps: [
      '알바몬 공식 제휴/API 경로를 확인한다.',
      '키는 ALBAMON_API_KEY, URL은 ALBAMON_API_URL Secret에 저장한다.',
      '공채 중심 서비스의 보조 정보로만 간단 표시한다.'
    ]
  },
  'alba-youth': {
    priority: 'P3',
    actionLabel: '알바천국 공식 제휴/API 확인',
    impact: '청소년·고졸 가능 시간제 채용 후보를 보조적으로 확인한다.',
    easySteps: [
      '알바천국 공식 제휴/API 경로를 확인한다.',
      '키는 ALBA_API_KEY, URL은 ALBA_API_URL Secret에 저장한다.',
      '공채 중심 서비스와 혼동되지 않게 간단 안내로만 표시한다.'
    ]
  }
};

const SOURCE_PRIORITY_WEIGHT = { P0: 0, P1: 1, P2: 2, P3: 3 };

const SOURCE_CATALOG = [
  {
    id: 'mpm-public-job',
    name: '인사혁신처 공공취업정보',
    type: 'official-api',
    sourceUrl: MPM_PUBLIC_JOB_DATA_URL,
    group: 'government',
    trackHint: 'exam',
    status: 'active',
    secretNames: ['MPM_PUBLIC_JOB_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY', 'NARAILTER_API_KEY'],
    message: '공공데이터포털 인사혁신처 공공취업정보 조회 서비스 확인'
  },
  {
    id: 'moef-public-recruit',
    name: '기재부 공공기관 채용정보',
    type: 'official-api',
    sourceUrl: MOEF_PUBLIC_RECRUIT_DATA_URL,
    group: 'public-institution',
    trackHint: 'exam',
    status: 'active',
    secretNames: ['MOEF_PUBLIC_RECRUIT_SERVICE_KEY', 'DATA_GO_KR_SERVICE_KEY'],
    message: '공공데이터포털 기재부 공공기관 채용정보 조회서비스 확인'
  },
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
    id: 'finance-large-company-recruit',
    name: '금융권·상장기업 고졸 공채 공식 피드',
    type: 'official-watchlist',
    sourceUrl: '',
    group: 'finance-large-company',
    trackHint: 'exam',
    status: 'pending',
    secretNames: ['FINANCE_RECRUIT_FEEDS', 'LARGE_COMPANY_RECRUIT_FEEDS', 'FINANCE_RECRUIT_API_KEY', 'LARGE_COMPANY_RECRUIT_API_KEY'],
    message: '주요 대기업·상장/중견기업·1금융권·2/3금융권 공식 채용 페이지 내장 감시, 추가 피드 Secret 보강 가능'
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
    id: 'seoul-highjob',
    name: '서울특별시교육청 하이잡 채용정보',
    type: 'official-public-web',
    sourceUrl: SEOUL_HIGHJOB_RECRUIT_URL,
    group: 'education-office',
    trackHint: 'balanced',
    status: 'active',
    secretNames: [],
    message: '서울특별시교육청 하이잡 공식 공개 채용정보 목록과 상세 원문 확인'
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
    type: 'official-watchlist',
    sourceUrl: '',
    group: 'education-office',
    trackHint: 'education-office',
    status: 'pending',
    secretNames: ['EDU_JOB_CENTER_FEEDS'],
    message: '주요 시도교육청 취업지원센터 공식 페이지 내장 감시, 추가 피드 Secret 보강 가능'
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

const SOURCE_CATALOG_ORDER = new Map(SOURCE_CATALOG.map((source, index) => [source.id, index]));

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
  '체력시험'
];

const WRITTEN_EXAM_TERMS = [
  '필기',
  '필기시험',
  '필기전형',
  '직무능력검사',
  '직업기초능력평가',
  '직업기초능력검사',
  '직무수행능력평가',
  '직무수행능력검사',
  '인적성',
  '논술',
  '전공시험',
  '전공평가',
  '전공필기',
  '체력검정',
  '체력시험'
];

const DIRECT_TERMS = [
  '면접',
  '수시채용',
  '상시채용',
  '현장실습',
  '산학협력',
  '서류전형',
  '실무면접',
  '입사일 협의',
  '알바',
  '파트타임'
];

const PUBLIC_RECRUIT_SECTORS = new Set([
  'public-institution',
  'government',
  'military',
  'finance',
  'finance-large-company',
  'large-company'
]);
const RECOMMENDED_INTERNSHIP_PATTERN = /(채용형\s*인턴|채용형인턴|채용\s*연계|채용연계|(?:청년\s*인턴|청년인턴|체험형\s*인턴|체험형인턴|인턴(?:행정원|직|사원)?).{0,18}(?:채용|모집|선발)|(?:채용|모집|선발).{0,20}(?:청년\s*인턴|청년인턴|체험형\s*인턴|체험형인턴|인턴(?:행정원|직|사원)?))/;
const CAREER_LADDER_INTERNSHIP_PATTERN = /(채용형\s*인턴|채용형인턴|채용\s*연계|채용연계|전환형\s*인턴|전환\s*형\s*인턴)/;
const CAREER_LADDER_EMPLOYMENT_PATTERN = /(정규직|무기계약직|신입직|신입직원|신규직원|신입사원|신입행원|일반직\s*[B]?\s*신입|4직급|5급|6급|7급|채용형\s*인턴|채용형인턴|채용\s*연계|채용연계|전환형\s*인턴|전환\s*형\s*인턴)/;
const FORMAL_PUBLIC_RECRUIT_PROCESS_PATTERN = /(공채|공개채용|공개\s*채용|공개\s*경쟁|채용\s*공고|모집\s*공고|공고문|블라인드\s*채용|NCS|직업기초능력|직무수행능력|서류전형|필기전형|면접전형|전형절차|원서접수|입사지원)/;
const RECOMMENDED_PUBLIC_ROLE_PATTERN = /(신입직|신입사원|신입행원|일반직|행정직|사무직|전산직|기술직|생산직|업무지원직|지역인재|기능인재|고졸인재|사회형평|공채|공개채용|공개\s*경쟁|블라인드\s*채용)/;
const STUDENT_RECOMMENDED_ROLE_PATTERN = /(신입직|신입사원|신입행원|신규직원|직원\s*공개채용|정규직|무기계약직|일반직|행정직|사무직|전산직|기술직|생산직|업무지원직|교육행정|연구행정|일반행정|전문행정|연구지원|사업관리|회계|총무|정보화|IT|디지털|데이터|기계|전기|전자|토목|건축|안전관리|지역인재|기능인재|고졸인재|사회형평|공채|공개채용|공개\s*경쟁|블라인드\s*채용)/i;
const FIELD_DIRECT_ROLE_PATTERN = /(일용직|일용|단기노무|단기\s*노무|노무원|한시인력|탐방로\s*보수|보수전담|환경관리|수익시설|경비원|경비|보안직|미화|청소|시설관리|시설직|조리원|조리사|운전원|운전직|주차|안내원|감시원|순찰|현장관리|현장지원|계절직)/;
const FIELD_DIRECT_LIMITED_PATTERN = /(기간제근로자|기간제\s*계약직|기간제\s*직원|계약직\s*직원|계약직\s*채용|한시적|대체인력|휴직자\s*대체|육아휴직\s*대체|임시직|촉탁|촉탁직|위촉직|수탁과제|수탁폐수|대학운영직|특정업무직)/;
const FIELD_DIRECT_EMPLOYMENT_PATTERN = /(기간제|비정규직|계약직|단기|한시적|임시직)/;
const LIMITED_PUBLIC_RECRUIT_PATTERN = /(기간제|비정규직|계약직|한시적|대체인력|휴직자\s*대체|육아휴직|임시직|촉탁|위촉|단기|특수직|실무직|국립공원지킴이|소포직|행정지원직\s*\(휴직|휴직\s*대체|공고\s*취소|공고취소|채용\s*취소|채용취소)/;
const CANCELED_RECRUIT_PATTERN = /(공고\s*취소|공고취소|채용\s*취소|채용취소|취소\s*공고)/;
const FIELD_DIRECT_CONTEXT_PATTERN = /(현장|보수|환경|수익시설|경비|보안|시설|미화|청소|조리|운전|노무|대체인력|육아휴직|임시직)/;
const WEAK_EXAM_INFERENCE_PATTERN = /(필기\s*또는\s*공식\s*선발절차\s*가능성\s*높음|필기\/NCS\s*대비\s*일정\s*안내:\s*필기\s*또는\s*공식\s*선발절차\s*가능성\s*높음)/;
const COLLEGE_APPLICANT_PATTERN = /(대학생|대학\s*(?:재학생|휴학생|졸업\s*예정|졸업예정)|대학교\s*(?:재학생|휴학생|졸업\s*예정|졸업예정)|재학생\s*(?:및|·|,|또는)\s*휴학생|휴학생\s*(?:및|·|,|또는)\s*재학생)/;
const COLLEGE_APPLICANT_DISQUALIFIED_PATTERN = /(대학(?:교)?\s*(?:재학생|휴학생|졸업생)|대학생|재학생\s*(?:및|·|,|또는)\s*휴학생|휴학생\s*(?:및|·|,|또는)\s*재학생).{0,40}(지원\s*불가|지원불가|지원\s*제외|제외|불인정)/;
const HIGH_SCHOOL_ELIGIBLE_PATTERN = /(학력\s*[:：]?\s*(?:무관|제한\s*없음)|학력\s*제한\s*없음|고졸\s*이상|고등학교\s*졸업|고졸|특성화고(?:등학교)?|직업계고|마이스터고(?:등학교)?)/;
const DEGREE_ONLY_APPLICANT_PATTERN = /(전문학사|대졸|학사\s*(?:이상|학위|졸업)|석사|박사)/;
const DEGREE_PREFERENCE_PATTERN = /(우대|가점|우대조건|우대사항|우대함).{0,32}(전문학사|대졸|학사|석사|박사)|(전문학사|대졸|학사|석사|박사).{0,32}(우대|가점|우대조건|우대사항|우대함)/;
const MIXED_HIGH_SCHOOL_RECRUIT_PATTERN = /(대졸\s*수준\s*(?:및|·|,|\/|와|과)\s*고졸\s*수준|고졸\s*수준\s*(?:및|·|,|\/|와|과)\s*대졸\s*수준|고졸\s*(?:전형|채용|구분|직군|직렬)|고등학교\s*졸업(?:예정)?자?\s*(?:지원|응시)\s*가능)/;
const MILITARY_SERVICE_COMPLETION_PATTERN = /(남성|남자|지원자|응시자).{0,40}(병역\s*(?:필|필한|필하였|마친|완료)|병역필|군필|전역자|면제자)|(병역\s*(?:필|필한|필하였|마친|완료)|병역필|군필|전역자|면제자).{0,40}(남성|남자|지원자|응시자)|병역필\s*또는\s*면제|병역을\s*마쳤거나\s*면제/;
const MILITARY_NO_LIMIT_PATTERN = /(병역(?:법)?.{0,34}(?:기피|불이행)\s*사실(?:이)?\s*없는\s*자|병역의무를\s*기피한\s*사실이\s*없는\s*자|현역(?:은|의\s*경우)?.{0,36}입사(?:예정)?일.{0,24}(?:전역|제대)\s*가능|고졸(?:자|예정자)?.{0,30}병역.{0,20}제한\s*없음)/;
const STUDENT_UNSUITABLE_RECRUIT_PATTERN = /(급식|취사|조리\s*실무사|조리\s*종사원|조리원|조리사|배식|요양보호(?:사|직)?|병동\s*간호조무|간호조무사|응급구조사|미화|청소|경비원|경비|주차|보안직|환경관리|수익시설)/;
const STUDENT_LOW_VALUE_ROLE_PATTERN = /(미화|청소원|청소\s*근로자|급식\s*종사원|배식|주차\s*(?:관리|안내)|단순\s*노무)/;
const VOCATIONAL_MAJOR_FIT_PATTERN = /((조리|식품|외식|제과|제빵|호텔|관광|보건|간호|복지|보안|경비|시설|전기|기계|환경|안전|위생).{0,36}(전공|학과|계열|기능사|산업기사|자격|우대|관련|실무))|((전공|학과|계열|기능사|산업기사|자격|우대|관련|실무).{0,36}(조리|식품|외식|제과|제빵|호텔|관광|보건|간호|복지|보안|시설|전기|기계|환경|안전|위생))/;
const DIRECT_JOB_QUALITY_PATTERN = /(정규직|무기계약직|공무직|신입|채용형\s*인턴|채용\s*연계|전환형\s*인턴|4대\s*보험|복리후생|기숙사|통근버스|성과급|상여금|교육\s*지원|자격증\s*지원|일학습병행|도제|기업현장교사)/;
const DIRECT_JOB_GROWTH_ROLE_PATTERN = /(생산|품질|물류|설비|정비|기계|전기|전자|전산|IT|디지털|사무|행정|회계|총무|호텔|관광|조리|식품|제과|제빵|디자인|CAD|용접|자동차|반도체)/i;
const ADVANCED_ROLE_WITHOUT_HIGH_SCHOOL_PATTERN = /(연구직군|연구개발|R&D|연구원|박사후|포닥)/i;
const IMPORTANT_PUBLIC_RECRUIT_REVIEW_PATTERN = /(고졸|고등학교|특성화고|직업계고|마이스터고|학력\s*무관|신입직|신입사원|신입행원|정규직|무기계약직|일반직|행정직|사무직|전산직|기술직|생산직|채용형\s*인턴|청년\s*인턴|체험형\s*인턴|NCS|필기|인적성|전공\s*(?:시험|평가|필기)|공채|공개채용|공개\s*경쟁|블라인드\s*채용|지역인재|기능인재|고졸인재)/i;

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
  finance: ['금융권', '은행', '증권', '보험', '카드', '저축은행', '금융공기업', '농협은행', '국민은행', '신한은행', '하나은행', '우리은행', '기업은행'],
  government: ['공무원', '공무직', '임기제', '기간제근로자', '나라일터', '인사혁신처'],
  nonprofit: ['비영리', '공익', '재단', '협회', '사회복지', '법인'],
  'public-institution': ['공공기관', '공기업', '준정부기관', '잡알리오', 'NCS'],
  'large-company': ['대기업', '그룹', '인적성', '채용형 인턴', '고졸공채', '고졸 공채'],
  'mid-sme': ['중견기업', '중소기업', '강소기업', '일학습병행', '도제학교'],
  'part-time': ['알바', '파트타임', '시간제']
};

async function loadLocalEnvFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]]) continue;
      const rawValue = match[2].trim();
      const value = rawValue.replace(/^["']|["']$/g, '');
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function readSecret(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function hasSecret(name) {
  return Boolean(readSecret(name));
}

function secretNamesForSource(source) {
  return Array.from(new Set(source?.secretNames || []));
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 18);
}

function splitSecretList(value) {
  return textValue(value)
    .split(/[\r\n,;]+/)
    .map((entry) => normalizeSpace(entry))
    .filter(Boolean);
}

function parseJobAlioWatchOrg(value) {
  const parts = normalizeSpace(value)
    .split('|')
    .map((part) => normalizeSpace(part))
    .filter(Boolean);
  if (!parts.length) return null;

  let orgCode = '';
  let orgName = '';
  const aliases = [];

  for (const part of parts) {
    if (/^C\d{4}$/i.test(part)) {
      orgCode = part.toUpperCase();
    } else if (!orgName) {
      orgName = part;
    } else {
      aliases.push(part);
    }
  }

  if (!orgName && !orgCode) return null;
  return {
    orgCode,
    orgName: orgName || orgCode,
    aliases,
    configured: true
  };
}

function extraJobAlioWatchOrgs() {
  return Array.from(new Set(JOB_ALIO_EXTRA_WATCH_ORG_SECRET_NAMES
    .flatMap((secretName) => splitSecretList(readSecret(secretName)))))
    .map(parseJobAlioWatchOrg)
    .filter(Boolean);
}

function normalizedJobAlioWatchOrg(org) {
  const orgCode = normalizeSpace(org?.orgCode || '').toUpperCase();
  const orgName = normalizeSpace(org?.orgName || orgCode);
  if (!orgName && !orgCode) return null;
  return {
    ...org,
    orgCode,
    orgName,
    aliases: Array.isArray(org?.aliases)
      ? org.aliases.map((alias) => normalizeSpace(alias)).filter(Boolean)
      : []
  };
}

function allJobAlioWatchOrgs() {
  const merged = [];
  const seen = new Set();

  for (const rawOrg of [...CRITICAL_JOB_ALIO_ORGS, ...PUBLIC_INSTITUTION_CATEGORY_WATCH_ORGS, ...extraJobAlioWatchOrgs()]) {
    const org = normalizedJobAlioWatchOrg(rawOrg);
    if (!org) continue;
    const keys = [
      org.orgCode ? `code:${org.orgCode}` : '',
      org.orgName ? `name:${org.orgName.toLowerCase()}` : ''
    ].filter(Boolean);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    merged.push(org);
  }

  return merged;
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
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
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

function serviceKeyParam(key) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

function buildPublicDataUrl(baseUrl, key, params = {}) {
  const url = buildUrl(baseUrl, params);
  const glue = url.search ? '&' : '?';
  return `${url.toString()}${glue}serviceKey=${serviceKeyParam(key)}`;
}

function sanitizeFetchErrorMessage(value) {
  return normalizeSpace(value)
    .replace(/([?&](?:serviceKey|authKey|apiKey|access-key|accessKey|token|secret)=)[^&\s]+/gi, '$1***')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g, 'Bearer ***')
    .slice(0, 180);
}

function remainingTimeoutMs(startedAt, totalTimeoutMs) {
  return Math.max(0, totalTimeoutMs - (Date.now() - startedAt));
}

function requireRemainingTimeout(startedAt, totalTimeoutMs, label = 'HTTP') {
  const remaining = remainingTimeoutMs(startedAt, totalTimeoutMs);
  if (remaining < MIN_FALLBACK_TIMEOUT_MS) {
    throw new Error(`${label} timeout after ${totalTimeoutMs}ms`);
  }
  return remaining;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const startedAt = Date.now();
  const fetchTimeoutMs = requireRemainingTimeout(startedAt, timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...DEFAULT_FETCH_HEADERS,
        ...(fetchOptions.headers || {})
      }
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`HTTP timeout after ${timeoutMs}ms`);
    }
    try {
      return await fetchWithNodeHttp(url, fetchOptions, requireRemainingTimeout(startedAt, timeoutMs));
    } catch (fallbackError) {
      try {
        return await fetchWithExternalClient(url, fetchOptions, requireRemainingTimeout(startedAt, timeoutMs));
      } catch (externalError) {
        const cause = sanitizeFetchErrorMessage(error.cause?.code || error.message);
        const nodeCause = sanitizeFetchErrorMessage(fallbackError.message);
        throw new Error(`${externalError.message}; node fallback after ${nodeCause}; fetch fallback after ${cause}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithRetries(url, options = {}, retryTimeouts = [REQUEST_TIMEOUT_MS], label = 'HTTP') {
  let lastError = null;
  for (let attempt = 0; attempt < retryTimeouts.length; attempt += 1) {
    try {
      return await fetchWithTimeout(url, {
        ...options,
        timeoutMs: retryTimeouts[attempt]
      });
    } catch (error) {
      lastError = error;
      if (attempt < retryTimeouts.length - 1) {
        await sleep(350 + attempt * 650);
      }
    }
  }
  throw new Error(`${label} failed after ${retryTimeouts.length} attempts: ${sanitizeFetchErrorMessage(lastError?.message || lastError)}`);
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
        ...DEFAULT_FETCH_HEADERS,
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

async function fetchWithExternalClient(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    ...DEFAULT_FETCH_HEADERS,
    ...(options.headers || {})
  };
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const curlArgs = [
    '-L',
    '--silent',
    '--show-error',
    '--max-time',
    String(seconds),
    '-X',
    method
  ];

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      curlArgs.push('-H', `${name}: ${value}`);
    }
  }
  if (options.body) curlArgs.push('--data', String(options.body));
  curlArgs.push(url);

  const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';
  try {
    const { stdout } = await execFileAsync(curlCommand, curlArgs, {
      timeout: timeoutMs + EXTERNAL_CLIENT_GRACE_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    });
    if (stdout) return stdout;
  } catch (error) {
    if (process.platform !== 'win32') {
      throw new Error(`external client failed: ${sanitizeFetchErrorMessage(error.message)}`);
    }
  }

  if (process.platform === 'win32' && method === 'GET' && !options.body) {
    try {
      const command = `$ProgressPreference='SilentlyContinue'; (Invoke-WebRequest -Uri $args[0] -UseBasicParsing -TimeoutSec ${seconds}).Content`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command, url], {
        timeout: timeoutMs + EXTERNAL_CLIENT_GRACE_MS,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      });
      if (stdout) return stdout;
    } catch (error) {
      throw new Error(`external client failed: ${sanitizeFetchErrorMessage(error.message)}`);
    }
  }

  throw new Error('external client failed: empty response');
}

async function fetchBinaryWithTimeout(url, options = {}) {
  const { timeoutMs = ZIP_ATTACHMENT_TIMEOUT_MS, maxBytes = ZIP_ATTACHMENT_MAX_BYTES, ...fetchOptions } = options;
  const startedAt = Date.now();
  const fetchTimeoutMs = requireRemainingTimeout(startedAt, timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        ...DEFAULT_FETCH_HEADERS,
        Accept: 'application/zip,application/octet-stream,*/*;q=0.8',
        ...(fetchOptions.headers || {})
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error(`ZIP too large (${contentLength} bytes)`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`ZIP too large (${buffer.length} bytes)`);
    return buffer;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`ZIP timeout after ${timeoutMs}ms`);
    }
    try {
      return await fetchBinaryWithNodeHttp(url, fetchOptions, requireRemainingTimeout(startedAt, timeoutMs), maxBytes);
    } catch (fallbackError) {
      try {
        return await fetchBinaryWithExternalClient(url, fetchOptions, requireRemainingTimeout(startedAt, timeoutMs), maxBytes);
      } catch (externalError) {
        const cause = sanitizeFetchErrorMessage(error.cause?.code || error.message);
        const nodeCause = sanitizeFetchErrorMessage(fallbackError.message);
        throw new Error(`${externalError.message}; node fallback after ${nodeCause}; fetch fallback after ${cause}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function fetchBinaryWithNodeHttp(url, options = {}, timeoutMs = ZIP_ATTACHMENT_TIMEOUT_MS, maxBytes = ZIP_ATTACHMENT_MAX_BYTES) {
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
        ...DEFAULT_FETCH_HEADERS,
        Accept: 'application/zip,application/octet-stream,*/*;q=0.8',
        ...(options.headers || {})
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, parsed).toString();
        resolve(fetchBinaryWithNodeHttp(nextUrl, options, timeoutMs, maxBytes));
        return;
      }
      const chunks = [];
      let totalBytes = 0;
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          request.destroy(new Error(`ZIP too large (${totalBytes} bytes)`));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });

    request.on('timeout', () => request.destroy(new Error('ZIP timeout')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function fetchBinaryWithExternalClient(url, options = {}, timeoutMs = ZIP_ATTACHMENT_TIMEOUT_MS, maxBytes = ZIP_ATTACHMENT_MAX_BYTES) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    ...DEFAULT_FETCH_HEADERS,
    Accept: 'application/zip,application/octet-stream,*/*;q=0.8',
    ...(options.headers || {})
  };
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const curlArgs = [
    '-L',
    '--silent',
    '--show-error',
    '--max-time',
    String(seconds),
    '-X',
    method
  ];

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      curlArgs.push('-H', `${name}: ${value}`);
    }
  }
  if (options.body) curlArgs.push('--data', String(options.body));
  curlArgs.push(url);

  const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const { stdout } = await execFileAsync(curlCommand, curlArgs, {
    timeout: timeoutMs + EXTERNAL_CLIENT_GRACE_MS,
    maxBuffer: maxBytes + 1,
    windowsHide: true,
    encoding: 'buffer'
  });
  const buffer = Buffer.from(stdout);
  if (buffer.length > maxBytes) throw new Error(`ZIP too large (${buffer.length} bytes)`);
  if (!buffer.length) throw new Error('external client failed: empty response');
  return buffer;
}

async function checkUrlReachable(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const headers = {
    ...DEFAULT_FETCH_HEADERS,
    ...(options.headers || {})
  };
  const startedAt = Date.now();
  const fetchTimeoutMs = requireRemainingTimeout(startedAt, timeoutMs, 'reachability');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers
    });
    if (response.ok) return true;
  } catch {
    // Fall through to external status-only checks.
  } finally {
    clearTimeout(timer);
  }

  const hasReachabilityBudget = () => remainingTimeoutMs(startedAt, timeoutMs) >= MIN_FALLBACK_TIMEOUT_MS;
  const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';
  const discardTarget = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const tryCurlStatus = async (method, followRedirects = true) => {
    const attemptTimeoutMs = requireRemainingTimeout(startedAt, timeoutMs, 'reachability');
    const seconds = Math.max(1, Math.ceil(attemptTimeoutMs / 1000));
    const curlArgs = [
      '--silent',
      '--show-error',
      '--max-time',
      String(seconds),
      '-X',
      method,
      '--output',
      discardTarget,
      '--write-out',
      '%{http_code}'
    ];
    if (followRedirects) {
      curlArgs.unshift('-L');
    }
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        curlArgs.push('-H', `${name}: ${value}`);
      }
    }
    curlArgs.push(url);

    const { stdout } = await execFileAsync(curlCommand, curlArgs, {
      timeout: attemptTimeoutMs + EXTERNAL_CLIENT_GRACE_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    return /^[23]\d\d$/.test(normalizeSpace(stdout));
  };

  try {
    if (await tryCurlStatus('GET', false)) return true;
  } catch {
    // A first-response 2xx/3xx is enough for official watchlist reachability.
  }

  if (!hasReachabilityBudget()) return false;
  try {
    if (await tryCurlStatus('GET')) return true;
  } catch {
    // Some legacy servers reject curl status checks; try HEAD and then PowerShell on Windows.
  }

  if (!hasReachabilityBudget()) return false;
  try {
    if (await tryCurlStatus('HEAD', false)) return true;
  } catch {
    // Try redirected HEAD before the Windows fallback.
  }

  if (!hasReachabilityBudget()) return false;
  try {
    if (await tryCurlStatus('HEAD')) return true;
  } catch {
    // Fall through to PowerShell on Windows.
  }

  if (process.platform === 'win32' && hasReachabilityBudget()) {
    try {
      const attemptTimeoutMs = requireRemainingTimeout(startedAt, timeoutMs, 'reachability');
      const seconds = Math.max(1, Math.ceil(attemptTimeoutMs / 1000));
      const command = `$ProgressPreference='SilentlyContinue'; try { $r=Invoke-WebRequest -Uri $args[0] -UseBasicParsing -TimeoutSec ${seconds} -ErrorAction Stop; [string]$r.StatusCode } catch { if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { [string][int]$_.Exception.Response.StatusCode } else { throw } }`;
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command, url], {
        timeout: attemptTimeoutMs + EXTERNAL_CLIENT_GRACE_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      });
      return /^2\d\d|^3\d\d/.test(normalizeSpace(stdout));
    } catch {
      return false;
    }
  }

  return false;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

function splitSecretUrls(value) {
  const raw = textValue(value);
  if (!raw) return [];
  return Array.from(new Set(raw
    .split(/[\r\n,]+/)
    .map((url) => normalizeSpace(url))
    .filter(Boolean)))
    .slice(0, 40);
}

function configuredUrlsForSource(config) {
  return Array.from(new Set((config.urlSecrets || [])
    .flatMap((secretName) => splitSecretUrls(readSecret(secretName)))))
    .filter(Boolean);
}

function builtInOfficialFeedEntriesForSource(id) {
  return (BUILT_IN_OFFICIAL_FEEDS[id] || []).map((entry) => ({
    ...entry,
    builtIn: true,
    configured: false
  }));
}

function configuredOfficialFeedEntriesForSource(config) {
  return configuredUrlsForSource(config).map((url, index) => ({
    employer: '사용자 설정 공식 피드',
    group: 'configured',
    url,
    tags: ['추가공식피드'],
    builtIn: false,
    configured: true,
    configuredIndex: index + 1
  }));
}

function officialFeedEntriesForSource(id, config) {
  const seen = new Set();
  const entries = [
    ...builtInOfficialFeedEntriesForSource(id),
    ...configuredOfficialFeedEntriesForSource(config)
  ];
  return entries.filter((entry) => {
    const key = normalizeSpace(entry.url).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function injectSecretIntoUrl(url, key) {
  if (!key) return url;
  return url
    .replace(/\{API_KEY\}/g, encodeURIComponent(key))
    .replace(/\{KEY\}/g, encodeURIComponent(key))
    .replace(/\{SERVICE_KEY\}/g, encodeURIComponent(key));
}

function normalizeFieldName(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

function flattenRecord(record, prefix = '', entries = []) {
  if (!record || typeof record !== 'object') return entries;
  for (const [key, value] of Object.entries(record)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenRecord(value, nextKey, entries);
    } else if (!Array.isArray(value)) {
      entries.push([normalizeFieldName(nextKey), textValue(value)]);
    }
  }
  return entries;
}

function pickRecordField(record, aliases) {
  const normalizedAliases = aliases.map(normalizeFieldName);
  const entries = flattenRecord(record);
  for (const alias of normalizedAliases) {
    const exact = entries.find(([key, value]) => key === alias && value);
    if (exact) return exact[1];
  }
  for (const alias of normalizedAliases) {
    const partial = entries.find(([key, value]) => key.endsWith(alias) && value);
    if (partial) return partial[1];
  }
  for (const alias of normalizedAliases) {
    const loose = entries.find(([key, value]) => key.includes(alias) && value);
    if (loose) return loose[1];
  }
  return '';
}

function collectJsonRecords(value, depth = 0) {
  if (!value || depth > 5) return [];
  if (Array.isArray(value)) {
    const objectItems = value.filter((item) => item && typeof item === 'object');
    if (objectItems.length) return objectItems;
    return [];
  }
  if (typeof value !== 'object') return [];

  const preferredKeys = [
    'items',
    'item',
    'body',
    'data',
    'list',
    'result',
    'results',
    'resultList',
    'rows',
    'row',
    'jobs',
    'job',
    'recruits',
    'recruit',
    'content'
  ];
  for (const key of preferredKeys) {
    const records = collectJsonRecords(value[key], depth + 1);
    if (records.length) return records;
  }
  const selfTitle = pickRecordField(value, ['title', '공고명', '채용공고명', 'recruitTitle', 'wantedTitle']);
  if (selfTitle) return [value];
  for (const child of Object.values(value)) {
    const records = collectJsonRecords(child, depth + 1);
    if (records.length) return records;
  }
  return [];
}

function xmlRecordFromNode(node, publicSourceUrl) {
  const sourceId = getXmlText(node, 'idx') || getXmlText(node, 'seq') || getXmlText(node, 'sn') || getXmlText(node, 'id');
  const title = getXmlText(node, 'title')
    || getXmlText(node, 'empWantedTitle')
    || getXmlText(node, 'wantedTitle')
    || getXmlText(node, 'recrutPbancTtl')
    || getXmlText(node, 'pbancTtl')
    || getXmlText(node, 'subject');
  const company = getXmlText(node, 'company')
    || getXmlText(node, 'empBusiNm')
    || getXmlText(node, 'insttname')
    || getXmlText(node, 'instNm')
    || getXmlText(node, 'recrutInstNm')
    || getXmlText(node, 'organization')
    || getXmlText(node, 'author');
  const rawDetailUrl = getXmlText(node, 'link01')
    || getXmlText(node, 'link02')
    || getXmlText(node, 'link03')
    || getXmlText(node, 'link')
    || getXmlText(node, 'url')
    || getXmlText(node, 'detailUrl');
  const detailUrl = cleanUrl(rawDetailUrl)
    || cleanUrl(sourceId ? `https://www.gojobs.go.kr/apmView.do?empmnsn=${encodeURIComponent(sourceId)}` : publicSourceUrl);
  return {
    sourceId,
    title,
    company,
    region: getXmlText(node, 'region') || getXmlText(node, 'workRegion') || getXmlText(node, 'location') || getXmlText(node, 'areacode'),
    education: getXmlText(node, 'education') || getXmlText(node, 'edu') || getXmlText(node, 'empWantedEduNm'),
    career: getXmlText(node, 'career') || getXmlText(node, 'experience') || getXmlText(node, 'careerNm'),
    employmentType: getXmlText(node, 'employmentType') || getXmlText(node, 'jobType') || getXmlText(node, 'hireType') || getXmlText(node, 'type02') || getXmlText(node, 'type01'),
    deadline: getXmlText(node, 'deadline') || getXmlText(node, 'endDate') || getXmlText(node, 'enddate') || getXmlText(node, 'closeDate') || getXmlText(node, 'empWantedEndt'),
    publishedAt: getXmlText(node, 'pubDate') || getXmlText(node, 'regDate') || getXmlText(node, 'regdate') || getXmlText(node, 'regDt') || getXmlText(node, 'startDate') || getXmlText(node, 'moddate'),
    url: detailUrl,
    description: normalizeSpace([
      getXmlText(node, 'description'),
      getXmlText(node, 'summary'),
      getXmlText(node, 'content'),
      getXmlText(node, 'contents'),
      getXmlText(node, 'processText'),
      getXmlText(node, 'type01'),
      getXmlText(node, 'type02')
    ].join(' '))
  };
}

function collectXmlRecords(body, publicSourceUrl) {
  const nodes = [
    ...getXmlNodes(body, 'item'),
    ...getXmlNodes(body, 'entry'),
    ...getXmlNodes(body, 'job'),
    ...getXmlNodes(body, 'wanted'),
    ...getXmlNodes(body, 'recruit'),
    ...getXmlNodes(body, 'row')
  ];
  return nodes.map((node) => xmlRecordFromNode(node, publicSourceUrl)).filter((record) => record.title);
}

function genericRecordToRaw(record, source, publicSourceUrl, feedEntry = {}) {
  const title = pickRecordField(record, [
    'title',
    '공고명',
    '채용공고명',
    '채용공시명',
    'recruitTitle',
    'wantedTitle',
    'empWantedTitle',
    'recrutPbancTtl',
    'recruitPbancTtl',
    'pbancTtl',
    'noticeTitle',
    'nttSj'
  ]);
  const company = pickRecordField(record, [
    'company',
    '회사명',
    '기관명',
    '기업명',
    '공공기관명',
    'instNm',
    'recrutInstNm',
    'publicInstNm',
    'empBusiNm',
    'organization',
    'orgNm',
    'deptNm'
  ]) || feedEntry.employer || source.name;
  const rawDetailUrl = pickRecordField(record, [
    'url',
    'link',
    'detailUrl',
    '상세URL',
    '채용공고URL',
    '채용공시URL',
    '접수URL',
    '지원URL',
    'srcUrl',
    'sourceUrl',
    'homepage',
    'homePage',
    'empWantedHomepgDetail',
    'recruitUrl',
    'applyUrl',
    'nttUrl'
  ]);
  const detailUrl = cleanUrl(rawDetailUrl) || cleanUrl(publicSourceUrl);
  const processText = pickRecordField(record, [
    'processText',
    '전형절차',
    '전형방법',
    '전형단계',
    '채용절차',
    'recruitmentStage',
    'screeningMethod',
    'selectionMethod',
    'scrnprcdr',
    'testMethod'
  ]);
  const recruitField = pickRecordField(record, ['모집분야', '채용직무', '직무', 'jobField', 'ncsCdNm', 'recruitField', 'workField']);
  const recruitNumber = pickRecordField(record, ['모집인원', '채용인원', 'recruitNumber', 'hiringCount', 'recruitCount']);
  const applicationMethod = pickRecordField(record, ['접수방법', '지원방법', '원서접수', 'applicationMethod', 'applyMethod']);
  const contact = pickRecordField(record, ['문의처', '문의', '담당자', '연락처', 'contact', 'contactInfo', 'inquiry']);
  const attachmentUrl = cleanUrl(pickRecordField(record, [
    '첨부파일URL',
    '첨부URL',
    '공고문URL',
    'fileUrl',
    'atchFileUrl',
    'attachmentUrl'
  ]));
  const attachmentTitle = pickRecordField(record, ['첨부파일명', '파일명', 'fileName', 'atchFileNm', 'attachmentTitle']);
  const companyNoticeUrl = cleanUrl(pickRecordField(record, [
    'companyNoticeUrl',
    'officialUrl',
    '공식공고URL',
    '기관공고URL',
    '첨부파일URL',
    'fileUrl',
    'atchFileUrl',
    'srcUrl',
    'sourceUrl',
    'applyUrl',
    'recruitUrl'
  ])) || (feedEntry.builtIn ? cleanUrl(detailUrl) : '');
  return {
    source: source.id,
    sourceName: source.name,
    sourceId: pickRecordField(record, ['id', 'idx', 'seq', 'sn', 'no', '공고번호', '채용공시ID', 'recruitId', 'recrutPbancNo', 'pbancNo']) || sha([source.id, title, company, detailUrl, feedEntry.url].join('|')),
    title,
    company,
    region: pickRecordField(record, ['region', '지역', '근무지', '근무지역', 'location', 'workRegion', 'workPlace', 'workArea']),
    education: pickRecordField(record, ['education', '학력', '학력조건', '응시자격', '지원자격', 'edu', 'eduNm', 'empWantedEduNm', 'qualification']),
    career: pickRecordField(record, ['career', '경력', '경력조건', 'experience', 'careerNm']),
    employmentType: pickRecordField(record, ['employmentType', '고용형태', '채용형태', '채용구분', 'jobType', 'hireType', 'recruitType']),
    deadline: pickRecordField(record, ['deadline', '마감일', '접수마감일', '접수종료일', 'endDate', 'closeDate', 'expirationDate', 'empWantedEndt', 'pbancEndYmd', 'aplyEndYmd', 'receiptEndDate']),
    deadlineText: pickRecordField(record, ['deadlineText', 'closeType', '마감상태', '접수기간']),
    publishedAt: pickRecordField(record, ['publishedAt', 'postingDate', '등록일', '공고일', '게시일', '공시일', 'startDate', 'regDate', 'regDt', 'pbancBgngYmd', 'pbancYmd']),
    recruitField,
    recruitNumber,
    applicationMethod,
    contact,
    url: detailUrl,
    sourceDetailUrl: publicSourceUrl,
    companyNoticeUrl,
    attachments: attachmentUrl ? [{ title: attachmentTitle || '공식 첨부자료', url: attachmentUrl }] : [],
    processText,
    description: normalizeSpace([
      pickRecordField(record, ['description', 'summary', '내용', '상세내용', '직무내용', 'content']),
      processText,
      recruitField,
      recruitNumber,
      applicationMethod,
      source.name,
      feedEntry.tags?.join(' ')
    ].join(' '))
  };
}

function absoluteUrlFromHref(href, baseUrl) {
  const raw = String(href || '').replace(/&amp;/g, '&').trim();
  if (!raw || /^(javascript:|mailto:|tel:|#)/i.test(raw)) return '';
  try {
    return publicDisplayUrl(new URL(raw, baseUrl).toString());
  } catch {
    return '';
  }
}

function extractHtmlRedirectUrl(html, baseUrl) {
  const source = String(html || '');
  const candidates = [
    source.match(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url\s*=\s*([^"'>\s]+)[^"']*["'][^>]*>/i)?.[1],
    source.match(/(?:top\.)?location\.href\s*=\s*["']([^"']+)["']/i)?.[1],
    source.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i)?.[1],
    source.match(/location\.replace\(["']([^"']+)["']\)/i)?.[1]
  ].filter(Boolean);
  for (const candidate of candidates) {
    const url = absoluteUrlFromHref(candidate, baseUrl);
    if (url && url !== publicDisplayUrl(baseUrl)) return url;
  }
  return '';
}

function cleanOfficialCandidateText(value) {
  return normalizeSpace(String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/\b(?:class|style|onclick|target|title|href|src)=["'][^"']*["']/gi, ' ')
    .replace(/\b(?:class|style|onclick|target|title|href|src)=\S+/gi, ' ')
    .replace(/\s*(?:span|div|li|ul|dl|dt|dd|button|strong|em)\s*/gi, ' '));
}

function officialHtmlTitle(html) {
  return htmlText(String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
}

function officialHtmlMetaContent(html) {
  const values = [];
  const pattern = /<meta\b[^>]*\bcontent=["']([^"']{1,2000})["'][^>]*>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    values.push(decodeXml(match[1]));
  }
  return normalizeSpace(values.join(' '));
}

function officialEmbeddedSignalSnippets(text) {
  const normalized = normalizeSpace(text);
  if (!normalized) return [];
  const terms = [
    '고졸',
    '고등학교',
    '고교',
    '특성화고',
    '직업계고',
    '마이스터고',
    '학교장 추천',
    '학교장추천',
    '학력무관',
    '학력 무관',
    '신입행원',
    '사무행원',
    '행원',
    '사무보조',
    '업무지원'
  ];
  const snippets = [];
  const seen = new Set();
  for (const term of terms) {
    const index = normalized.indexOf(term);
    if (index === -1) continue;
    const start = Math.max(0, index - 1200);
    const end = Math.min(normalized.length, index + 2400);
    const snippet = normalized.slice(start, end);
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(snippet);
    if (snippets.length >= 12) break;
  }
  return snippets;
}

function officialHtmlEmbeddedRecruitText(html) {
  const values = [];
  const source = String(html || '');
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(scriptPattern)) {
    const scriptText = decodeXml(match[1])
      .replace(/\\u003c/gi, '<')
      .replace(/\\u003e/gi, '>')
      .replace(/\\u0026/gi, '&')
      .replace(/[{}[\]"',]/g, ' ');
    const snippets = officialEmbeddedSignalSnippets(scriptText);
    if (snippets.length) {
      values.push(...snippets);
    } else if (officialHtmlHasRecruitCandidate(scriptText) || includesAny(scriptText, ['신입행원', '사무행원', '고등학교'])) {
      values.push(scriptText.slice(0, 60000));
    }
  }
  return cleanOfficialCandidateText(values.join(' '));
}

function officialHtmlSearchText(html) {
  return cleanOfficialCandidateText([
    htmlText(html),
    officialHtmlMetaContent(html),
    officialHtmlEmbeddedRecruitText(html)
  ].join(' '));
}

function officialBuiltInPageHasEducationSignal(text) {
  const normalized = normalizeSpace(text);
  if (!normalized) return false;
  if (includesAny(normalized, [
    '고졸',
    '특성화고',
    '직업계고',
    '마이스터고',
    '고졸전형',
    '고졸 전형',
    '고졸채용',
    '고졸 채용',
    '고졸공채',
    '고졸 공채',
    '학교장 추천',
    '학교장추천',
    '사회형평 고졸',
    '기능인재'
  ])) {
    return true;
  }
  if (/고등학교.{0,50}(졸업|재학|예정|소재)|고교.{0,50}(졸업|재학|예정)|졸업.{0,50}고등학교/.test(normalized)) {
    return true;
  }
  return false;
}

function officialBuiltInPageLooksRecruitable(text, sourceUrl = '', feedEntry = {}) {
  const normalized = normalizeSpace(text);
  if (!normalized || isRegionalEducationOfficialFeed(null, feedEntry)) return false;
  const hasRecruit = officialHtmlHasRecruitCandidate(normalized, sourceUrl)
    || (includesAny(normalized, OFFICIAL_HTML_RECRUIT_TERMS) && /recruit|career|careers|job|apply|notice/i.test(String(sourceUrl || '')));
  const hasEducationSignal = officialBuiltInPageHasEducationSignal(normalized);
  const deadline = extractOfficialDeadlineText(normalized);
  const hasConcretePostSignal = Boolean(deadline)
    || includesAny(normalized, [
      '접수기간',
      '원서접수',
      '입사지원',
      '지원서 접수',
      '채용공고',
      '모집공고',
      '지원자격',
      '응시자격',
      '전형일정',
      '신입행원',
      '사무행원',
      '공채',
      '공개채용'
    ]);
  if (!deadline && !includesAny(normalized, [
    '신입행원',
    '사무행원',
    '고졸전형',
    '고졸 전형',
    '고졸채용',
    '고졸 채용',
    '고졸공채',
    '고졸 공채',
    '특성화고',
    '직업계고',
    '마이스터고'
  ])) {
    return false;
  }
  return hasRecruit && hasEducationSignal && hasConcretePostSignal;
}

function currentKstYear() {
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric'
  }).format(NOW);
  return Number(year) || NOW.getUTCFullYear();
}

function canonicalDeadlineTextFromParts(yearValue, monthValue, dayValue, hourValue = '', minuteValue = '') {
  let year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (String(yearValue).length === 2) year += 2000;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return '';
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDay) return '';

  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  if (hourValue === '' || hourValue === null || hourValue === undefined) return `${yyyy}-${mm}-${dd}`;

  const hour = Number(hourValue);
  const minute = minuteValue === '' || minuteValue === null || minuteValue === undefined ? 0 : Number(minuteValue);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return `${yyyy}-${mm}-${dd}`;
  }
  return `${yyyy}-${mm}-${dd} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function canonicalDeadlineTextFromText(value, options = {}) {
  const raw = normalizeSpace(value);
  if (!raw) return '';

  const korean = raw.match(/(?:^|[^0-9])((?:20)?\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?(?:\s*\([^)]+\))?(?:\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})?\s*분?)?/);
  if (korean) return canonicalDeadlineTextFromParts(korean[1], korean[2], korean[3], korean[4], korean[5]);

  const dotted = raw.match(/(?:^|[^0-9])((?:20)?\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\.|(?=[^0-9])|$)(?:\s*\([^)]+\))?(?:\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})?\s*분?)?/);
  if (dotted) return canonicalDeadlineTextFromParts(dotted[1], dotted[2], dotted[3], dotted[4], dotted[5]);

  if (options.inferYear) {
    const noYear = raw.match(/(?:^|[^0-9])(\d{1,2})\s*[.\/]\s*(\d{1,2})(?:\.|(?=[^0-9])|$)(?:\s*\([^)]+\))?(?:\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})?\s*분?)?/);
    if (noYear) return canonicalDeadlineTextFromParts(currentKstYear(), noYear[1], noYear[2], noYear[3], noYear[4]);
  }
  return '';
}

function deadlineTextHasExplicitTime(value) {
  return /\d{1,2}\s*(?::|시)\s*\d{0,2}\s*분?/.test(String(value || ''));
}

function extractOfficialDeadlineText(text) {
  const normalized = normalizeSpace(text);
  if (!normalized) return '';
  const deadlineContexts = [
    ...Array.from(normalized.matchAll(/(?:접수|원서|지원|채용|서류)?\s*(?:기간|마감|종료|접수)\D{0,120}?(?:(?:20)?\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\s*\([^)]+\))?(?:\s*\d{1,2}\s*(?::|시)\s*\d{0,2}\s*분?)?|(?:20)?\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\.|\s|$)(?:\s*\([^)]+\))?(?:\s*\d{1,2}\s*(?::|시)\s*\d{0,2}\s*분?)?)/gi), (match) => match[0]),
    ...Array.from(normalized.matchAll(/(?:(?:20)?\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?(?:\s*\([^)]+\))?(?:\s*\d{1,2}\s*(?::|시)\s*\d{0,2}\s*분?)?|(?:20)?\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?:\.|\s|$)(?:\s*\([^)]+\))?(?:\s*\d{1,2}\s*(?::|시)\s*\d{0,2}\s*분?)?)\D{0,30}(?:까지|마감|종료)/gi), (match) => match[0]),
    ...Array.from(normalized.matchAll(/(?:~|-|부터|까지)\s*\d{1,2}\s*[.\/]\s*\d{1,2}(?:\.|\s|$)(?:\s*\([^)]+\))?(?:\s*\d{1,2}\s*(?::|시)\s*\d{0,2}\s*분?)?/gi), (match) => match[0])
  ];
  for (const context of deadlineContexts) {
    const canonical = canonicalDeadlineTextFromText(context, { inferYear: true });
    if (canonical) return canonical;
  }

  const datePattern = '(?:20)?\\d{2}\\s*[.\\-/년]\\s*\\d{1,2}\\s*[.\\-/월]\\s*\\d{1,2}';
  const ranged = normalized.match(new RegExp(`(?:접수|원서|지원|채용)?\\s*(?:기간|접수)\\D{0,60}(?:${datePattern})\\D{0,20}(?:~|-|부터|까지)\\D{0,20}(${datePattern})`, 'i'));
  if (ranged) return canonicalDeadlineTextFromText(ranged[1]) || ranged[1].replace(/\s+/g, '');
  const deadline = normalized.match(new RegExp(`(?:마감|종료|접수마감|원서마감)\\D{0,40}(${datePattern})`, 'i'));
  if (deadline) return canonicalDeadlineTextFromText(deadline[1]) || deadline[1].replace(/\s+/g, '');
  const dates = Array.from(normalized.matchAll(new RegExp(datePattern, 'g')), (match) => canonicalDeadlineTextFromText(match[0]) || match[0].replace(/\s+/g, ''));
  return dates.length >= 2 ? dates[dates.length - 1] : (dates[0] || '');
}

function compactKoreanText(value) {
  return normalizeSpace(value).replace(/\s+/g, '');
}

function isRegionalEducationOfficialFeed(source, feedEntry = {}) {
  return source?.id === 'regional-education-job' || feedEntry.group === 'education-office';
}

function isRegionalEducationSourceId(sourceId = '') {
  return ['regional-education-job', 'seoul-highjob'].includes(String(sourceId || ''));
}

function isRegionalEducationRaw(raw = {}) {
  const source = catalogSource(raw.source);
  return isRegionalEducationSourceId(raw.source)
    || source?.group === 'education-office'
    || /교육청\s*(취업지원센터|하이잡|직업계고)/.test(String(raw.sourceName || ''));
}

function isRegionalEducationDisplaySuppressed(item = {}) {
  const source = catalogSource(item.source);
  return isRegionalEducationSourceId(item.source)
    || source?.group === 'education-office'
    || /교육청\s*(취업지원센터|하이잡|직업계고)/.test(String(item.sourceName || ''));
}

function regionalEducationConcretePostScore(value = '') {
  const text = normalizeSpace(value);
  let score = 0;
  if (includesAny(text, REGIONAL_EDUCATION_CONCRETE_POST_TERMS)) score += 24;
  if (includesAny(text, REGIONAL_EDUCATION_RECRUIT_LINK_TERMS)) score += 18;
  if (includesAny(text, OFFICIAL_HTML_STRONG_HIGH_SCHOOL_SIGNALS)) score += 16;
  if (/채용공고|모집공고|원서접수|지원자격|응시자격/.test(text)) score += 18;
  if (/접수|마감|지원자격|응시자격|전형|면접|필기|첨부|붙임|직무기술서/.test(text)) score += 14;
  return score;
}

function isRegionalEducationConcreteRecruit(raw = {}) {
  if (!isRegionalEducationRaw(raw)) return false;
  const text = [
    raw.title,
    raw.company,
    raw.education,
    raw.career,
    raw.employmentType,
    raw.recruitField,
    raw.deadline,
    raw.deadlineText,
    raw.description,
    raw.processText,
    raw.sourceName
  ].join(' ');
  return regionalEducationConcretePostScore(text) >= 42;
}

function regionalEducationLinkLooksRecruitable(evidenceText, anchorText, anchorOrHref, href, deadline) {
  const compactAnchor = compactKoreanText(anchorText);
  const compactAnchorOrHref = compactKoreanText(anchorOrHref);
  const lowerHref = String(href || '').toLowerCase();
  const hasRecruitWordInAnchor = includesAny(anchorOrHref, ['채용', '모집', '구인', '공채', '원서', '지원서']);
  const skipInformational = REGIONAL_EDUCATION_SKIP_LINK_TERMS.some((term) => compactAnchorOrHref.includes(compactKoreanText(term)));
  if (skipInformational && !hasRecruitWordInAnchor) return false;

  const boardOnly = REGIONAL_EDUCATION_BOARD_ONLY_TERMS.some((term) => compactAnchor === compactKoreanText(term));
  if (boardOnly && !deadline) return false;

  const hasRecruitTitle = includesAny(anchorOrHref, [...REGIONAL_EDUCATION_RECRUIT_LINK_TERMS, '채용', '모집'])
    || /recruit|hire|apply|jobpost|employment/i.test(lowerHref);
  const hasEligibility = includesAny(evidenceText, OFFICIAL_HTML_STRONG_HIGH_SCHOOL_SIGNALS)
    || includesAny(anchorOrHref, OFFICIAL_HTML_STRONG_HIGH_SCHOOL_SIGNALS);
  const hasConcretePost = Boolean(deadline)
    || includesAny(evidenceText, REGIONAL_EDUCATION_CONCRETE_POST_TERMS)
    || includesAny(anchorOrHref, ['채용공고', '모집공고', '원서접수', '입사지원', '지원서', '공고문']);

  return hasRecruitTitle && hasEligibility && hasConcretePost;
}

function officialHtmlHasRecruitCandidate(text, href = '') {
  const normalized = normalizeSpace(text);
  if (!normalized) return false;
  const lowerHref = String(href || '').toLowerCase();
  const hasRecruitTerm = includesAny(normalized, OFFICIAL_HTML_RECRUIT_TERMS)
    || /recruit|career|careers|job|apply|notice/i.test(lowerHref);
  const hasHighSchoolSignal = includesAny(normalized, OFFICIAL_HTML_HIGH_SCHOOL_SIGNALS);
  if (!hasRecruitTerm || !hasHighSchoolSignal) return false;
  if (OFFICIAL_HTML_SKIP_LINK_TERMS.some((term) => normalized.includes(term)) && normalized.length < 80) return false;
  return true;
}

function htmlLinkRecords(html, source, sourceUrl, publicSourceUrl, feedEntry = {}) {
  const records = [];
  const seen = new Set();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const href = match[1];
    const url = absoluteUrlFromHref(href, sourceUrl);
    if (!url || seen.has(url)) continue;
    const anchorText = cleanOfficialCandidateText(htmlText(match[2]));
    const context = cleanOfficialCandidateText(htmlText(html.slice(Math.max(0, match.index - 700), match.index + match[0].length + 900)));
    const evidenceText = cleanOfficialCandidateText([anchorText, context].join(' '));
    const combined = cleanOfficialCandidateText([evidenceText, feedEntry.employer, feedEntry.tags?.join(' ')].join(' '));
    const anchorOrHref = cleanOfficialCandidateText([anchorText, href].join(' '));
    const hasRecruitAnchor = includesAny(anchorOrHref, OFFICIAL_HTML_RECRUIT_TERMS)
      || /recruit|career|careers|job|hire|apply|notice/i.test(href);
    const hasStrongEligibilitySignal = includesAny(evidenceText, OFFICIAL_HTML_STRONG_HIGH_SCHOOL_SIGNALS);
    const hasAnchorEligibilitySignal = includesAny(anchorOrHref, OFFICIAL_HTML_STRONG_HIGH_SCHOOL_SIGNALS);
    const deadline = extractOfficialDeadlineText(evidenceText);
    if (feedEntry.builtIn) {
      if (isRegionalEducationOfficialFeed(source, feedEntry)) {
        if (!regionalEducationLinkLooksRecruitable(evidenceText, anchorText, anchorOrHref, href, deadline)) continue;
      } else if (!hasRecruitAnchor || !hasStrongEligibilitySignal || (!deadline && !hasAnchorEligibilitySignal)) {
        continue;
      }
    }
    if (!officialHtmlHasRecruitCandidate(evidenceText, href)) continue;
    seen.add(url);

    const fallbackTitle = `${feedEntry.employer || source.name} 고졸·졸업예정 채용 공고 원문 확인`;
    const title = shortText(anchorText && anchorText.length > 3 ? anchorText : fallbackTitle, fallbackTitle, 120);
    records.push({
      source: source.id,
      sourceName: source.name,
      sourceId: sha([source.id, feedEntry.employer, title, url].join('|')),
      title: title.includes(feedEntry.employer || '') ? title : `${feedEntry.employer || source.name} ${title}`,
      company: feedEntry.employer || source.name,
      region: '원문 확인',
      education: includesAny(combined, ['학력무관', '학력 무관']) ? '학력무관' : '고졸·특성화고 관련 원문 확인',
      career: includesAny(combined, ['신입', '인턴', '공채']) ? '신입·공채 원문 확인' : '원문 확인',
      employmentType: keywordSnippet(combined, ['정규직', '계약직', '인턴', '무기계약직', '기간제'], '원문 확인', 80),
      deadline,
      deadlineText: deadline ? `${deadline} 마감` : '마감일 원문 확인',
      publishedAt: extractOfficialDeadlineText(context.match(/(?:게시|등록|공고)\D{0,30}((?:20)?\d{2}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2})/)?.[1] || ''),
      recruitField: keywordSnippet(combined, ['고졸', '특성화고', '직업계고', '마이스터고', '행원', '기술직', '생산직', '기능직'], '채용부문 원문 확인', 100),
      applicationMethod: '회사·기관 또는 채용대행 공식 채용 페이지에서 접수방법 확인',
      url,
      originalUrl: publicSourceUrl,
      sourceDetailUrl: publicSourceUrl,
      companyNoticeUrl: url,
      processText: keywordSnippet(combined, ['필기', 'NCS', '인적성', '서류전형', '면접전형', 'AI역량'], '전형절차 원문 확인', 220),
      description: shortText(combined, '공식 채용 페이지에서 고졸·특성화고 관련 신호가 확인되었습니다.', 720)
    });
  }
  return records.slice(0, 30);
}

function pageLevelHtmlRecord(html, source, sourceUrl, publicSourceUrl, feedEntry = {}, options = {}) {
  if (options.builtInFallback && isRegionalEducationOfficialFeed(source, feedEntry)) return [];
  const pageText = officialHtmlSearchText(html).slice(0, 120000);
  const recruitable = options.builtInFallback
    ? officialBuiltInPageLooksRecruitable(pageText, sourceUrl, feedEntry)
    : officialHtmlHasRecruitCandidate(pageText, sourceUrl);
  if (!recruitable) return [];
  const fallbackTitle = `${feedEntry.employer || source.name} 고졸·졸업예정 채용 공고 원문 확인`;
  const rawTitle = officialHtmlTitle(html);
  const title = shortText(
    rawTitle && officialBuiltInPageHasEducationSignal(rawTitle) ? rawTitle : fallbackTitle,
    fallbackTitle,
    120
  );
  const deadline = extractOfficialDeadlineText(pageText);
  const employmentType = options.builtInFallback
    ? '공식 채용 원문 확인'
    : keywordSnippet(pageText, ['정규직', '계약직', '인턴', '무기계약직', '기간제'], '원문 확인', 80);
  const description = keywordSnippet(
    pageText,
    ['고졸', '고등학교', '특성화고', '직업계고', '마이스터고', '신입행원', '사무행원', '학력무관'],
    '공식 채용 페이지에서 고졸·특성화고 관련 신호가 확인되었습니다.',
    720
  );
  return [{
    source: source.id,
    sourceName: source.name,
    sourceId: sha([source.id, feedEntry.employer, sourceUrl, title].join('|')),
    title: title.includes(feedEntry.employer || '') ? title : `${feedEntry.employer || source.name} ${title}`,
    company: feedEntry.employer || source.name,
    region: '원문 확인',
    education: pageText.includes('학력무관') || pageText.includes('학력 무관') ? '학력무관' : '고졸·특성화고 관련 원문 확인',
    career: pageText.includes('신입') || pageText.includes('공채') ? '신입·공채 원문 확인' : '원문 확인',
    employmentType,
    deadline,
    deadlineText: deadline ? `${deadline} 마감` : '마감일 원문 확인',
    recruitField: keywordSnippet(pageText, ['고졸', '특성화고', '직업계고', '마이스터고', '행원', '기술직', '생산직', '기능직'], '채용부문 원문 확인', 100),
    applicationMethod: '회사·기관 또는 채용대행 공식 채용 페이지에서 접수방법 확인',
    url: publicDisplayUrl(sourceUrl),
    originalUrl: publicSourceUrl,
    sourceDetailUrl: publicSourceUrl,
    companyNoticeUrl: publicDisplayUrl(sourceUrl),
    processText: keywordSnippet(pageText, ['필기', 'NCS', '인적성', '서류전형', '면접전형', 'AI역량'], '전형절차 원문 확인', 220),
    description
  }];
}

function officialRecruitTitleFromText(text, fallbackTitle) {
  const normalized = normalizeSpace(text);
  const patterns = [
    /((?:20\d{2}년\s*)?(?:상반기|하반기|하계|동계|신입|경력|체험형|채용형)[^.!?。]{0,90}(?:모집|채용|공고))/,
    /(20\d{2}년[^.!?。]{0,100}(?:모집|채용|공고))/
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return shortText(match[1], fallbackTitle, 120);
  }
  return fallbackTitle;
}

function officialRecruitTitleFromHtml(html, fallbackTitle) {
  const decoded = decodeXml(String(html || ''))
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&');
  const candidates = [];
  for (const match of decoded.matchAll(/<(?:strong|h1|h2|h3)\b[^>]*>([\s\S]{1,240}?(?:모집|채용|공고)[\s\S]{0,80}?)<\/(?:strong|h1|h2|h3)>/gi)) {
    candidates.push(cleanOfficialCandidateText(htmlText(match[1])));
  }
  const title = candidates
    .map((candidate) => shortText(candidate, '', 140))
    .find((candidate) => /(?:20\d{2}년|상반기|하반기|하계|동계|신입|인턴|채용|모집|공고)/.test(candidate));
  return title || officialRecruitTitleFromText(decoded, fallbackTitle);
}

function embeddedJobLabelNear(html, index) {
  const context = html.slice(Math.max(0, index - 700), index + 220);
  const matches = Array.from(context.matchAll(/"key"\s*:\s*"(?:first|second)_button_text"[\s\S]{0,120}?"value"\s*:\s*"([^"]{1,80})"/g));
  const label = matches.length ? matches[matches.length - 1][1] : '';
  return normalizeSpace(decodeXml(label));
}

function embeddedOfficialJobPathRecords(html, source, sourceUrl, publicSourceUrl, feedEntry = {}, options = {}) {
  if (!options.builtInFallback || isRegionalEducationOfficialFeed(source, feedEntry)) return [];
  const pageText = officialHtmlSearchText(html).slice(0, 120000);
  if (!officialBuiltInPageLooksRecruitable(pageText, sourceUrl, feedEntry)) return [];

  const paths = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/"value"\s*:\s*"(\/jobs\/RC[A-Za-z0-9_-]+)"/g)) {
    const path = match[1];
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push({ path, label: embeddedJobLabelNear(html, match.index || 0) });
  }
  if (!paths.length) return [];

  const fallbackTitle = `${feedEntry.employer || source.name} 고졸·졸업예정 채용 공고 원문 확인`;
  const recruitTitle = officialRecruitTitleFromHtml(html, fallbackTitle);
  const deadline = extractOfficialDeadlineText(pageText);
  const pageDescription = keywordSnippet(
    pageText,
    ['고졸', '고등학교', '특성화고', '직업계고', '마이스터고', '신입행원', '사무행원', '학력무관', '인턴십'],
    '공식 채용 페이지에서 고졸·특성화고 관련 신호가 확인되었습니다.',
    720
  );
  const embeddedEmploymentType = /체험형\s*인턴|체험형\s*인턴십/.test(pageText)
    ? '체험형 인턴'
    : (/채용형\s*인턴/.test(pageText) ? '채용형 인턴' : '공식 채용 원문 확인');

  return paths.slice(0, 12).map(({ path, label }) => {
    const url = absoluteUrlFromHref(path, sourceUrl);
    const titleParts = [recruitTitle, label].filter(Boolean);
    const title = titleParts.join(' ');
    const combined = normalizeSpace([pageText, label, feedEntry.tags?.join(' ')].join(' '));
    return {
      source: source.id,
      sourceName: source.name,
      sourceId: sha([source.id, feedEntry.employer, path, title].join('|')),
      title: title.includes(feedEntry.employer || '') ? title : `${feedEntry.employer || source.name} ${title}`,
      company: feedEntry.employer || source.name,
      region: '원문 확인',
      education: includesAny(combined, ['학력무관', '학력 무관']) ? '학력무관' : '고졸·특성화고 관련 원문 확인',
      career: includesAny(combined, ['신입', '인턴', '공채']) ? '신입·공채 원문 확인' : '원문 확인',
      employmentType: embeddedEmploymentType,
      deadline,
      deadlineText: deadline ? `${deadline} 마감` : '마감일 원문 확인',
      recruitField: label || keywordSnippet(combined, ['고졸', '특성화고', '직업계고', '마이스터고', '행원', '기술직', '생산직', '기능직'], '채용부문 원문 확인', 100),
      applicationMethod: '회사·기관 또는 채용대행 공식 채용 페이지에서 접수방법 확인',
      url,
      originalUrl: publicSourceUrl,
      sourceDetailUrl: publicSourceUrl,
      companyNoticeUrl: url,
      processText: keywordSnippet(combined, ['필기', 'NCS', '인적성', '서류전형', '면접전형', 'AI역량'], '전형절차 원문 확인', 220),
      description: pageDescription
    };
  });
}

function parseGenericOfficialFeed(body, source, sourceUrl, feedEntry = {}) {
  const trimmed = body.trim();
  const publicSourceUrl = source.sourceUrl || safePublicFeedUrl(sourceUrl);
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const payload = JSON.parse(trimmed);
    return collectJsonRecords(payload).map((record) => genericRecordToRaw(record, source, publicSourceUrl, feedEntry));
  }
  if (trimmed.startsWith('<')) {
    const xmlRecords = collectXmlRecords(trimmed, publicSourceUrl).map((record) => ({
      ...record,
      source: source.id,
      sourceName: source.name,
      sourceId: sha([source.id, record.title, record.company || feedEntry.employer, record.url].join('|')),
      company: record.company || feedEntry.employer || source.name,
      sourceDetailUrl: publicSourceUrl,
      companyNoticeUrl: feedEntry.builtIn ? cleanUrl(record.url) : '',
      description: normalizeSpace([record.description, feedEntry.tags?.join(' ')].join(' '))
    }));
    const htmlRecords = htmlLinkRecords(trimmed, source, sourceUrl, publicSourceUrl, feedEntry);
    const embeddedRecords = embeddedOfficialJobPathRecords(trimmed, source, sourceUrl, publicSourceUrl, feedEntry, {
      builtInFallback: Boolean(feedEntry.builtIn)
    });
    const pageRecords = pageLevelHtmlRecord(trimmed, source, sourceUrl, publicSourceUrl, feedEntry, {
      builtInFallback: Boolean(feedEntry.builtIn)
    });
    if (xmlRecords.length || htmlRecords.length || embeddedRecords.length) {
      return [...xmlRecords, ...htmlRecords, ...embeddedRecords, ...(embeddedRecords.length ? [] : pageRecords)];
    }
    return pageRecords;
  }
  return [];
}

function recruiterJobflexPrefixFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.endsWith('.recruiter.co.kr') ? hostname : '';
  } catch {
    return '';
  }
}

function recruiterJobflexPublicUrl(prefix, positionSn) {
  return `https://${prefix}/career/jobs/${encodeURIComponent(String(positionSn || ''))}`;
}

function recruiterJobflexHeaders(prefix) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    prefix,
    Origin: `https://${prefix}`,
    Referer: `https://${prefix}/career/home`
  };
}

function recruiterJobflexTagText(record = {}) {
  return (Array.isArray(record.tagList) ? record.tagList : [])
    .map((tag) => tag?.tagName)
    .filter(Boolean)
    .join(' ');
}

function recruiterJobflexText(record = {}, detail = {}) {
  return cleanOfficialCandidateText([
    record.title,
    detail.title,
    record.classificationCode,
    detail.classificationCode,
    recruiterJobflexTagText(record),
    recruiterJobflexTagText(detail),
    htmlText(detail.jobDescription || '')
  ].join(' '));
}

function recruiterJobflexIsCurrent(record = {}, detail = {}) {
  const submissionStatus = String(detail.submissionStatus || record.submissionStatus || '');
  const progressStatus = String(detail.progressStatus || record.progressStatus || '');
  const dday = Number(detail.dday ?? record.dday);
  return submissionStatus === 'IN_SUBMISSION'
    || progressStatus === 'IN_PROGRESS'
    || (!Number.isNaN(dday) && dday >= 0);
}

function recruiterJobflexHasEducationOpenSignal(text) {
  return /학력\s*,?\s*연령에\s*제한\s*없음/.test(text)
    || /학력\s*[,·ㆍ]\s*성별\s*[,·ㆍ]\s*전공\s*등\s*제한\s*없음/.test(text)
    || /학력\s*[,·ㆍ]\s*전공\s*등\s*제한\s*없음/.test(text)
    || /학력(?:에)?\s*(?:관계없이|무관|제한\s*없음)/.test(text)
    || /학력\s*무관/.test(text);
}

function recruiterJobflexLooksRelevant(record = {}, detail = {}) {
  if (!recruiterJobflexIsCurrent(record, detail)) return false;
  const text = recruiterJobflexText(record, detail);
  if (!text) return false;

  const hasEducationSignal = officialBuiltInPageHasEducationSignal(text);
  const hasEducationOpen = recruiterJobflexHasEducationOpenSignal(text);
  const hasEntrySignal = includesAny(text, [
    '신규채용',
    '경력무관',
    '사무행원',
    '행원',
    '업무지원',
    '사무보조',
    '지원직원',
    '창구',
    '텔러',
    '피크타이머',
    '인턴',
    '청년인턴',
    '계약인력',
    '생산직',
    '기술직',
    '기능직',
    '공무직'
  ]);
  const hasRecruitSignal = includesAny(text, OFFICIAL_HTML_RECRUIT_TERMS);
  const trainingOnly = /교육생|교육과정|K-디지털트레이닝/.test(text)
    && !/채용\s*연계|학력|고졸|고등학교|특성화고|마이스터고|직업계고/.test(text);
  if (trainingOnly) return false;

  const careerType = String(detail.careerType || record.careerType || '');
  const careerOnly = careerType === 'CAREER'
    && !/(경력무관|신입|신규|계약인력|업무지원|사무보조|지원직원|사무행원|창구|텔러|피크타이머|학력\s*(무관|제한\s*없음))/.test(text);
  if (careerOnly && !hasEducationSignal && !hasEducationOpen) return false;

  return hasRecruitSignal && (hasEducationSignal || hasEducationOpen || hasEntrySignal);
}

function recruiterJobflexEducationLabel(text) {
  if (/학력\s*[,·ㆍ]\s*성별\s*[,·ㆍ]\s*전공\s*등\s*제한\s*없음/.test(text)) {
    return '학력·성별·전공 제한 없음';
  }
  if (/학력\s*[,·ㆍ]\s*전공\s*등\s*제한\s*없음/.test(text)) {
    return '학력·전공 제한 없음';
  }
  if (officialBuiltInPageHasEducationSignal(text)) return '고졸·특성화고 관련 원문 확인';
  if (recruiterJobflexHasEducationOpenSignal(text)) return '학력무관';
  return '원문 확인';
}

function recruiterJobflexKnownOfficialDetails(record = {}, detail = {}) {
  const positionSn = String(detail.positionSn || record.positionSn || '');
  const title = normalizeSpace(detail.title || record.title);
  if (positionSn === '119655' || /건설\s*문서\s*관리\s*사무보조.*판교/.test(title)) {
    return {
      education: '학력: 고졸 이상(전공무관) · 우대: 플랜트/엔지니어링/건설 문서 관리 유경험자',
      region: '경기 성남시 분당구 판교',
      employmentType: '계약직',
      recruitField: '사무행정 · 사무보조 · 건설 문서 관리',
      applicationMethod: '현대제철 채용 홈페이지 온라인 이력서 작성',
      contact: 'HR운영1팀 윤희진 매니저(HEEJIN@hyundai-steel.com / 031-510-2337)',
      processText: '서류전형 → AI역량검사 → 면접전형/신체검사 → 최종합격',
      description: '모집부문: 사무행정 · 직무분야: 사무보조 · 수행업무: 플랜트 건설 문서 관리, 건설문서관리시스템 운영, 건설사/벤더사 문서 관련 대응 · 자격요건: 학력 고졸 이상(전공무관), 우대사항 플랜트/엔지니어링/건설 문서 관리 유경험자 · 근무지: 판교'
    };
  }
  if (positionSn === '118849' || /사무보조\s*계약직.*당진/.test(title)) {
    return {
      education: '학력: 고졸 이상(전공무관) · 우대: 관련 직무 유경험자',
      region: '충남 당진시 현대제철 당진제철소',
      employmentType: '계약직',
      recruitField: '사무행정 · 사무보조',
      applicationMethod: '현대제철 채용 홈페이지 온라인 이력서 작성',
      contact: 'HR운영1팀 윤희진 매니저(HEEJIN@hyundai-steel.com / 031-510-2337)',
      processText: '서류전형 → AI역량검사 → 면접전형/신체검사 → 최종합격',
      description: '모집부문: 사무행정 · 직무분야: 사무보조 · 수행업무: 전표 처리, 예산 관리, 임가공 비용 마감, 공정 보류재 관리, 기타 사무지원 · 자격요건: 학력 고졸 이상(전공무관), 우대사항 관련 직무 유경험자 · 근무지: 당진'
    };
  }
  if (positionSn === '119082' || /자금세탁방지부\s*사무행원/.test(title)) {
    return {
      education: '학력·성별·전공 제한 없음 · MS 오피스 사용 가능 · 해외여행 및 건강상 결격사유 없음 · 은행 내규상 결격사유 없음',
      region: 'BNK경남은행 본점',
      employmentType: '계약직(사무행원)',
      recruitField: '사무행원(자금세탁방지부)',
      recruitNumber: '0명',
      applicationMethod: 'BNK경남은행 채용 홈페이지 온라인 접수',
      contact: '경남은행 인사부 차장 김우진(055-290-8231)',
      processText: '서류접수 → 서류전형 → 면접(채용검진) → 합격자 통지 → 채용',
      description: '채용분야: 사무행원(자금세탁방지부) · 주요업무: 자금세탁방지업무(고객확인), 서무업무, 은행이 지정하는 업무 · 지원자격: 학력·성별·전공 제한 없음, MS 오피스 사용 가능, 해외여행 및 건강상 결격사유 없음, 은행 내규상 결격사유 없음 · 우대: 금융권 근무경력 1년 이상, 금융관련 자격증 소지자, 장애인 및 취업보호 대상자'
    };
  }
  if (positionSn === '119895' || /당진제철소\s*기술직\(계약\)/.test(title)) {
    return {
      education: '지원자격: 제조업 사업장 근무 적격자 · 해외여행 결격사유 없음(남성은 병역필 또는 면제) · 지정 입사일 입사 가능',
      region: '충남 당진시 현대제철 당진제철소',
      employmentType: '계약직(상주/교대)',
      recruitField: '금속/제철 · 기계정비 · 전기정비 · 생산지원 · 기중기',
      recruitNumber: '00명',
      deadlineText: '상시(채용 시 마감)',
      applicationMethod: '현대제철 채용 홈페이지 지원서 작성 · 별도 지원자 추가정보 작성 필요',
      contact: '041-680-1348, 1330',
      processText: '서류전형 → 인성/신체검사 → 인성·실무면접 → 입사',
      description: '모집부문: 금속/제철, 기계정비, 전기정비, 생산지원, 기중기 · 근무형태: 상주/교대 · 인원: 00명 · 근무지: 당진제철소 · 지원자격: 제조업 사업장 근무 적격자, 해외여행 결격사유 없음, 지정 입사일 입사 가능 · 우대: 관련 자격증 소지자, 동종업계 경력, 관련 학과 계열 전공자'
    };
  }
  return null;
}

function recruiterJobflexQualificationLabel(record = {}, detail = {}, text = '') {
  const known = recruiterJobflexKnownOfficialDetails(record, detail);
  if (known?.education) return known.education;
  if (/학력\s*[,·ㆍ]\s*성별\s*[,·ㆍ]\s*전공\s*등\s*제한\s*없음/.test(text)) {
    return '학력·성별·전공 제한 없음 · MS 오피스 사용 가능 · 해외여행 및 건강상 결격사유 없음 · 은행 내규상 결격사유 없음';
  }
  if (/학력\s*[,·ㆍ]\s*전공\s*등\s*제한\s*없음/.test(text)) {
    return '학력·전공 제한 없음';
  }
  return recruiterJobflexEducationLabel(text);
}

function recruiterJobflexCareerLabel(record = {}, detail = {}) {
  const text = recruiterJobflexText(record, detail);
  if (/경력\s*무관/.test(text)) return '경력무관';
  const careerType = String(detail.careerType || record.careerType || '');
  if (careerType === 'NEW') return '신입';
  if (careerType === 'NEW_CAREER') return '신입·경력';
  if (careerType === 'CAREER') return '경력';
  if (careerType === 'FIELD_DIFFERENCE') return '직무별 상이';
  return includesAny(text, ['신입', '공채']) ? '신입·공채 원문 확인' : '원문 확인';
}

function recruiterJobflexEmploymentType(record = {}, detail = {}) {
  const recruitmentType = String(detail.recruitmentType || record.recruitmentType || '');
  if (recruitmentType === 'PERMANENT') return '상시채용';
  if (recruitmentType === 'GENERAL') return '공식 채용';
  if (recruitmentType === 'RECOMMEND') return '추천채용';
  return keywordSnippet(recruiterJobflexText(record, detail), ['정규직', '계약직', '인턴', '기간제', '상시채용'], '원문 확인', 80);
}

function recruiterJobflexDeadline(record = {}, detail = {}) {
  const value = String(detail.endDateTime || record.endDateTime || '');
  return value ? value.slice(0, 10) : '';
}

function recruiterJobflexAttachments(detail = {}) {
  return (Array.isArray(detail.attachFileDtoList) ? detail.attachFileDtoList : [])
    .map((file) => ({
      title: file.originalFileName || file.fileName || file.name || '공식 첨부자료',
      url: file.downloadUrl || file.fileDownloadUrl || file.fileUrl || file.url || ''
    }))
    .filter((file) => file.url);
}

function recruiterJobflexRecordToRaw(record, detail, source, sourceUrl, feedEntry, prefix) {
  const text = recruiterJobflexText(record, detail);
  const knownDetails = recruiterJobflexKnownOfficialDetails(record, detail);
  const positionSn = detail.positionSn || record.positionSn;
  const publicUrl = recruiterJobflexPublicUrl(prefix, positionSn);
  const deadline = recruiterJobflexDeadline(record, detail);
  const tags = compactTags([
    recruiterJobflexTagText(record),
    recruiterJobflexTagText(detail),
    record.classificationCode,
    detail.classificationCode
  ]);
  return {
    source: source.id,
    sourceName: source.name,
    sourceId: sha([source.id, prefix, positionSn, record.title || detail.title].join('|')),
    title: shortText(detail.title || record.title, `${feedEntry.employer || source.name} 공식 채용 공고`, 140),
    company: feedEntry.employer || source.name,
    region: knownDetails?.region || keywordSnippet(text, ['근무지', '지역', '전국', '서울', '부산', '경남', '대구'], '원문 확인', 80),
    education: recruiterJobflexQualificationLabel(record, detail, text),
    career: recruiterJobflexCareerLabel(record, detail),
    employmentType: knownDetails?.employmentType || recruiterJobflexEmploymentType(record, detail),
    deadline,
    deadlineText: knownDetails?.deadlineText || (deadline ? `${deadline} 마감` : '상시채용 또는 마감일 원문 확인'),
    publishedAt: String(detail.startDateTime || record.startDateTime || '').slice(0, 10),
    recruitField: knownDetails?.recruitField || keywordSnippet(text, ['고졸', '특성화고', '직업계고', '마이스터고', '행원', '사무행원', '창구', '텔러', '업무지원', '생산직', '기술직', '기능직'], tags.join(' · ') || '채용부문 원문 확인', 120),
    recruitNumber: knownDetails?.recruitNumber || '',
    applicationMethod: knownDetails?.applicationMethod || (detail.applyUrl ? '채용대행 공식 페이지 온라인 접수' : '채용대행 공식 페이지에서 접수방법 확인'),
    contact: knownDetails?.contact || '',
    url: publicUrl,
    originalUrl: sourceUrl,
    sourceDetailUrl: sourceUrl,
    companyNoticeUrl: publicUrl,
    processText: knownDetails?.processText || keywordSnippet(text, ['서류', '필기', 'NCS', '인적성', '면접', '전형', '합격자'], '전형절차 원문 확인', 260),
    description: shortText(knownDetails?.description || text, '채용대행 공식 페이지에서 지원 가능 신호가 확인되었습니다.', 780),
    attachments: recruiterJobflexAttachments(detail)
  };
}

async function fetchRecruiterJobflexRecords(source, sourceUrl, feedEntry = {}) {
  const prefix = recruiterJobflexPrefixFromUrl(sourceUrl);
  if (!prefix) return { checked: false, records: [] };
  const listBody = await fetchWithTimeout(RECRUITER_JOBFLEX_LIST_URL, {
    method: 'POST',
    timeoutMs: OFFICIAL_WATCH_TIMEOUT_MS,
    headers: recruiterJobflexHeaders(prefix),
    body: JSON.stringify({
      pageableRq: { page: 1, size: RECRUITER_JOBFLEX_PAGE_SIZE },
      filter: { resumeLanguageTypeList: ['KOR'] }
    })
  });
  const payload = JSON.parse(listBody);
  const list = Array.isArray(payload.list) ? payload.list : [];
  const currentList = list
    .filter((record) => recruiterJobflexIsCurrent(record))
    .slice(0, RECRUITER_JOBFLEX_PAGE_SIZE);
  const detailResults = await mapWithConcurrency(currentList, RECRUITER_JOBFLEX_DETAIL_CONCURRENCY, async (record) => {
    if (!record?.positionSn) return { record, detail: {} };
    try {
      const detailBody = await fetchWithTimeout(`${RECRUITER_JOBFLEX_DETAIL_BASE_URL}/${encodeURIComponent(String(record.positionSn))}`, {
        timeoutMs: OFFICIAL_WATCH_TIMEOUT_MS,
        headers: recruiterJobflexHeaders(prefix)
      });
      return { record, detail: JSON.parse(detailBody) };
    } catch {
      return { record, detail: {} };
    }
  });
  const records = detailResults
    .filter(({ record, detail }) => recruiterJobflexLooksRelevant(record, detail))
    .map(({ record, detail }) => recruiterJobflexRecordToRaw(record, detail, source, sourceUrl, feedEntry, prefix));
  return {
    checked: true,
    totalCount: Number(payload.pagination?.totalCount || list.length || 0),
    currentCount: currentList.length,
    records
  };
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
    const html = await fetchWithTimeout(companyNoticeUrl, { timeoutMs: COMPANY_NOTICE_TIMEOUT_MS });
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

function noticeSearchTerms(title, company = '') {
  return Array.from(new Set([
    ...significantTerms(title, 10),
    ...significantTerms(company, 3)
  ].filter((term) => term.length >= 3)));
}

function matchNoticeTermCount(text, terms) {
  const normalized = normalizeSpace(text);
  return terms.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
}

function noticeRequiredTerms(title) {
  const text = normalizeSpace(title);
  const terms = [];
  if (text.includes('일반전형')) terms.push('일반전형');
  if (text.includes('보훈전형')) terms.push('보훈전형');
  for (const match of text.matchAll(/[([]([^)\]]+)[)\]]/g)) {
    for (const term of significantTerms(match[1], 4)) {
      if (term.endsWith('원') || term.includes('직')) terms.push(term);
    }
  }
  return Array.from(new Set(terms));
}

function noticeRequiredTermsMatched(text, title) {
  const normalized = normalizeSpace(text);
  return noticeRequiredTerms(title).every((term) => {
    if (term === '보훈전형') return normalized.includes('보훈전형') || normalized.includes('취업지원대상자');
    return normalized.includes(term);
  });
}

function noticeAnchorMatches(anchorText, terms, title) {
  return matchNoticeTermCount(anchorText, terms) >= Math.min(3, terms.length)
    && noticeRequiredTermsMatched(anchorText, title);
}

function kohomNoticeSearchTerm(title, company = '') {
  const text = normalizeSpace([title, company].join(' '));
  return text.match(/[가-힣]+지사/)?.[0] || significantTerms(title, 1)[0] || significantTerms(company, 1)[0] || '';
}

function knownOfficialNoticeSearchUrls(company, title = '') {
  const haystack = normalizeSpace([company, title].join(' '));
  const urls = [];
  if (haystack.includes('한국도로공사')) {
    urls.push('https://www.ex.co.kr/portal/biz/bbs/layout1/selectBoardList.do?bbsId=BBSMSTR_000000000182');
  }
  if (haystack.includes('주택관리공단')) {
    const searchTerm = kohomNoticeSearchTerm(title, company);
    urls.push(buildUrl('https://www.kohom.or.kr/web/mainComm/HM005008005.do', {
      mode: 'list',
      page: 1,
      schCon: 0,
      schStr: searchTerm
    }).toString());
  }
  return urls.map(publicDisplayUrl).filter(Boolean);
}

function isHomepageUrl(value) {
  try {
    const url = new URL(value);
    return (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function boardDetailUrlFromId(baseUrl, id) {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname;
    const path = url.pathname;
    if (/ex\.co\.kr$/i.test(host) && /selectBoard(?:List|Article)\.do$/i.test(path)) {
      const bbsId = url.searchParams.get('bbsId') || 'BBSMSTR_000000000182';
      url.pathname = path.replace(/selectBoardList\.do$/i, 'selectBoardArticle.do');
      url.search = '';
      url.searchParams.set('bbsId', bbsId);
      url.searchParams.set('nttId', id);
      return publicDisplayUrl(url.toString());
    }
    if (/kohom\.or\.kr$/i.test(host) && /HM005008005\.do$/i.test(path)) {
      const schCon = url.searchParams.get('schCon') || '0';
      const schStr = url.searchParams.get('schStr') || '';
      const page = url.searchParams.get('page') || '1';
      url.search = '';
      url.searchParams.set('mode', 'view');
      url.searchParams.set('schCon', schCon);
      url.searchParams.set('schStr', schStr);
      url.searchParams.set('page', page);
      url.searchParams.set('rnm_idx', id);
      return publicDisplayUrl(url.toString());
    }
    if (/bbsPage\.do$/i.test(path)) {
      url.pathname = path.replace(/bbsPage\.do$/i, 'bbsView.do');
      url.search = '';
      url.searchParams.set('bbsCnId', id);
      url.searchParams.set('bbsCode', 'deptgongji');
      url.searchParams.set('menuId', 'MENU0895');
      url.searchParams.set('pageIndex', '1');
      return publicDisplayUrl(url.toString());
    }
    return publicDisplayUrl(url.toString());
  } catch {
    return '';
  }
}

function officialNoticeSearchUrls(candidateUrl, title, company = '') {
  const urls = [];
  const knownUrls = knownOfficialNoticeSearchUrls(company, title);
  if (candidateUrl && !(knownUrls.length && isHomepageUrl(candidateUrl))) urls.push(candidateUrl);
  urls.push(...knownUrls);
  if (candidateUrl && knownUrls.length && isHomepageUrl(candidateUrl)) urls.push(candidateUrl);
  try {
    const url = new URL(candidateUrl);
    if (/kead\.or\.kr$/i.test(url.hostname) && /bbsPage\.do$/i.test(url.pathname)) {
      const searchUrl = new URL(candidateUrl);
      searchUrl.searchParams.set('bbsCode', searchUrl.searchParams.get('bbsCode') || 'deptgongji');
      searchUrl.searchParams.set('menuId', searchUrl.searchParams.get('menuId') || 'MENU0895');
      searchUrl.searchParams.set('pageIndex', '1');
      searchUrl.searchParams.set('searchCondition', 'sjcn');
      searchUrl.searchParams.set('searchKeyword', title);
      urls.unshift(publicDisplayUrl(searchUrl.toString()));
    }
  } catch {
    // Keep the original URL only.
  }
  return Array.from(new Set(urls.filter(Boolean)));
}

function findOfficialNoticeDetailUrl(html, baseUrl, title, company = '') {
  const terms = noticeSearchTerms(title, company);
  if (!terms.length) return '';
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    const href = match[1].replace(/&amp;/g, '&');
    const anchorText = htmlText(match[2]);
    if (!noticeAnchorMatches(anchorText, terms, title)) continue;
    const directUrl = absoluteUrlFromHref(href, baseUrl);
    if (directUrl) return directUrl;
    const id = [href, tag].join(' ').match(/(?:fn_egov_inqire_notice|fn_goView|nttId|rnm_idx)[^0-9]{0,30}(\d{2,})/i)?.[1]
      || href.match(/(\d{5,})/)?.[1];
    if (id) return boardDetailUrlFromId(baseUrl, id);
  }

  const strongestTerm = terms.find((term) => term.length >= 5) || terms[0];
  const index = html.indexOf(strongestTerm);
  if (index === -1) return '';
  const context = html.slice(Math.max(0, index - 1200), index + 1600);
  if (!noticeRequiredTermsMatched(context, title)) return '';
  const id = context.match(/(?:bbsCnId|bbs_cn_id|cnId)[^0-9]{0,30}(\d{5,})/i)?.[1]
    || context.match(/(?:nttId|rnm_idx|bbsView|bbsPage|fn[A-Za-z0-9_]*|goView|view)[^0-9]{0,80}(\d{2,})/i)?.[1];
  return id ? boardDetailUrlFromId(baseUrl, id) : '';
}

async function resolveOfficialNoticeUrl(candidateUrl, title, company = '') {
  const cleanCandidateUrl = cleanUrl(candidateUrl);
  const searchUrls = officialNoticeSearchUrls(cleanCandidateUrl, title, company);
  if (!searchUrls.length) return '';
  for (const searchUrl of searchUrls) {
    try {
      const html = await fetchWithTimeout(searchUrl, { timeoutMs: COMPANY_NOTICE_TIMEOUT_MS });
      const detailUrl = findOfficialNoticeDetailUrl(html, searchUrl, title, company);
      if (detailUrl) return detailUrl;
      const text = htmlText(html).slice(0, 70000);
      const terms = noticeSearchTerms(title, company);
      const titleMatched = matchNoticeTermCount(text, terms) >= Math.min(3, terms.length);
      const processMatched = includesAny(text, COMPANY_NOTICE_TERMS);
      if (titleMatched && processMatched) return searchUrl;
    } catch {
      // Try the next official search URL before giving up.
    }
  }
  return cleanCandidateUrl;
}

async function enrichCompanyNoticeChecks(rawItems, limit = 40) {
  const candidates = rawItems
    .filter((item) => item.companyNoticeUrl && !item.companyNoticeCheck)
    .slice(0, limit);
  await mapWithConcurrency(candidates, DETAIL_FETCH_CONCURRENCY, async (item) => {
    item.companyNoticeCheck = await checkCompanyNoticeUrl(item.companyNoticeUrl, item.company, item.title);
    return item;
  });
}

function kstDateFromParts(yearValue, monthValue, dayValue, hourValue = '', minuteValue = '', secondValue = '') {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDay) return null;
  const hasTime = hourValue !== '' && hourValue !== null && hourValue !== undefined;
  const hour = hasTime ? Number(hourValue) : 23;
  const minute = hasTime
    ? (minuteValue === '' || minuteValue === null || minuteValue === undefined ? 0 : Number(minuteValue))
    : 59;
  const second = hasTime
    ? (secondValue === '' || secondValue === null || secondValue === undefined ? 0 : Number(secondValue))
    : 59;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mi = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`);
}

function dateFromCanonicalDeadlineText(value) {
  const raw = normalizeSpace(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  return kstDateFromParts(match[1], match[2], match[3], match[4], match[5]);
}

function structuredDateFromText(value) {
  const raw = normalizeSpace(value);
  if (!raw) return null;

  const canonical = canonicalDeadlineTextFromText(raw);
  if (canonical) return dateFromCanonicalDeadlineText(canonical);

  const compact = raw.match(/(?:^|[^0-9])(\d{4})(\d{2})(\d{2})(?=[^0-9]|$)/);
  if (compact) return kstDateFromParts(compact[1], compact[2], compact[3]);

  const dotted = raw.match(/(?:^|[^0-9])(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?=[^0-9]|$)/);
  if (dotted) return kstDateFromParts(dotted[1], dotted[2], dotted[3]);

  const shortDotted = raw.match(/(?:^|[^0-9])(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?=[^0-9]|$)/);
  if (shortDotted) return kstDateFromParts(Number(shortDotted[1]) + 2000, shortDotted[2], shortDotted[3]);

  return null;
}

function containsStructuredDatePattern(value) {
  const raw = normalizeSpace(value);
  return /(?:^|[^0-9])(?:\d{4}\d{2}\d{2}|\d{2,4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})(?=[^0-9]|$)/.test(raw)
    || /(?:^|[^0-9])(?:20)?\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?/.test(raw);
}

function parseDate(value) {
  const raw = normalizeSpace(value);
  if (!raw) return null;

  const canonical = canonicalDeadlineTextFromText(raw);
  if (canonical) return dateFromCanonicalDeadlineText(canonical);

  if (/^\d{4}-\d{2}-\d{2}T/i.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw);
    const ms = raw.length === 13 ? timestamp : timestamp * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return kstDateFromParts(compact[1], compact[2], compact[3]);

  const isoLikeTime = raw.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\.|\s|$)(?:\s*(\d{1,2})\s*(?::|시)\s*(\d{1,2})?)?/);
  if (isoLikeTime?.[4]) return kstDateFromParts(isoLikeTime[1], isoLikeTime[2], isoLikeTime[3], isoLikeTime[4], isoLikeTime[5]);

  const dotted = raw.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (dotted) {
    return kstDateFromParts(dotted[1], dotted[2], dotted[3]);
  }

  const shortDotted = raw.match(/^(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (shortDotted) {
    return kstDateFromParts(Number(shortDotted[1]) + 2000, shortDotted[2], shortDotted[3]);
  }

  if (containsStructuredDatePattern(raw)) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return parts.hour && parts.minute ? `${parts.hour}:${parts.minute}` : '';
}

function safeDeadlineDisplayText(value, fallback = '마감일 원문 확인') {
  const text = normalizeSpace(value);
  const fallbackText = normalizeSpace(fallback) || '마감일 원문 확인';
  if (!text) return fallbackText;
  const structuredDate = structuredDateFromText(text);
  if (structuredDate) {
    const timeText = deadlineTextHasExplicitTime(text) ? ` ${formatTime(structuredDate)}` : '';
    return `${formatDate(structuredDate)}${timeText}${/원서\s*마감/.test(text) ? ' 원서 마감' : ' 마감'}`;
  }
  if (containsStructuredDatePattern(text)) return fallbackText;
  return text;
}

function daysUntil(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
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
  const startText = formatDate(startDate);
  const endText = formatDate(endDate);
  if (!startText || !endText) return null;
  const start = new Date(`${startText}T00:00:00+09:00`);
  const end = new Date(`${endText}T00:00:00+09:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

function cleanUrl(value) {
  const raw = normalizeSpace(value);
  if (!raw) return '';
  const candidate = (raw.match(/https?:\/\/[^\s<>"']+/i)?.[0] || raw).replace(/[),.;，]+$/g, '');
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function safePublicFeedUrl(value) {
  const raw = normalizeSpace(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
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

function verifiedEducationSignal(value) {
  const text = normalizeSpace(value);
  return /(원문\s*확인|확인\s*필요|관련\s*원문)/.test(text) ? '' : text;
}

function hasWrittenExamSignal(value) {
  const text = normalizeSpace(value);
  const examText = normalizeSpace(text.replace(WEAK_EXAM_INFERENCE_PATTERN, ' '));
  if (/필기시험은\s*현재.{0,40}확인되지|필기시험\s*신호가\s*없어|필기시험\s*미확인|필기\/NCS\s*시험\s*신호가\s*없어|필기\s*미탐지/.test(examText)) return false;
  if (includesAny(examText, WRITTEN_EXAM_TERMS)) return true;
  return [
    /NCS\s*(직업기초능력|직무수행능력|직무능력)?\s*(평가|검사|시험|필기)/i,
    /(필기|시험|평가|검사)\s*[^.。]{0,20}NCS/i,
    /(공무원|군무원|부사관)\s*[^.。]{0,24}(필기|시험|평가|검사)/i
  ].some((pattern) => pattern.test(examText));
}

function hasExplicitHighSchoolRecruitSignal(value) {
  const text = normalizeSpace(value);
  return /(특성화고(?:등학교)?|직업계고|마이스터고(?:등학교)?|학교장\s*추천|학교장추천)/.test(text)
    || /고졸\s*(제한|전형|채용|구분|인재|사회형평|공채|졸업\s*예정|졸업예정)/.test(text)
    || /고등학교\s*(?:졸업|졸업예정|졸업\s*예정).{0,24}(?:제한|전형|채용|공채|추천)/.test(text);
}

function hasRecommendedInternshipSignal(value) {
  return RECOMMENDED_INTERNSHIP_PATTERN.test(normalizeSpace(value));
}

function hasCareerLadderInternshipSignal(value) {
  return CAREER_LADDER_INTERNSHIP_PATTERN.test(normalizeSpace(value));
}

function careerLadderEmploymentText(value) {
  return normalizeSpace(value)
    .replace(/정규직\s*전환\s*(?:없음|불가|제외|미실시)/g, ' ')
    .replace(/비정규직/g, ' ');
}

function hasCareerLadderEmploymentSignal(value) {
  return CAREER_LADDER_EMPLOYMENT_PATTERN.test(careerLadderEmploymentText(value));
}

function hasLimitedTemporaryRecruitSignal(value) {
  const text = normalizeSpace(value)
    .replace(/무기계약직/g, ' ')
    .replace(/채용형\s*인턴|채용형인턴|채용\s*연계|채용연계|전환형\s*인턴|전환\s*형\s*인턴/g, ' ');
  return LIMITED_PUBLIC_RECRUIT_PATTERN.test(text);
}

function hasCanceledRecruitSignal(value) {
  return CANCELED_RECRUIT_PATTERN.test(normalizeSpace(value));
}

function hasStudentUnsuitableProfessionalRole(value) {
  const text = normalizeSpace(value);
  if (!text) return false;
  return STUDENT_UNSUITABLE_HEALTHCARE_ROLE_PATTERN.test(text)
    || (/자격증\s*소지자|면허(?:증)?\s*소지자|면허\s*소지|전문자격|전문\s*자격/.test(text)
      && /(의료|병원|병동|요양|간호|보건|치과|진료|치료|재활|환자)/.test(text));
}

function hasCollegeOnlyApplicantSignal(value) {
  const text = normalizeSpace(value);
  if (COLLEGE_APPLICANT_PATTERN.test(text) && !COLLEGE_APPLICANT_DISQUALIFIED_PATTERN.test(text)) return true;
  if (!DEGREE_ONLY_APPLICANT_PATTERN.test(text) || DEGREE_PREFERENCE_PATTERN.test(text)) return false;
  return !MIXED_HIGH_SCHOOL_RECRUIT_PATTERN.test(text);
}

function hasVerifiedStudentEligibilitySignal(value) {
  const text = normalizeSpace(value);
  return HIGH_SCHOOL_ELIGIBLE_PATTERN.test(text) || hasExplicitHighSchoolRecruitSignal(text);
}

function hasStudentRecommendationFitException(value) {
  const text = normalizeSpace(value);
  if (!text || !STUDENT_UNSUITABLE_RECRUIT_PATTERN.test(text)) return false;
  if (STUDENT_LOW_VALUE_ROLE_PATTERN.test(text)) return false;
  if (hasCollegeOnlyApplicantSignal(text) || hasStudentUnsuitableProfessionalRole(text)) return false;
  const hasMajorFit = VOCATIONAL_MAJOR_FIT_PATTERN.test(text);
  const hasStudentAccess = hasVerifiedStudentEligibilitySignal(text);
  const hasCareerPath = hasCareerLadderEmploymentSignal(text)
    || hasCareerLadderInternshipSignal(text)
    || hasRecommendedInternshipSignal(text);
  const hasFormalProcess = FORMAL_PUBLIC_RECRUIT_PROCESS_PATTERN.test(text);
  return hasMajorFit && hasStudentAccess && hasCareerPath && hasFormalProcess;
}

function hasStudentUnsuitableRecruitSignal(value) {
  const text = normalizeSpace(value);
  return STUDENT_UNSUITABLE_RECRUIT_PATTERN.test(text) && !hasStudentRecommendationFitException(text);
}

function hasMilitaryServiceCompletionRequirement(value) {
  const text = normalizeSpace(value).replace(MILITARY_NO_LIMIT_PATTERN, ' ');
  return MILITARY_SERVICE_COMPLETION_PATTERN.test(text);
}

function buildStudentChannelAssessment(raw, process) {
  const text = normalizeSpace([
    raw.title,
    raw.company,
    raw.region,
    raw.education,
    raw.career,
    raw.employmentType,
    raw.recruitField,
    raw.description,
    raw.processText,
    raw.sourceName
  ].filter(Boolean).join(' '));
  const verifiedText = text.replace(/고졸·특성화고\s*관련\s*원문\s*확인/g, ' ');
  const roleText = normalizeSpace([raw.title, raw.recruitField, raw.jobField, raw.workField, raw.position].filter(Boolean).join(' '));
  const highSchoolEligible = hasVerifiedStudentEligibilitySignal(verifiedText);
  const collegeOnly = hasCollegeOnlyApplicantSignal(text);
  const professionalOnly = hasStudentUnsuitableProfessionalRole(text);
  const recommendationMismatch = hasStudentUnsuitableRecruitSignal(text);
  const militaryCompletionRequired = hasMilitaryServiceCompletionRequirement(text);
  const advancedRoleMismatch = ADVANCED_ROLE_WITHOUT_HIGH_SCHOOL_PATTERN.test(roleText)
    && !/(고졸|고등학교|특성화고|직업계고|마이스터고)/.test(roleText)
    && !/(고졸|고등학교|특성화고|직업계고|마이스터고).{0,40}(연구직군|연구개발|R&D|연구원)|(연구직군|연구개발|R&D|연구원).{0,40}(고졸|고등학교|특성화고|직업계고|마이스터고)/i.test(verifiedText);
  const careerLadder = hasCareerLadderEmploymentSignal(text) || hasCareerLadderInternshipSignal(text);
  const majorFit = VOCATIONAL_MAJOR_FIT_PATTERN.test(text);
  const directQuality = DIRECT_JOB_QUALITY_PATTERN.test(text)
    || (DIRECT_JOB_GROWTH_ROLE_PATTERN.test(text) && (careerLadder || majorFit));
  const hardBlocked = hasCanceledRecruitSignal(text)
    || collegeOnly
    || professionalOnly
    || recommendationMismatch
    || !highSchoolEligible
    || advancedRoleMismatch
    || (process.processTrack === 'direct-interview' && militaryCompletionRequired);
  const reasons = [];
  if (highSchoolEligible) reasons.push('고졸·학력무관 지원신호 확인');
  if (careerLadder) reasons.push('고용안정·경력사다리 신호');
  if (majorFit) reasons.push('직업계고 전공연계 신호');
  if (directQuality) reasons.push('일반취업 품질신호');
  if (militaryCompletionRequired) reasons.push('병역필·면제 요구');
  if (collegeOnly) reasons.push('대학생·학위 전용');
  if (professionalOnly) reasons.push('전문면허·전문자격 중심');
  if (recommendationMismatch) reasons.push('학생 추천 적합성 재검토');
  if (advancedRoleMismatch) reasons.push('연구·고학력 직무의 고졸 전형 불명확');

  return {
    version: 1,
    highSchoolEligible,
    militaryUnservedEligible: highSchoolEligible && !militaryCompletionRequired,
    militaryCompletionRequired,
    collegeOnly,
    professionalOnly,
    advancedRoleMismatch,
    careerLadder,
    majorFit,
    directQuality,
    hardBlocked,
    recommendedChannel: hardBlocked ? 'blocked' : process.processTrack,
    reasons
  };
}

function isFormalPublicRecruitSource(sector, source, value = '') {
  const text = normalizeSpace(value);
  return source?.trackHint === 'exam'
    || PUBLIC_RECRUIT_SECTORS.has(sector)
    || /(잡알리오|공공기관|공기업|준정부기관|기타공공기관|금융권|금융공기업|은행|대기업|상장기업)/.test(text);
}

function hasFormalPublicStudentRecruitSignal(value, sector = '', source = null) {
  const text = normalizeSpace(value);
  if (!isFormalPublicRecruitSource(sector, source, text)) return false;
  if (hasCanceledRecruitSignal(text)) return false;
  if (!hasVerifiedStudentEligibilitySignal(text)) return false;
  if (hasCollegeOnlyApplicantSignal(text)) return false;
  if (hasStudentUnsuitableRecruitSignal(text)) return false;
  if (hasStudentUnsuitableProfessionalRole(text)) return false;
  if (hasHardFieldDirectRecruitSignal(text)) return false;
  const hasCareerLadder = hasCareerLadderEmploymentSignal(text) || hasCareerLadderInternshipSignal(text);
  const hasStudentRole = STUDENT_RECOMMENDED_ROLE_PATTERN.test(text) || RECOMMENDED_PUBLIC_ROLE_PATTERN.test(text);
  const hasFormalProcess = FORMAL_PUBLIC_RECRUIT_PROCESS_PATTERN.test(text);
  const limitedTemporary = hasLimitedTemporaryRecruitSignal(text);
  if (limitedTemporary && !hasExplicitHighSchoolRecruitSignal(text) && !hasCareerLadderInternshipSignal(text) && !hasCareerLadderEmploymentSignal(text)) return false;
  if (!hasCareerLadder || !hasStudentRole || !hasFormalProcess) return false;
  const softLimitedOnly = hasSoftFieldDirectRecruitSignal(text) && !/(정규직|무기계약직|채용형\s*인턴|채용형인턴|채용\s*연계|채용연계|전환형\s*인턴)/.test(text);
  return !softLimitedOnly;
}

function hasHardFieldDirectRecruitSignal(value) {
  const text = normalizeSpace(value);
  return FIELD_DIRECT_ROLE_PATTERN.test(text);
}

function hasSoftFieldDirectRecruitSignal(value) {
  const text = normalizeSpace(value);
  return FIELD_DIRECT_LIMITED_PATTERN.test(text)
    || FIELD_DIRECT_EMPLOYMENT_PATTERN.test(text);
}

function hasProtectedPublicRecruitSignal(value, hasExam = false, sector = '', source = null) {
  const text = normalizeSpace(value);
  if (hasCanceledRecruitSignal(text)) return false;
  if (hasCollegeOnlyApplicantSignal(text) || hasStudentUnsuitableRecruitSignal(text)) return false;
  if (hasStudentUnsuitableProfessionalRole(text) && !hasExam) return false;
  if (!hasVerifiedStudentEligibilitySignal(text)) return false;
  return hasRecommendedInternshipSignal(text)
    || hasFormalPublicStudentRecruitSignal(text, sector, source)
    || (hasExam && !hasHardFieldDirectRecruitSignal(text) && !hasSoftFieldDirectRecruitSignal(text))
    || (hasWrittenExamSignal(text) && !hasHardFieldDirectRecruitSignal(text) && !hasSoftFieldDirectRecruitSignal(text))
    || (hasExplicitHighSchoolRecruitSignal(text) && (
      STUDENT_RECOMMENDED_ROLE_PATTERN.test(text) || RECOMMENDED_PUBLIC_ROLE_PATTERN.test(text)
    ))
    || (RECOMMENDED_PUBLIC_ROLE_PATTERN.test(text) && (
      (hasExam && !hasHardFieldDirectRecruitSignal(text) && !hasSoftFieldDirectRecruitSignal(text))
      || hasExplicitHighSchoolRecruitSignal(text)
    ));
}

function hasRecommendedPublicRecruitSignal(value, hasExam = false, sector = '', source = null) {
  return hasProtectedPublicRecruitSignal(value, hasExam, sector, source);
}

function hasFieldDirectRecruitSignal(value) {
  const text = normalizeSpace(value);
  return hasHardFieldDirectRecruitSignal(text) || hasSoftFieldDirectRecruitSignal(text);
}

function shouldForceFieldDirectRecruit(raw, sector, text, hasExam = false) {
  const source = catalogSource(raw.source);
  const formalSource = source?.trackHint === 'exam' || PUBLIC_RECRUIT_SECTORS.has(sector);
  const normalized = normalizeSpace(text);
  if (!formalSource || !hasFieldDirectRecruitSignal(normalized)) return false;
  if (hasRecommendedInternshipSignal(normalized)) return false;
  if (hasHardFieldDirectRecruitSignal(normalized)) return true;
  if (!hasExam
    && criticalCurrentPriority(raw) >= 99
    && hasLimitedTemporaryRecruitSignal(normalized)
    && !hasExplicitHighSchoolRecruitSignal(normalized)
    && !hasCareerLadderInternshipSignal(normalized)) return true;
  return !hasProtectedPublicRecruitSignal(normalized, hasExam, sector, source);
}

function withApplicationClosedSuffix(title) {
  const normalized = normalizeSpace(title);
  if (!normalized) return normalized;
  return normalized.endsWith('(원서 마감)') ? normalized : `${normalized}(원서 마감)`;
}

function sectorLabel(sector) {
  return {
    military: '군 채용',
    finance: '금융권',
    'finance-large-company': '금융권·대기업',
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
  return track === 'exam-formal' ? '공채 상세 정보' : '면접중심·현장형 채용';
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
    verifiedEducationSignal(raw.education),
    raw.career,
    raw.employmentType,
    raw.description,
    raw.processText,
    raw.sourceName
  ].join(' ');
  const hasExam = hasWrittenExamSignal(haystack);
  const hasDirect = includesAny(haystack, DIRECT_TERMS);
  const sector = classifySector(raw, haystack);
  const criticalProtectedRecruit = criticalCurrentPriority(raw) < 99;
  const isRegionalEducationRecruit = isRegionalEducationConcreteRecruit(raw);
  const privateLargeUnverified = ['finance-large-company', 'large-company', 'private-platform'].includes(sector)
    && !hasVerifiedStudentEligibilitySignal(haystack);
  const studentRecommendBlocked = hasCollegeOnlyApplicantSignal(haystack)
    || hasStudentUnsuitableRecruitSignal(haystack)
    || hasCanceledRecruitSignal(haystack)
    || privateLargeUnverified;
  const limitedTemporaryDirect = !hasExam
    && criticalCurrentPriority(raw) >= 99
    && hasLimitedTemporaryRecruitSignal(haystack)
    && !hasExplicitHighSchoolRecruitSignal(haystack)
    && !hasCareerLadderInternshipSignal(haystack);
  const forceFieldDirect = shouldForceFieldDirectRecruit(raw, sector, haystack, hasExam);
  const unsuitableProfessionalRole = hasStudentUnsuitableProfessionalRole(haystack);
  const formalPublicStudentRecruit = hasFormalPublicStudentRecruitSignal(haystack, sector, source);
  const recommendedPublicRecruit = hasRecommendedPublicRecruitSignal(haystack, hasExam, sector, source);
  const labels = [sectorLabel(sector)];

  let processTrack = 'direct-interview';
  let writtenExam = 'unknown';
  let confidence = 'review';
  let note = '공식 소스에서 추출한 전형 키워드 기준으로 자동 분류했습니다.';

  if (studentRecommendBlocked) {
    processTrack = 'direct-interview';
    writtenExam = hasExam ? 'likely' : 'not_found';
    confidence = 'high';
    labels.push('학생추천 제외');
    note = '대학생·휴학생 전용이거나 전공 적합성·경력 사다리·공식 전형 신호가 부족해 특성화고 학생 추천 공채에서는 제외했습니다.';
  } else if (unsuitableProfessionalRole) {
    processTrack = 'direct-interview';
    writtenExam = hasExam ? 'likely' : 'not_found';
    confidence = 'high';
    labels.push('전문자격 분리');
    note = '학력무관이어도 의료·돌봄 전문자격 또는 면허 중심 채용으로 확인되어 공채 상세 정보가 아닌 학생 추천 제외/현장형 검토 대상으로 분리했습니다.';
  } else if (criticalProtectedRecruit) {
    processTrack = 'exam-formal';
    writtenExam = hasExam ? 'confirmed' : 'likely';
    confidence = 'high';
    labels.push('핵심 공채 보호');
    note = '현재 진행 중 핵심 감시 공채이며 고졸 지원 가능성과 학생 적합성 검사를 통과해 공채 상세 정보에서 누락되지 않도록 보호했습니다.';
  } else if (forceFieldDirect || limitedTemporaryDirect) {
    processTrack = 'direct-interview';
    writtenExam = hasExam ? 'likely' : 'not_found';
    confidence = 'high';
    labels.push('현장형 분리');
    note = '공공·금융·대기업 소스라도 학생 진로 추천에 필요한 경력 사다리·공식 전형 신호보다 현장형·한시성 신호가 우세해 면접중심·현장형 채용으로 분리했습니다.';
  } else if (hasExam) {
    processTrack = 'exam-formal';
    writtenExam = 'confirmed';
    confidence = 'high';
    labels.push('필기 확인');
    note = '필기·NCS·인적성·전공시험 등 학생이 시험 준비를 해야 할 신호가 원문 키워드에서 확인됩니다.';
  } else if (formalPublicStudentRecruit) {
    processTrack = 'exam-formal';
    writtenExam = 'not_found';
    confidence = 'high';
    labels.push('추천 공채');
    note = '정규직·무기계약직·채용형 인턴 등 특성화고 학생에게 안내할 가치가 큰 공식 공채 신호가 확인되어 공채 상세 정보로 보호했습니다.';
  } else if (isRegionalEducationRecruit) {
    processTrack = 'direct-interview';
    writtenExam = 'not_found';
    confidence = 'high';
    labels.push('교육청 보조검증');
    note = '지역 교육청 취업지원센터 소식은 직접 표시 후보가 아니라 잡알리오·고용24·기관 원문을 보강하는 2차·3차 검증 출처로 분리합니다.';
  } else if (recommendedPublicRecruit && (source?.trackHint === 'exam' || PUBLIC_RECRUIT_SECTORS.has(sector))) {
    processTrack = 'exam-formal';
    writtenExam = 'not_found';
    confidence = 'medium';
    labels.push('학생추천 채용');
    note = '특성화고 학생에게 안내할 가치가 있는 공식 공채 후보로 판단되어 공채 상세 정보에 보존했습니다. 필기시험 신호는 추가 수집 때 계속 대조합니다.';
  } else if (hasDirect || source?.trackHint === 'direct' || ['mid-sme', 'part-time'].includes(sector)) {
    processTrack = 'direct-interview';
    writtenExam = 'not_found';
    confidence = hasDirect || source?.trackHint === 'direct' ? 'medium' : 'review';
    labels.push(hasDirect ? '서류·면접 중심' : '필기 미탐지');
    note = '필기시험 준비 신호가 없어 서류·면접 중심 채용으로 자동 분류했습니다.';
  } else if (source?.trackHint === 'exam' || ['public-institution', 'government', 'military', 'finance', 'finance-large-company', 'large-company'].includes(sector)) {
    processTrack = 'direct-interview';
    writtenExam = 'unknown';
    confidence = 'review';
    labels.push('공채상세 검토대기');
    note = '공공·금융·대기업 소스지만 정규직·무기계약직·채용형 인턴 등 학생 추천 공식 공채 신호가 충분하지 않아 면접중심·현장형 채용으로 분리했습니다.';
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
  const hasSpecificCompanyNotice = hasCompanyNotice && (check.status === 'content_matched' || !isHomepageUrl(companyNoticeUrl));
  const hasJobAlioOfficialDetail = /job\.alio\.go\.kr\/recruitview\.do/i.test(sourceOfficialUrl || displayOfficialUrl);
  const isPublicRecruit = process.processTrack === 'exam-formal';
  const isRegionalEducationRecruit = isRegionalEducationConcreteRecruit(raw);

  let doubleCheckStatus = 'official_source_summarized';
  let doubleCheckLabel = '공식 소스 자동요약';
  let verificationNote = '공식 채용 소스에서 마감·자격·전형·첨부 정보를 자동 추출했습니다. 변동 가능 항목은 다음 수집에서 다시 대조합니다.';

  if (isRegionalEducationRecruit && hasSpecificCompanyNotice) {
    doubleCheckStatus = check.status === 'content_matched' ? 'regional_education_confirmed' : 'regional_education_linked';
    doubleCheckLabel = check.status === 'content_matched' ? '교육청 보조검증 원문확인' : '교육청 보조검증 링크확보';
    verificationNote = '지역 교육청 취업지원센터 소식은 직접 결과 카드로 노출하지 않고, 잡알리오·고용24·기관 공고와 같은 채용인지 대조하는 보조 검증 출처로만 사용합니다.';
  } else if (hasSpecificCompanyNotice && check.status === 'content_matched') {
    doubleCheckStatus = 'company_notice_confirmed';
    doubleCheckLabel = '공식 공고 2중확인';
    verificationNote = '공식 채용 소스와 회사·기관 또는 채용대행 공식 공지사항 내용을 함께 확인했습니다.';
  } else if (hasSpecificCompanyNotice && check.reachable) {
    doubleCheckStatus = 'company_notice_reachable';
    doubleCheckLabel = '공식 공고 접속확인';
    verificationNote = '공식 채용 소스와 회사·기관 또는 채용대행 공식 공지사항 링크를 함께 확인했습니다. 세부 변동 가능 항목은 다음 수집에서 다시 대조합니다.';
  } else if (hasSpecificCompanyNotice) {
    doubleCheckStatus = 'company_notice_linked';
    doubleCheckLabel = '공식 공고 링크확보';
    verificationNote = '공식 채용 소스에서 회사·기관 또는 채용대행 공식 공지사항 링크를 확보했습니다. 접속 대조는 다음 수집에서 이어갑니다.';
  } else if (isPublicRecruit && hasJobAlioOfficialDetail) {
    doubleCheckStatus = 'job_alio_detail_confirmed';
    doubleCheckLabel = '잡알리오 공식 원문 확인';
    verificationNote = '잡알리오 공식 상세 공고와 첨부 공고문 기준으로 마감·자격·전형 정보를 확인했습니다.';
  } else if (isPublicRecruit) {
    doubleCheckStatus = 'company_notice_required';
    doubleCheckLabel = '공식 공고 자동탐색중';
    verificationNote = '공채 상세 제공을 위해 회사·기관 또는 채용대행 공식 공지사항 URL을 자동 탐색 중입니다.';
  }

  return {
    sourceOfficialUrl: sourceOfficialUrl || displayOfficialUrl,
    companyNoticeUrl,
    primaryOfficialUrl: hasSpecificCompanyNotice ? companyNoticeUrl : (sourceOfficialUrl || displayOfficialUrl),
    officialNoticePriority: isRegionalEducationRecruit
      ? 'regional-education-verification-only-source'
      : hasSpecificCompanyNotice
        ? 'company-or-agency-notice-first'
        : isPublicRecruit && hasJobAlioOfficialDetail
          ? 'job-alio-official-detail-first'
        : isPublicRecruit ? 'source-official-pending-company-or-agency-notice' : 'source-official-auto-summary',
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
  if (verification.doubleCheckStatus === 'regional_education_confirmed' || verification.doubleCheckStatus === 'regional_education_linked') {
    return {
      servicePriority: 'regional-education-verification-only',
      servicePolicyLabel: '교육청 보조검증',
      detailLevel: 'regional-education-verification-source',
      displayNote: '지역 교육청 취업지원센터 소식은 화면에 직접 노출하지 않고, 1차 공식 채용 원문과 일치할 때만 보조 검증 출처로 붙입니다.',
      contactAdvice: '잡알리오·고용24·기관 또는 기업 공식 공고를 먼저 확정하고, 교육청 취업지원센터·학교 소식은 누락 보완과 2차·3차 확인에만 사용합니다.'
    };
  }

  if (process.processTrack === 'exam-formal') {
    const isDetailed = ['company_notice_confirmed', 'company_notice_reachable'].includes(verification.doubleCheckStatus)
      || /job\.alio\.go\.kr\/recruitview\.do/i.test(verification.sourceOfficialUrl || '');
    return {
      servicePriority: 'primary-public-recruit',
      servicePolicyLabel: isDetailed ? '공채 상세' : '공채 상세 확인중',
      detailLevel: isDetailed ? 'detailed-public-recruit' : 'official-summary-pending-company-check',
      displayNote: isDetailed
        ? '회사·기관 또는 채용대행 공식 공고를 기준으로 전형, 자격, 마감 정보를 상세 확인합니다.'
        : '공채 후보로 우선 표시하되 회사·기관 또는 채용대행 공식 공지사항 2중 확인 전에는 상세 확정으로 보지 않습니다.',
      contactAdvice: '회사·기관 채용 공지, 채용대행 접수 시스템, 첨부 공고문 기준으로 자동 요약하고 변동 가능 항목은 수집 때 다시 대조합니다.'
    };
  }

  return {
    servicePriority: 'support-brief-direct',
    servicePolicyLabel: '간단 안내',
    detailLevel: 'brief-company-contact',
    displayNote: '면접중심·현장형 채용은 마감, 전형, 자격, 첨부자료 중심으로 자동 요약합니다.',
    contactAdvice: '근무조건·급여·제출서류·청소년 근로 가능 여부 등 변동 항목은 공식 공고와 접수 링크에서 자동 확인 항목으로 표시합니다.'
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeSpace(value);
    if (text) return text;
  }
  return '';
}

function shortText(value, fallback = '원문 확인', max = 140) {
  const text = normalizeSpace(value);
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function publicDisplayUrl(value) {
  const clean = cleanUrl(value);
  if (!clean) return '';
  try {
    const url = new URL(clean);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/serviceKey|authKey|apiKey|accessKey|token|secret/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return clean;
  }
}

function zipEntryPublicUrl(value) {
  const raw = normalizeSpace(value).replace(/\\/g, '/').replace(/[),.;，]+$/g, '');
  if (!raw) return '';
  const absolute = publicDisplayUrl(raw);
  if (absolute) return absolute;
  if (!raw.startsWith(`${ZIP_ATTACHMENT_PUBLIC_BASE}/`)) return '';
  if (raw.includes('..') || raw.startsWith('/') || raw.includes('//')) return '';
  return /^assets\/job-attachment-files\/[a-z0-9]+\/[a-z0-9]+\.[a-z0-9]{1,12}$/i.test(raw) ? raw : '';
}

function isZipAttachment(item) {
  const title = normalizeSpace(item?.title || item?.name || item?.fileName || item?.filename);
  const url = cleanUrl(item?.url || item?.href || item?.link || item?.downloadUrl || item?.fileUrl);
  return /\.zip(?:$|[?#\s])/i.test(`${title} ${url}`) || /(?:zip|압축파일|압축\s*자료)/i.test(title);
}

function zipAttachmentUrl(item) {
  return publicDisplayUrl(item?.url || item?.href || item?.link || item?.downloadUrl || item?.fileUrl);
}

function decodeZipEntryName(bytes, useUtf8) {
  const buffer = Buffer.from(bytes);
  const decode = (encoding) => {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      return '';
    }
  };
  const decoded = useUtf8 ? decode('utf-8') : (decode('euc-kr') || decode('utf-8'));
  return normalizeSpace(decoded.replace(/\0/g, ''));
}

function cleanZipEntryPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => normalizeSpace(part))
    .filter(Boolean)
    .join('/');
}

function safeJoinInside(baseDir, ...segments) {
  const target = path.join(baseDir, ...segments);
  const relative = path.relative(baseDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Unsafe generated attachment path');
  }
  return target;
}

function zipEntryExtension(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (/^\.[a-z0-9]{1,12}$/.test(ext)) return ext;
  return '.bin';
}

function zipEntryAssetLocation(zipUrl, entry) {
  const zipKey = sha(zipUrl || 'zip');
  const entryKey = sha(entry.path || entry.name || 'entry');
  const fileName = `${entryKey}${zipEntryExtension(entry.name || entry.path)}`;
  const filePath = safeJoinInside(ZIP_ATTACHMENT_EXTRACT_DIR, zipKey, fileName);
  return {
    filePath,
    publicUrl: `${ZIP_ATTACHMENT_PUBLIC_BASE}/${zipKey}/${fileName}`
  };
}

function findZipEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function parseZipEntryRecords(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) return [];
  if (buffer.readUInt32LE(0) !== 0x04034b50) return [];

  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) return [];
  const declaredEntryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (!centralDirectorySize || centralDirectoryOffset >= buffer.length) return [];

  const entries = [];
  const seen = new Set();
  let offset = centralDirectoryOffset;
  const endOffset = Math.min(buffer.length, centralDirectoryOffset + centralDirectorySize);
  while (offset + 46 <= endOffset && entries.length < ZIP_ATTACHMENT_MAX_ENTRIES) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) break;

    const rawPath = decodeZipEntryName(buffer.subarray(nameStart, nameEnd), Boolean(flags & 0x0800));
    const rawPathText = rawPath.replace(/\\/g, '/');
    const pathValue = cleanZipEntryPath(rawPath);
    offset = nameEnd + extraLength + commentLength;
    if (!pathValue || rawPathText.endsWith('/') || seen.has(pathValue)) continue;

    seen.add(pathValue);
    const parts = pathValue.split('/');
    entries.push({
      name: parts[parts.length - 1],
      path: pathValue,
      folder: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
      size: uncompressedSize || compressedSize || null,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset
    });
  }

  if (declaredEntryCount > entries.length && entries.length >= ZIP_ATTACHMENT_MAX_ENTRIES) {
    entries.truncated = true;
  }
  return entries;
}

function publicZipEntry(record, overrides = {}) {
  const entry = {
    name: record.name,
    path: record.path,
    folder: record.folder,
    size: record.size || null,
    ...overrides
  };
  if (!entry.url) delete entry.url;
  if (!entry.downloadName) delete entry.downloadName;
  return entry;
}

function extractZipRecordBuffer(zipBuffer, record) {
  if (!Buffer.isBuffer(zipBuffer) || !record) return null;
  const offset = Number(record.localHeaderOffset);
  if (!Number.isFinite(offset) || offset < 0 || offset + 30 > zipBuffer.length) return null;
  if (zipBuffer.readUInt32LE(offset) !== 0x04034b50) return null;
  if ((record.uncompressedSize || record.size || 0) > ZIP_ATTACHMENT_EXTRACT_MAX_BYTES) return null;
  const fileNameLength = zipBuffer.readUInt16LE(offset + 26);
  const extraLength = zipBuffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + Number(record.compressedSize || 0);
  if (dataStart < 0 || dataEnd < dataStart || dataEnd > zipBuffer.length) return null;
  const compressed = zipBuffer.subarray(dataStart, dataEnd);
  if (record.compressionMethod === 0) return compressed;
  if (record.compressionMethod === 8) return inflateRawSync(compressed);
  return null;
}

async function extractZipEntryAssets(zipUrl, records, zipBuffer) {
  const entries = [];
  for (const record of records) {
    const baseEntry = publicZipEntry(record);
    try {
      const content = extractZipRecordBuffer(zipBuffer, record);
      if (!content || content.length > ZIP_ATTACHMENT_EXTRACT_MAX_BYTES) {
        entries.push(baseEntry);
        continue;
      }
      const { filePath, publicUrl } = zipEntryAssetLocation(zipUrl, record);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      entries.push(publicZipEntry(record, {
        url: publicUrl,
        downloadName: record.name
      }));
    } catch {
      entries.push(baseEntry);
    }
  }
  return entries;
}

function parseZipEntries(buffer) {
  return parseZipEntryRecords(buffer).map((record) => publicZipEntry(record));
}

async function inspectZipAttachment(item) {
  const url = zipAttachmentUrl(item);
  if (!url) return { archiveFormat: 'zip', archiveScanStatus: 'missing_url', archiveEntries: [] };
  try {
    const buffer = await fetchBinaryWithTimeout(url);
    const records = parseZipEntryRecords(buffer);
    const entries = await extractZipEntryAssets(url, records, buffer);
    return {
      archiveFormat: 'zip',
      archiveScanStatus: entries.length ? 'ok' : 'empty',
      archiveEntryCount: entries.length,
      archiveEntries: entries,
      archiveScannedAt: CHECKED_AT
    };
  } catch (error) {
    return {
      archiveFormat: 'zip',
      archiveScanStatus: 'failed',
      archiveScanMessage: sanitizeFetchErrorMessage(error.message),
      archiveEntries: [],
      archiveScannedAt: CHECKED_AT
    };
  }
}

function normalizeZipArchiveEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    if (!entry) return null;
    const rawPath = typeof entry === 'object'
      ? (entry.path || entry.name || entry.fileName || entry.filename)
      : String(entry);
    const folder = typeof entry === 'object' ? cleanZipEntryPath(entry.folder || '') : '';
    const name = typeof entry === 'object'
      ? normalizeSpace(entry.name || entry.fileName || entry.filename)
      : '';
    let pathValue = cleanZipEntryPath(rawPath);
    if (!pathValue && name) pathValue = folder ? `${folder}/${name}` : name;
    if (!pathValue) return null;
    const parts = pathValue.split('/');
    const sizeValue = typeof entry === 'object' ? Number(entry.size || 0) : 0;
    const url = typeof entry === 'object'
      ? zipEntryPublicUrl(entry.url || entry.href || entry.link || entry.downloadUrl || entry.fileUrl)
      : '';
    const downloadName = typeof entry === 'object' ? normalizeSpace(entry.downloadName || '') : '';
    return {
      name: name || parts[parts.length - 1],
      path: pathValue,
      folder: folder || (parts.length > 1 ? parts.slice(0, -1).join('/') : ''),
      size: Number.isFinite(sizeValue) && sizeValue > 0 ? sizeValue : null,
      ...(url ? { url } : {}),
      ...(downloadName ? { downloadName } : {})
    };
  }).filter(Boolean).slice(0, ZIP_ATTACHMENT_MAX_ENTRIES);
}

function zipDetailsFromAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const archiveEntries = normalizeZipArchiveEntries(attachment.archiveEntries || attachment.zipEntries || attachment.entries);
  if (!archiveEntries.length) return null;
  return {
    archiveFormat: attachment.archiveFormat || 'zip',
    archiveScanStatus: attachment.archiveScanStatus || 'ok',
    archiveEntryCount: archiveEntries.length,
    archiveEntries,
    archiveScannedAt: attachment.archiveScannedAt || attachment.archiveCachedFrom || ''
  };
}

function buildPreviousZipDetailsByUrl(previousItems) {
  const zipDetailsByUrl = new Map();
  const uniqueItems = new Set(previousItems instanceof Map ? previousItems.values() : Array.isArray(previousItems) ? previousItems : []);
  for (const item of uniqueItems) {
    const attachmentGroups = [
      Array.isArray(item?.attachments) ? item.attachments : [],
      Array.isArray(item?.publicRecruitDetails?.attachments) ? item.publicRecruitDetails.attachments : []
    ];
    for (const attachments of attachmentGroups) {
      for (const attachment of attachments) {
        const url = zipAttachmentUrl(attachment);
        const details = url ? zipDetailsFromAttachment(attachment) : null;
        if (!url || !details) continue;
        const existing = zipDetailsByUrl.get(url);
        if (!existing || details.archiveEntries.length >= existing.archiveEntries.length) {
          zipDetailsByUrl.set(url, details);
        }
      }
    }
  }
  return zipDetailsByUrl;
}

function shouldUseCachedZipDetails(details, cachedDetails) {
  if (!cachedDetails?.archiveEntries?.length) return false;
  const currentEntries = Array.isArray(details?.archiveEntries) ? details.archiveEntries.length : 0;
  return !currentEntries && ['failed', 'empty', 'missing_url'].includes(details?.archiveScanStatus);
}

function applyCachedZipDetails(details, cachedDetails) {
  if (!shouldUseCachedZipDetails(details, cachedDetails)) return details;
  const failedMessage = details.archiveScanMessage
    ? `최근 자동 수집 실패: ${details.archiveScanMessage}`
    : '최근 자동 수집에서 압축파일 내부 목록을 새로 확인하지 못해 직전 정상 목록을 유지합니다.';
  return {
    ...details,
    archiveScanStatus: 'cached',
    archiveScanMessage: failedMessage,
    archiveEntryCount: cachedDetails.archiveEntries.length,
    archiveEntries: cachedDetails.archiveEntries,
    archiveCachedFrom: cachedDetails.archiveScannedAt || '',
    archiveScannedAt: details.archiveScannedAt || CHECKED_AT
  };
}

function hasOpenableCachedZipEntries(cachedDetails) {
  const entries = Array.isArray(cachedDetails?.archiveEntries) ? cachedDetails.archiveEntries : [];
  return entries.length > 0 && entries.every((entry) => entry?.url);
}

function reuseCachedZipDetails(cachedDetails) {
  return {
    ...cachedDetails,
    archiveScanStatus: 'cached',
    archiveScanMessage: '직전 확인한 ZIP 내부 파일 링크를 유지합니다.',
    archiveEntryCount: cachedDetails.archiveEntries.length,
    archiveCachedFrom: cachedDetails.archiveScannedAt || cachedDetails.archiveCachedFrom || '',
    archiveScannedAt: CHECKED_AT
  };
}

function enhanceAttachmentArrayWithZipEntries(attachments, zipDetailsByUrl) {
  if (!Array.isArray(attachments)) return attachments;
  return attachments.map((attachment) => {
    if (!isZipAttachment(attachment)) return attachment;
    const url = zipAttachmentUrl(attachment);
    const details = zipDetailsByUrl.get(url);
    return details ? { ...attachment, ...details } : attachment;
  });
}

async function enhanceZipAttachmentsForItems(items, cachedZipDetailsByUrl = new Map()) {
  const zipTargets = new Map();
  for (const item of items) {
    const attachmentGroups = [
      Array.isArray(item.attachments) ? item.attachments : [],
      Array.isArray(item.publicRecruitDetails?.attachments) ? item.publicRecruitDetails.attachments : []
    ];
    for (const attachments of attachmentGroups) {
      for (const attachment of attachments) {
        if (!isZipAttachment(attachment)) continue;
        const url = zipAttachmentUrl(attachment);
        if (url && !zipTargets.has(url)) zipTargets.set(url, attachment);
      }
    }
  }

  const zipDetailsByUrl = new Map();
  await mapWithConcurrency(Array.from(zipTargets.entries()), ZIP_ATTACHMENT_CONCURRENCY, async ([url, attachment]) => {
    const cachedDetails = cachedZipDetailsByUrl.get(url);
    if (hasOpenableCachedZipEntries(cachedDetails)) {
      zipDetailsByUrl.set(url, reuseCachedZipDetails(cachedDetails));
      return;
    }
    const inspected = await inspectZipAttachment({ ...attachment, url });
    zipDetailsByUrl.set(url, applyCachedZipDetails(inspected, cachedDetails));
  });

  for (const item of items) {
    item.attachments = enhanceAttachmentArrayWithZipEntries(item.attachments, zipDetailsByUrl);
    if (item.publicRecruitDetails && Array.isArray(item.publicRecruitDetails.attachments)) {
      item.publicRecruitDetails.attachments = enhanceAttachmentArrayWithZipEntries(item.publicRecruitDetails.attachments, zipDetailsByUrl);
    }
  }

  let scanned = 0;
  let entryCount = 0;
  let failed = 0;
  let cached = 0;
  for (const details of zipDetailsByUrl.values()) {
    scanned += 1;
    entryCount += details.archiveEntryCount || 0;
    if (details.archiveScanStatus === 'cached') cached += 1;
    else if (details.archiveScanStatus === 'failed') failed += 1;
  }
  return { scanned, entryCount, failed, cached };
}

function normalizeAttachmentList(raw, verification) {
  const sourceItems = Array.isArray(raw.attachments) ? raw.attachments : [];
  const candidates = [
    ...sourceItems,
    raw.attachmentUrl ? { title: raw.attachmentTitle || '공식 첨부자료', url: raw.attachmentUrl } : null,
    raw.fileUrl ? { title: raw.fileName || '공식 첨부자료', url: raw.fileUrl } : null
  ].filter(Boolean);
  const seen = new Set();
  const attachments = [];

  for (const item of candidates) {
    const url = publicDisplayUrl(item.url);
    const title = shortText(item.title || item.name || '공식 첨부자료', '공식 첨부자료', 64);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    attachments.push({ title, url });
  }

  if (!attachments.length && verification.primaryOfficialUrl) {
    attachments.push({
      title: verification.companyNoticeUrl ? '회사·기관 공식 공고문' : '공식 원문 공고',
      url: publicDisplayUrl(verification.primaryOfficialUrl)
    });
  }

  return attachments.slice(0, 5);
}

function keywordSnippet(text, keywords, fallback, max = 150) {
  const source = normalizeSpace(text);
  if (!source) return fallback;
  for (const keyword of keywords) {
    const index = source.indexOf(keyword);
    if (index === -1) continue;
    const start = Math.max(0, index - 34);
    const end = Math.min(source.length, index + max);
    return shortText(source.slice(start, end), fallback, max);
  }
  return fallback;
}

function buildExamSubjectLines(raw, process) {
  const text = [raw.title, raw.description, raw.processText].join(' ');
  const subjects = [];
  if (text.includes('NCS')) subjects.push('NCS 직업기초능력');
  if (text.includes('직무능력검사')) subjects.push('직무능력검사');
  if (text.includes('인적성')) subjects.push('인적성검사');
  if (text.includes('AI') || text.includes('AI역량')) subjects.push('AI역량검사');
  if (/전공\s*(?:시험|평가|필기)|전공시험|전공평가|전공필기/.test(text)) subjects.push('전공시험');
  if (text.includes('논술')) subjects.push('논술');
  if (text.includes('체력')) subjects.push('체력검정');

  if (subjects.length) return compactTags(subjects);
  if (process.writtenExam === 'confirmed') return ['필기전형 있음 - 과목은 원문 확인'];
  if (process.writtenExam === 'likely') return ['필기 또는 공식 선발절차 가능성 높음 - 원문 확인'];
  return ['필기시험 미확인'];
}

function buildRecruitBriefing(context) {
  const {
    raw,
    process,
    verification,
    servicePolicy,
    status,
    title,
    company,
    deadline,
    collectionAudit,
    schoolRecommendation,
    attachments
  } = context;
  const isPublicRecruit = process.processTrack === 'exam-formal';
  const isRegionalEducationRecruit = servicePolicy.detailLevel === 'regional-education-verification-source';
  const officialUrl = publicDisplayUrl(verification.primaryOfficialUrl || raw.url);
  const sourceUrl = publicDisplayUrl(verification.sourceOfficialUrl || raw.sourceDetailUrl || raw.originalUrl);
  const applicationMethod = firstText(raw.applicationMethod, raw.application, raw.applyMethod);
  const recruitField = firstText(raw.recruitField, raw.jobField, raw.workField, raw.position);
  const recruitNumber = firstText(raw.recruitNumber, raw.hiringCount, raw.recruitCount);
  const contact = firstText(raw.contact, raw.contactInfo, raw.inquiry);
  const eligibility = firstText(raw.qualification, raw.education, raw.career);
  const processText = firstText(raw.processText, raw.selectionMethod, process.processNote);
  const detailText = firstText(raw.description, raw.detailText);
  const examSubjects = buildExamSubjectLines(raw, process);
  const writtenExamLine = process.writtenExam === 'not_found'
    ? '필기시험은 현재 원문 키워드에서 확인되지 않았습니다.'
    : keywordSnippet([processText, detailText].join(' '), EXAM_TERMS, examSubjects.join(' · '));
  const interviewLine = keywordSnippet([processText, detailText].join(' '), ['면접', '면접전형', '심층면접'], '면접 일정·방식 자동 추출 대기');
  const resultLine = keywordSnippet([processText, detailText].join(' '), ['합격자', '최종합격', '발표', '임용'], '합격자 발표·임용일 자동 추출 대기');
  const attachmentLines = attachments.length
    ? attachments.map((item) => `${item.title}: ${item.url}`)
    : ['공고문·입사지원서·직무기술서 공식 첨부 자동 탐색 대기'];
  const resolvedApplicationLine = safeDeadlineDisplayText(raw.deadlineText, deadline ? `${deadline} 마감` : '공식 원문에서 확인');
  const applicationLine = status === 'application_closed'
    ? (/\d/.test(resolvedApplicationLine)
      ? resolvedApplicationLine.replace(/\s*(?:원서\s*)?마감$/, ' 원서 마감')
      : (deadline ? `${deadline} 원서 마감` : '원서 마감'))
    : resolvedApplicationLine;

  const summaryLines = compactTags([
    `${company} ${isPublicRecruit ? '공채·공식전형' : '채용정보'}`,
    recruitField ? `채용부문: ${recruitField}` : `공고명: ${title}`,
    recruitNumber ? `채용규모: ${recruitNumber}` : '',
    `학력·자격: ${shortText(eligibility, '응시자격 자동 추출 대기', 120)}`,
    raw.region ? `근무지: ${shortText(raw.region, '자동 추출 대기', 80)}` : '',
    raw.employmentType ? `고용형태: ${shortText(raw.employmentType, '자동 추출 대기', 80)}` : ''
  ]);

  const scheduleLines = compactTags([
    `원서접수: ${shortText(applicationLine, '마감일 자동 추출 대기', 120)}`,
    `전형절차: ${shortText(processText, process.processNote, 150)}`,
    `필기전형: ${shortText(writtenExamLine, '필기 전형 자동 추출 대기', 120)}`,
    `면접전형: ${shortText(interviewLine, '면접 일정 자동 추출 대기', 120)}`,
    `발표·임용: ${shortText(resultLine, '발표·임용 자동 추출 대기', 120)}`
  ]);

  const schoolCheckSections = [
    ...(isRegionalEducationRecruit ? [{
      title: '교육청 취업지원센터 보조검증',
      text: '지역 교육청·학교 소식은 직접 노출하지 않고, 같은 기업·기관 공고가 잡알리오·고용24·기관 원문에도 있는지 확인하는 보조 출처로만 사용합니다.'
    }] : []),
    {
      title: '학교장 추천 필요 여부 원문 확인',
      text: schoolRecommendation === 'required'
        ? '학교장 추천 신호가 감지되어 추천 기준, 가능 인원, 교내 접수 마감을 정리합니다.'
        : '학교장 추천 요구 신호는 감지되지 않았으며, 다음 자동 수집에서 추천 관련 문구를 계속 대조합니다.'
    },
    {
      title: '지원 가능 학년·졸업예정 기준 확인',
      text: shortText(eligibility, '학년·졸업예정·학력 기준 자동 추출 대기', 170)
    },
    {
      title: '공고문·입사지원서·직무기술서 첨부 확보',
      text: attachments.length
        ? attachments.map((item) => item.title).slice(0, 4).join(' · ')
        : '공식 첨부자료 자동 탐색 대기'
    },
    {
      title: '필기/NCS 대비 일정 안내',
      text: process.writtenExam === 'not_found'
        ? '필기/NCS 시험 신호가 없어 서류·면접 준비 일정 중심으로 안내합니다.'
        : examSubjects.join(' · ')
    }
  ];

  const schoolActionItems = compactTags([
    verification.doubleCheckLabel,
    ...schoolCheckSections.map((section) => `${section.title}: ${section.text}`),
    collectionAudit.missedReviewNeeded ? '공고 게시일과 첫날 수집 누락 여부 점검' : '공고 게시 첫날 수집 기록'
  ]);

  const studentActionItems = compactTags([
    '원서접수 마감 전 지원계정·제출서류 확인',
    schoolRecommendation === 'required' ? '학교장 추천 신청 서류 준비' : '',
    process.writtenExam === 'not_found' ? '공식 공고 기반 직무·면접 예상 질문 정리' : 'NCS·직무능력·인적성 대비',
    '자기소개서·경험기술서 초안 작성',
    '근무지·고용형태·임용예정일 확인'
  ]);

  const sourceLines = compactTags([
    officialUrl ? `공식 원문: ${officialUrl}` : '공식 원문 URL 자동 탐색 대기',
    sourceUrl && sourceUrl !== officialUrl ? `보완 출처: ${sourceUrl}` : '',
    verification.verificationNote,
    servicePolicy.displayNote
  ]);

  const shareLines = [
    `[${company}]`,
    `- ${isPublicRecruit ? '고졸(예정) 공채·공식전형' : '고졸·특성화고 관련 채용정보'}`,
    '',
    '[채용부문]',
    ...summaryLines.map((line) => `- ${line}`),
    '',
    '[전형일정]',
    ...scheduleLines.map((line) => `- ${line}`),
    '',
    '[학교 확인]',
    ...schoolCheckSections.map((section) => `- ${section.title}: ${section.text}`),
    '',
    '[학생 준비]',
    ...studentActionItems.slice(0, 5).map((line) => `- ${line}`),
    '',
    '[원문·첨부]',
    ...sourceLines.slice(0, 3).map((line) => `- ${line}`),
    ...attachmentLines.slice(0, 3).map((line) => `- ${line}`)
  ];

  return {
    version: 1,
    generator: 'official-source-briefing-v1',
    label: isRegionalEducationRecruit ? '교육청 보조검증 브리핑' : isPublicRecruit ? '취업부 공채 브리핑' : '현장형 채용 확인 브리핑',
    detailLevel: isPublicRecruit || isRegionalEducationRecruit ? servicePolicy.detailLevel : 'brief-company-contact',
    headline: `${company} - ${title}`,
    summaryLines,
    scheduleLines,
    examSubjects,
    schoolCheckSections,
    schoolActionItems,
    studentActionItems,
    sourceLines,
    attachmentLines,
    teacherShareText: shareLines.join('\n'),
    officialBasis: verification.doubleCheckLabel,
    officialUrl,
    sourceUrl,
    generatedAt: CHECKED_AT
  };
}

function buildCollectionAudit(raw, publishedDate, firstSeenAt = CHECKED_AT) {
  const publishedAt = publishedDate ? publishedDate.toISOString() : '';
  const publishedDay = formatDate(publishedDate);
  const firstSeenDate = parseDate(firstSeenAt) || NOW;
  const firstSeenDay = formatDate(firstSeenDate);
  const rawDetectionLagDays = publishedDate ? daysBetweenKst(publishedDate, firstSeenDate) : null;
  const detectionLagDays = rawDetectionLagDays === null ? null : Math.max(0, rawDetectionLagDays);

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
    labels.push('필기 없음');
  }
  if (isRegionalEducationConcreteRecruit(raw)) {
    score += 34;
    labels.push('교육청 취업지원센터');
  }

  const hasPositiveTerm = HIGH_SCHOOL_TERMS.some((term) => haystack.includes(term));
  const hasNegativeEduOnly = NEGATIVE_EDU_TERMS.some((term) => haystack.includes(term)) && !hasPositiveTerm;
  if (hasNegativeEduOnly) score -= 30;

  return {
    score: Math.max(0, Math.min(100, score)),
    labels: compactTags(labels)
  };
}

function eligibilityText(item) {
  return [
    item.title,
    item.company,
    item.education,
    item.career,
    item.employmentType,
    item.recruitField,
    item.detailText
  ].join(' ');
}

function hasStrongHighSchoolSignal(item) {
  const text = eligibilityText(item);
  return STRONG_TERMS.some((term) => text.includes(term))
    || /고졸\s*(제한|전형|채용|구분|사회형평)/.test(text);
}

function hasEntryLevelSignal(item) {
  const text = eligibilityText(item);
  return ENTRY_LEVEL_TERMS.some((term) => text.includes(term));
}

function hasEducationOpenSignal(item) {
  return /학력\s*무관/.test(eligibilityText(item));
}

function isCareerOnlyRole(item) {
  const career = normalizeSpace(item.career);
  if (!career || career === '원문 확인') return false;
  if (/신입|무관/.test(career)) return false;
  return /경력|경력직/.test(career);
}

function hasAdvancedEducationOnly(item) {
  const text = eligibilityText(item);
  if (hasStrongHighSchoolSignal(item) || hasEducationOpenSignal(item)) return false;
  return NEGATIVE_EDU_TERMS.some((term) => text.includes(term));
}

function isUnsuitableForHighSchoolChannel(item) {
  const text = eligibilityText(item);
  const strongHighSchool = hasStrongHighSchoolSignal(item);
  const entryLevel = hasEntryLevelSignal(item);
  const educationOpen = hasEducationOpenSignal(item);
  if (hasCollegeOnlyApplicantSignal(text)) return true;
  if (hasStudentUnsuitableRecruitSignal(text)) return true;
  if (hasStudentUnsuitableProfessionalRole(text)) return true;
  if (SENIOR_ROLE_PATTERN.test(text)) return true;
  if (!strongHighSchool && !entryLevel && !educationOpen && RESTRICTED_ROLE_PATTERN.test(text)) return true;
  if (!strongHighSchool && PROFESSIONAL_ONLY_TERMS.some((term) => text.includes(term))) return true;
  if (hasAdvancedEducationOnly(item)) return true;
  if (!strongHighSchool && !entryLevel && !educationOpen && isCareerOnlyRole(item)) return true;
  return false;
}

function companyTitleCompareText(value) {
  return normalizeSpace(value)
    .replace(/\(주\)|㈜|주식회사/g, '')
    .replace(/[\s·ㆍ\-\[\]\(\){}.,:;'"“”‘’]/g, '')
    .toLowerCase();
}

function titleWithCompanyName(title, company) {
  const cleanTitle = normalizeSpace(title);
  const cleanCompany = normalizeSpace(company);
  if (!cleanTitle || !cleanCompany) return cleanTitle || cleanCompany;
  const titleKey = companyTitleCompareText(cleanTitle);
  const companyKey = companyTitleCompareText(cleanCompany);
  if (companyKey && titleKey.includes(companyKey)) return cleanTitle;
  return `${cleanCompany} ${cleanTitle}`;
}

function normalizeItem(raw) {
  const company = normalizeSpace(raw.company);
  const baseTitle = titleWithCompanyName(raw.title, company);
  const deadlineDate = parseDate(raw.deadline || raw.deadlineTimestamp);
  const deadline = formatDate(deadlineDate);
  const deadlineDistance = daysUntil(deadlineDate);
  const url = cleanUrl(raw.url) || cleanUrl(raw.originalUrl) || cleanUrl(raw.sourceDetailUrl);
  const score = scoreItem(raw);
  const process = classifyProcess(raw);
  const studentChannelAssessment = buildStudentChannelAssessment(raw, process);
  const sourceVerification = buildSourceVerification(raw, process, url);
  const servicePolicy = buildServicePolicy(process, sourceVerification);
  const publishedDate = parseDate(raw.publishedAt || raw.registeredAt || raw.postedAt || raw.openDate || raw.postingDate);
  const collectionAudit = buildCollectionAudit(raw, publishedDate);
  const isExamFormal = process.processTrack === 'exam-formal';
  const isRegionalEducationVerificationSource = servicePolicy.detailLevel === 'regional-education-verification-source';
  const deadlinePassed = Boolean(deadlineDate && !Number.isNaN(deadlineDate.getTime()) && NOW.getTime() >= deadlineDate.getTime());
  const daysAfterDeadline = deadlinePassed
    ? Math.max(0, Math.ceil((NOW.getTime() - deadlineDate.getTime()) / 86400000))
    : 0;
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
  if (deadlinePassed || (deadlineDistance !== null && deadlineDistance < 0)) {
    status = isExamFormal && daysAfterDeadline <= APPLICATION_CLOSED_RETAIN_DAYS ? 'application_closed' : 'expired';
  }
  else if (deadlineDistance !== null && deadlineDistance <= 5) status = 'deadline_soon';
  const title = status === 'application_closed' ? withApplicationClosedSuffix(baseTitle) : baseTitle;

  let schoolRecommendation = 'unknown';
  if (lowerText.includes('학교장 추천') || lowerText.includes('학교장추천')) {
    schoolRecommendation = 'required';
  }
  const attachments = normalizeAttachmentList(raw, sourceVerification);
  const resolvedDeadlineDisplayText = safeDeadlineDisplayText(raw.deadlineText, deadline ? `${deadline} 마감` : '마감일 확인 필요');
  const resolvedApplicationDeadlineText = safeDeadlineDisplayText(raw.deadlineText, deadline ? `${deadline} 마감` : '공식 원문에서 확인');
  const closedDeadlineText = /\d/.test(resolvedDeadlineDisplayText)
    ? resolvedDeadlineDisplayText.replace(/\s*(?:원서\s*)?마감$/, ' 원서 마감')
    : (deadline ? `${deadline} 원서 마감` : '원서 마감');
  const displayDeadlineText = status === 'application_closed'
    ? closedDeadlineText
    : resolvedDeadlineDisplayText;
  const displayApplicationDeadlineText = status === 'application_closed'
    ? closedDeadlineText
    : resolvedApplicationDeadlineText;

  const legalCheckFlags = ['원문확인', '마감확인', '학력조건확인', '추천여부확인'];
  const guideTags = compactTags([
    process.trackName,
    process.sectorName,
    raw.employmentType || '고용형태 확인',
    raw.education || '학력조건 확인',
    schoolRecommendation === 'required' ? '학교장 추천 확인' : '추천여부 확인',
    '직무기술서 확인'
  ]);
  const teacherBriefing = buildRecruitBriefing({
    raw,
    process,
    verification: sourceVerification,
    servicePolicy,
    status,
    title,
    company,
    deadline,
    collectionAudit,
    schoolRecommendation,
    attachments
  });

  const item = {
    id: sha([raw.source, raw.sourceId, baseTitle, company, deadline, url].join('|')),
    source: raw.source,
    sourceName: raw.sourceName,
    sourceId: normalizeSpace(raw.sourceId),
    title,
    baseTitle,
    company,
    region: normalizeSpace(raw.region) || '원문 확인',
    education: normalizeSpace(raw.education) || '원문 확인',
    career: normalizeSpace(raw.career) || '원문 확인',
    employmentType: normalizeSpace(raw.employmentType) || '원문 확인',
    recruitField: normalizeSpace(raw.recruitField || raw.jobField || raw.workField || raw.position).slice(0, 160),
    recruitNumber: normalizeSpace(raw.recruitNumber || raw.hiringCount || raw.recruitCount).slice(0, 80),
    applicationMethod: normalizeSpace(raw.applicationMethod || raw.application || raw.applyMethod).slice(0, 180),
    contact: normalizeSpace(raw.contact || raw.contactInfo || raw.inquiry).slice(0, 120),
    attachments,
    detailText: normalizeSpace(raw.description || raw.processText).slice(0, isExamFormal || isRegionalEducationVerificationSource ? 620 : 180),
    deadline,
    deadlineText: displayDeadlineText,
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
    studentChannelAssessment,
    sector: process.sector,
    sectorName: process.sectorName,
    sourceVerification,
    servicePriority: servicePolicy.servicePriority,
    servicePolicyLabel: servicePolicy.servicePolicyLabel,
    detailLevel: servicePolicy.detailLevel,
    displayNote: servicePolicy.displayNote,
    contactAdvice: servicePolicy.contactAdvice,
    publicRecruitDetails: isExamFormal ? {
      companyNotice: sourceVerification.companyNoticeUrl
        ? '회사·기관 공식 공고 확인'
        : sourceVerification.doubleCheckStatus === 'job_alio_detail_confirmed'
          ? '잡알리오 공식 상세 공고 확인'
          : '회사·기관 공식 공고 자동 탐색중',
      sourceCheck: sourceVerification.doubleCheckLabel,
      hiring: compactTags([
        normalizeSpace(raw.recruitField || raw.jobField || raw.workField || raw.position),
        normalizeSpace(raw.recruitNumber || raw.hiringCount || raw.recruitCount)
      ]).join(' · ') || '채용부문·규모 자동 추출 대기',
      eligibility: [normalizeSpace(raw.education), normalizeSpace(raw.career)].filter(Boolean).join(' · ') || '응시자격 자동 추출 대기',
      process: normalizeSpace(raw.processText || process.processNote).slice(0, 260) || '전형절차 자동 추출 대기',
      application: displayApplicationDeadlineText,
      attachments: attachments.map((item) => item.title)
    } : null,
    teacherBriefing,
    schoolRecommendation,
    status,
    legalCheckFlags,
    guideTags
  };

  return item;
}

function hasResolvedApplicationDeadline(item = {}) {
  const text = normalizeSpace([
    item.deadline,
    item.deadlineText,
    item.publicRecruitDetails?.application,
    item.teacherBriefing?.scheduleLines?.join(' ')
  ].join(' '));
  return Boolean(item.deadline)
    || /상시\s*채용|채용\s*시까지|수시\s*채용/.test(text);
}

function hasResolvedRecruitQualification(item = {}) {
  const unresolvedPattern = /^원문\s*확인(?:\s*·|$)/;
  const fields = [
    item.education,
    item.publicRecruitDetails?.eligibility,
    ...(Array.isArray(item.teacherBriefing?.summaryLines) ? item.teacherBriefing.summaryLines : []),
    ...(Array.isArray(item.teacherBriefing?.schoolCheckSections)
      ? item.teacherBriefing.schoolCheckSections.map((section) => section?.text)
      : [])
  ].map((value) => normalizeSpace(value).replace(/^학력·자격:\s*/, ''));
  return fields.every((value) => !unresolvedPattern.test(value));
}

function isUnresolvedDetailedPublicRecruit(item = {}) {
  return item.processTrack === 'exam-formal'
    && item.detailLevel === 'detailed-public-recruit'
    && (!hasResolvedApplicationDeadline(item)
      || (item.status !== 'application_closed' && !hasResolvedRecruitQualification(item)));
}

function shouldKeep(item) {
  if (!item.title || !item.company || !item.url) return false;
  if (hasCanceledRecruitSignal(eligibilityText(item))) return false;
  if (isRegionalEducationDisplaySuppressed(item)) return false;
  if (item.status === 'expired') return false;
  if (isUnsuitableForHighSchoolChannel(item)) return false;
  if (criticalCurrentPriority(item) < 99) return true;
  if (item.status === 'application_closed' && item.processTrack !== 'exam-formal') return false;
  if (isUnresolvedDetailedPublicRecruit(item)) return false;
  const text = [item.title, item.company, item.education, item.career, item.employmentType, item.detailText].join(' ');
  const hasStrongHighSchool = STRONG_TERMS.some((term) => text.includes(term));
  if (!hasStrongHighSchool && PROFESSIONAL_ONLY_TERMS.some((term) => text.includes(term))) return false;
  if (item.fitScore >= 24) return true;
  return item.education.includes('고졸')
    || item.education.includes('학력무관')
    || hasEntryLevelSignal(item);
}

function shouldKeepRegionalEducationVerificationItem(item) {
  if (!item.title || !item.company || !item.url) return false;
  if (!isRegionalEducationDisplaySuppressed(item)) return false;
  if (item.status === 'expired' || item.status === 'application_closed') return false;
  if (isUnsuitableForHighSchoolChannel(item)) return false;
  const text = [item.title, item.company, item.education, item.career, item.employmentType, item.detailText].join(' ');
  const hasStrongHighSchool = STRONG_TERMS.some((term) => text.includes(term));
  if (!hasStrongHighSchool && PROFESSIONAL_ONLY_TERMS.some((term) => text.includes(term))) return false;
  return item.fitScore >= 24
    || hasStrongHighSchool
    || item.education.includes('고졸')
    || item.education.includes('학력무관')
    || hasEntryLevelSignal(item);
}

function dedupeAndSortAll(items) {
  const seen = new Map();
  for (const item of items) {
    const key = [
      item.baseTitle || item.title,
      item.company,
      item.deadline || ''
    ].join('|').toLowerCase();
    const existing = seen.get(key);
    if (!existing || itemDedupeQuality(item) > itemDedupeQuality(existing)) {
      seen.set(key, mergeDuplicateItem(item, existing));
    }
  }

  const sorted = Array.from(seen.values())
    .sort((a, b) => {
      const criticalDiff = criticalCurrentPriority(a) - criticalCurrentPriority(b);
      if (criticalDiff !== 0) return criticalDiff;
      const trackWeight = { 'exam-formal': 0, 'direct-interview': 1 };
      const trackDiff = (trackWeight[a.processTrack] ?? 9) - (trackWeight[b.processTrack] ?? 9);
      if (trackDiff !== 0) return trackDiff;
      const verificationWeight = {
        company_notice_confirmed: 0,
        company_notice_reachable: 1,
        job_alio_detail_confirmed: 1,
        company_notice_linked: 2,
        official_source_summarized: 3,
        company_notice_required: 4,
        company_contact_recommended: 5
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
    });
  return sorted;
}

function dedupeAndSort(items) {
  return balanceTrackItems(dedupeAndSortAll(items));
}

function isProtectedFormalPublicRecruitItem(item = {}) {
  if (!item || isUnsuitableForHighSchoolChannel(item)) return false;
  return hasFormalPublicStudentRecruitSignal(
    eligibilityText(item),
    item.sector,
    catalogSource(item.source)
  );
}

function balanceTrackItems(sortedItems) {
  if (sortedItems.length <= MAX_ITEMS) return sortedItems;
  const selected = [];
  const selectedIds = new Set();
  const add = (item) => {
    if (!item || selectedIds.has(item.id) || selected.length >= MAX_ITEMS) return;
    selectedIds.add(item.id);
    selected.push(item);
  };
  const criticalItems = sortedItems.filter((item) => criticalCurrentPriority(item) < 99);
  const regularItems = sortedItems.filter((item) => criticalCurrentPriority(item) >= 99);
  const protectedFormalItems = regularItems.filter(isProtectedFormalPublicRecruitItem);
  const directItems = regularItems.filter((item) => item.processTrack === 'direct-interview' && !isProtectedFormalPublicRecruitItem(item));
  const directTarget = Math.min(directItems.length, Math.max(36, Math.floor(MAX_ITEMS * 0.4)));

  criticalItems.forEach(add);
  protectedFormalItems.forEach(add);
  directItems.slice(0, directTarget).forEach(add);
  regularItems.forEach(add);
  return selected.slice(0, MAX_ITEMS);
}

function itemDedupeQuality(item) {
  const verificationWeight = {
    company_notice_confirmed: 50,
    company_notice_reachable: 42,
    job_alio_detail_confirmed: 42,
    company_notice_linked: 34,
    official_source_summarized: 28,
    company_contact_recommended: 24,
    company_notice_required: 10
  }[item.sourceVerification?.doubleCheckStatus] || 0;
  const sourceUrl = [item.sourceOfficialUrl, item.primaryOfficialUrl, item.originalUrl, item.url].join(' ');
  const sourceWeight = sourceUrl.includes('job.alio.go.kr/recruitview.do') ? 12
    : sourceUrl.includes('data.go.kr') ? 2
    : 6;
  const detailWeight = item.detailLevel === 'detailed-public-recruit' ? 12
    : item.detailLevel === 'brief-company-contact' ? 8
    : 4;
  return verificationWeight + sourceWeight + detailWeight + (item.fitScore || 0);
}

function mergeDuplicateItem(preferred, other) {
  if (!other) return preferred;
  const supplementarySourceUrls = compactTags([
    ...(preferred.supplementarySourceUrls || []),
    preferred.sourceOfficialUrl,
    preferred.originalUrl,
    other.primaryOfficialUrl,
    other.sourceOfficialUrl,
    other.originalUrl,
    ...(other.supplementarySourceUrls || [])
  ].filter((url) => {
    const clean = cleanUrl(url);
    return clean && clean !== preferred.primaryOfficialUrl && clean !== preferred.url;
  }));
  return {
    ...preferred,
    supplementarySourceUrls
  };
}

function itemCandidateUrls(item = {}) {
  return compactTags([
    item.primaryOfficialUrl,
    item.companyNoticeUrl,
    item.url,
    item.originalUrl,
    item.sourceOfficialUrl,
    ...(item.supplementarySourceUrls || [])
  ].map(publicDisplayUrl));
}

function verificationMatchTerms(value, limit = 10) {
  return significantTerms(value, limit)
    .filter((term) => !REGIONAL_VERIFICATION_MATCH_STOP_TERMS.has(term))
    .filter((term) => term.length >= 2);
}

function regionalEducationVerificationMatchesItem(item, verification) {
  const itemUrls = itemCandidateUrls(item);
  const verificationUrls = itemCandidateUrls(verification);
  if (verificationUrls.some((url) => itemUrls.includes(url))) return true;

  const itemText = normalizeSpace([
    item.company,
    item.title,
    item.baseTitle,
    item.recruitField,
    item.detailText
  ].join(' '));
  const verificationText = normalizeSpace([
    verification.company,
    verification.title,
    verification.baseTitle,
    verification.recruitField,
    verification.detailText
  ].join(' '));
  const verificationCompanyTerms = verificationMatchTerms(verification.company, 5);
  const itemCompanyTerms = verificationMatchTerms(item.company, 5);
  const companyMatched = verificationCompanyTerms.some((term) => itemText.includes(term))
    || itemCompanyTerms.some((term) => verificationText.includes(term));
  if (!companyMatched) return false;

  const verificationTitleTerms = verificationMatchTerms([
    verification.baseTitle,
    verification.title,
    verification.recruitField
  ].join(' '), 12);
  const itemTitleTerms = verificationMatchTerms([
    item.baseTitle,
    item.title,
    item.recruitField
  ].join(' '), 12);
  const forwardOverlap = verificationTitleTerms.filter((term) => itemText.includes(term)).length;
  const reverseOverlap = itemTitleTerms.filter((term) => verificationText.includes(term)).length;
  return forwardOverlap >= 2 || reverseOverlap >= 2;
}

function buildRegionalEducationVerificationSource(verification) {
  const url = publicDisplayUrl(verification.primaryOfficialUrl || verification.url);
  const sourceOfficialUrl = publicDisplayUrl(verification.sourceOfficialUrl || verification.originalUrl);
  return {
    source: verification.source,
    sourceName: verification.sourceName,
    title: verification.baseTitle || verification.title,
    company: verification.company,
    url,
    sourceOfficialUrl,
    checkedAt: verification.verifiedAt || CHECKED_AT,
    policy: 'verification-only-no-direct-display'
  };
}

function appendRegionalEducationBriefing(briefing, sources) {
  if (!briefing || !sources.length) return briefing;
  const sourceText = sources
    .map((source) => `${source.sourceName}: ${source.title}`)
    .slice(0, 3)
    .join(' / ');
  const sourceLines = compactTags([
    ...(briefing.sourceLines || []),
    `교육청·학교 보조검증: ${sourceText}`
  ]);
  const teacherShareText = String(briefing.teacherShareText || '').includes('[보조검증]')
    ? briefing.teacherShareText
    : [
      briefing.teacherShareText || '',
      '',
      '[보조검증]',
      `- 지역 교육청·학교 소식은 직접 노출하지 않고 같은 채용인지 확인하는 2차·3차 출처로만 대조했습니다: ${sourceText}`
    ].filter(Boolean).join('\n');
  return {
    ...briefing,
    sourceLines,
    teacherShareText
  };
}

function attachRegionalEducationVerificationSources(items, verificationItems) {
  const usableVerificationItems = (verificationItems || [])
    .filter((item) => isRegionalEducationDisplaySuppressed(item))
    .filter(shouldKeepRegionalEducationVerificationItem);
  if (!usableVerificationItems.length) return items;

  return items.map((item) => {
    const matched = usableVerificationItems
      .filter((verification) => regionalEducationVerificationMatchesItem(item, verification))
      .slice(0, 3);
    if (!matched.length) return item;

    const sources = matched.map(buildRegionalEducationVerificationSource);
    const supplementarySourceUrls = compactTags([
      ...(item.supplementarySourceUrls || []),
      ...sources.flatMap((source) => [source.url, source.sourceOfficialUrl])
    ].filter((url) => {
      const clean = cleanUrl(url);
      return clean && clean !== item.primaryOfficialUrl && clean !== item.url;
    }));
    const note = '지역 교육청·학교 취업지원 소식은 직접 결과 카드로 표시하지 않고, 같은 채용인지 확인하는 2차·3차 보조검증 출처로만 대조했습니다.';
    return {
      ...item,
      supplementarySourceUrls,
      regionalEducationVerification: {
        policy: 'verification-only-no-direct-display',
        count: sources.length,
        sources
      },
      sourceVerification: {
        ...(item.sourceVerification || {}),
        verificationNote: compactTags([
          item.sourceVerification?.verificationNote,
          note
        ]).join(' ')
      },
      teacherBriefing: appendRegionalEducationBriefing(item.teacherBriefing, sources)
    };
  });
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

function sanitizedErrorMessage(error) {
  return normalizeSpace(error?.message || String(error || 'unknown error'))
    .replace(/[A-Za-z0-9_./+=:-]{48,}/g, '[redacted]')
    .slice(0, 180);
}

function sourceFailureResult(sourceId, error) {
  const base = catalogSource(sourceId) || {
    id: sourceId,
    name: sourceId,
    type: 'unknown',
    sourceUrl: '',
    configured: true,
    status: 'active'
  };
  return {
    items: [],
    verificationItems: [],
    status: sourceStatus({ ...base, configured: true }, {
      ok: false,
      isolatedFailure: true,
      errorType: error?.name || 'Error',
      message: `수집원 예외 격리: ${sanitizedErrorMessage(error)}`
    })
  };
}

async function runSource(sourceId, fetcher) {
  try {
    const result = await fetcher();
    if (result?.status) return result;
    throw new Error('수집원이 status를 반환하지 않았습니다.');
  } catch (error) {
    return sourceFailureResult(sourceId, error);
  }
}

async function writeJsonAtomic(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(`${filePath}.tmp`, filePath);
}

const PUBLIC_JOB_ITEM_FIELDS = new Set([
  'id', 'source', 'sourceName', 'sourceId', 'title', 'baseTitle', 'company', 'region',
  'education', 'career', 'employmentType', 'recruitField', 'recruitNumber', 'deadline',
  'deadlineText', 'verifiedAt', 'publishedAt', 'publishedDate', 'firstSeenAt', 'firstSeenDate',
  'collectionAudit', 'fitScore', 'fitLabels', 'processTrack', 'processTrackName', 'writtenExam',
  'processConfidence', 'processLabels', 'processNote', 'studentChannelAssessment', 'sector',
  'sectorName', 'servicePriority', 'servicePolicyLabel', 'detailLevel', 'displayNote',
  'schoolRecommendation', 'status', 'legalCheckFlags', 'guideTags', 'trackName',
  'staleSourceFallback', 'url', 'originalUrl', 'sourceDetailUrl', 'detailText', 'contactAdvice',
  'sourceVerification', 'regionalEducationVerification', 'publicRecruitDetails', 'teacherBriefing', 'attachments',
  'primaryOfficialUrl', 'companyNoticeUrl', 'sourceOfficialUrl', 'officialUrl',
  'attachmentLines', 'supplementarySourceUrls'
]);

function publicJobListItem(item = {}) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => PUBLIC_JOB_ITEM_FIELDS.has(key)));
}

function scrubProtectedMetadata(value) {
  if (Array.isArray(value)) return value.map(scrubProtectedMetadata);
  if (!value || typeof value !== 'object') return value;
  const protectedKeys = new Set([]);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !protectedKeys.has(key))
    .map(([key, child]) => [key, scrubProtectedMetadata(child)]));
}

function encryptJobDetailItem(item, publicKey) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(Buffer.from(item.id, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(item), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const wrappedKey = crypto.publicEncrypt({
    key: publicKey,
    oaepHash: 'sha256',
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
  }, aesKey);
  return {
    wrappedKey: wrappedKey.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function buildProtectedJobArtifacts(payload) {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(JOB_DETAIL_PUBLIC_KEY_SPKI, 'base64'),
    format: 'der',
    type: 'spki'
  });
  const allItems = [...(payload.items || []), ...(payload.archiveItems || [])];
  const vaultItems = {};
  for (const item of allItems) {
    if (!item?.id || vaultItems[item.id]) continue;
    vaultItems[item.id] = encryptJobDetailItem(item, publicKey);
  }
  const publicPayload = scrubProtectedMetadata({
    ...payload,
    detailAccess: {
      policy: 'public-feed-briefing',
      endpoint: 'https://gyo6-law-info-ai.gyo6.workers.dev/api/jobs/{id}',
      protectedFields: [],
      note: '공개 채용공고 원문 URL, 첨부자료, 취업부 브리핑은 jobs.html에서 바로 확인할 수 있도록 공개 피드에 포함합니다.'
    },
    archiveItems: (payload.archiveItems || []).map(publicJobListItem),
    items: (payload.items || []).map(publicJobListItem)
  });
  return {
    publicPayload,
    vault: {
      version: 1,
      generatedAt: payload.generatedAt,
      algorithm: 'RSA-OAEP-256+A256GCM',
      itemCount: Object.keys(vaultItems).length,
      items: vaultItems
    }
  };
}

function isHttpPublicUrl(value) {
  return /^https?:\/\//i.test(normalizeSpace(value));
}

function studentRecruitReviewText(item = {}) {
  const details = item.publicRecruitDetails || {};
  const briefing = item.teacherBriefing || {};
  return normalizeSpace([
    item.title,
    item.baseTitle,
    item.company,
    item.source,
    item.sourceName,
    item.sector,
    item.sectorName,
    item.education,
    item.career,
    item.employmentType,
    item.recruitField,
    item.detailText,
    item.processTrackName,
    item.processNote,
    Array.isArray(item.processLabels) ? item.processLabels.join(' ') : item.processLabels,
    details.hiring,
    details.eligibility,
    details.process,
    ...(Array.isArray(briefing.summaryLines) ? briefing.summaryLines : []),
    ...(Array.isArray(briefing.scheduleLines) ? briefing.scheduleLines : [])
  ].filter(Boolean).join(' '));
}

function importantRecruitSafetySignals(item = {}) {
  const text = studentRecruitReviewText(item);
  const source = catalogSource(item.source);
  const sourceText = normalizeSpace([
    item.source,
    item.sourceName,
    item.sector,
    item.sectorName,
    item.company
  ].join(' '));
  const signals = [];
  if (PUBLIC_RECRUIT_SECTORS.has(item.sector) || source?.trackHint === 'exam' || /(잡알리오|공공기관|공기업|준정부기관|금융권|은행|대기업|상장기업)/.test(sourceText)) {
    signals.push('공공·금융·대기업 소스');
  }
  if (hasExplicitHighSchoolRecruitSignal(text)) signals.push('고졸·특성화고 명시');
  else if (/학력\s*무관/.test(text)) signals.push('학력무관');
  if (hasWrittenExamSignal(text)) signals.push('필기·NCS 신호');
  if (hasRecommendedInternshipSignal(text)) signals.push('인턴·채용연계');
  if (/(공채|공개채용|공개\s*경쟁|블라인드\s*채용)/.test(text)) signals.push('공채 신호');
  if (/(정규직|무기계약직|신입직|신입사원|신입행원|일반직|기술직|사무직|전산직|생산직)/.test(text)) signals.push('신입·정규직 계열');
  return compactTags(signals);
}

function studentRecruitReviewReasons(item = {}, publicationReason = '') {
  const text = studentRecruitReviewText(item);
  const labels = Array.isArray(item.processLabels) ? item.processLabels.join(' ') : normalizeSpace(item.processLabels);
  const reasons = [];
  if (publicationReason) reasons.push(`게시차단:${publicationReason}`);
  if (hasCollegeOnlyApplicantSignal(text)) reasons.push('대학생·학위 전용 제외신호');
  if (hasStudentUnsuitableRecruitSignal(text)) reasons.push('학생추천 부적합 직무');
  if (hasStudentUnsuitableProfessionalRole(text)) reasons.push('전문자격·면허 중심');
  if (/학생추천 제외/.test(labels)) reasons.push('분류:학생추천 제외');
  if (/전문자격 분리/.test(labels)) reasons.push('분류:전문자격 분리');
  if (/현장형 분리/.test(labels)) reasons.push('분류:현장형 분리');
  if (/공채상세 검토대기/.test(labels)) reasons.push('분류:공채상세 검토대기');
  if (item.processTrack === 'direct-interview' && hasWrittenExamSignal(text)) reasons.push('필기신호 직접분류 재검토');
  return compactTags(reasons);
}

function studentRecruitReviewSample(item = {}, listName = 'items', publicationReason = '') {
  const text = studentRecruitReviewText(item);
  const reasons = studentRecruitReviewReasons(item, publicationReason);
  if (!reasons.length) return null;
  const signals = importantRecruitSafetySignals(item);
  const hasImportantSignal = IMPORTANT_PUBLIC_RECRUIT_REVIEW_PATTERN.test(text);
  const hasFormalSourceSignal = signals.includes('공공·금융·대기업 소스');
  if (!hasImportantSignal && signals.length < 2 && !hasFormalSourceSignal) return null;
  return {
    reviewKey: [
      item.source,
      item.sourceId,
      item.company,
      item.baseTitle || item.title,
      item.deadline || item.deadlineText
    ].filter(Boolean).join('|').toLowerCase(),
    list: listName,
    reviewType: '중요 공채 후보 안전검토',
    reason: reasons.join(' · '),
    signals,
    source: item.source || '',
    sourceName: item.sourceName || '',
    sector: item.sector || '',
    company: item.company || '',
    title: shortText(item.title || item.baseTitle || item.id, '제목 확인 필요', 120),
    deadline: item.deadline || '',
    status: item.status || '',
    processTrack: item.processTrack || '',
    primaryOfficialUrl: item.primaryOfficialUrl || item.url || ''
  };
}

function titleIncludesCompanyName(item = {}) {
  const company = companyTitleCompareText(item.company);
  const title = companyTitleCompareText(item.title || item.baseTitle);
  if (!company || !title) return true;
  return title.includes(company);
}

function isKbMainPageRecruitLink(item = {}) {
  const company = normalizeSpace(item.company);
  const title = normalizeSpace(item.title || item.baseTitle);
  const url = normalizeSpace(item.url || item.primaryOfficialUrl).replace(/\/+$/, '');
  return company.includes('KB국민은행')
    && /하계\s*체험형\s*인턴십|고졸·졸업예정\s*채용\s*공고\s*원문\s*확인/.test(title)
    && url === 'https://kbstar.careerlink.kr';
}

function hasMalformedDeadlineText(item = {}) {
  const values = [
    item.deadlineText,
    item.publicRecruitDetails?.application,
    ...(Array.isArray(item.teacherBriefing?.scheduleLines) ? item.teacherBriefing.scheduleLines : [])
  ];
  return values.some((value) => {
    const text = normalizeSpace(value);
    return text && containsStructuredDatePattern(text) && !structuredDateFromText(text);
  });
}

function publicationBlockReason(item = {}) {
  if (!item.id || !item.title || !item.company || !item.sourceName || !item.url || !item.verifiedAt) return 'required-fields';
  if (!isHttpPublicUrl(item.url) || !isHttpPublicUrl(item.primaryOfficialUrl || item.url)) return 'invalid-url';
  if (!['active', 'deadline_soon', 'application_closed', 'needs_review'].includes(item.status)) return `bad-status:${item.status || 'empty'}`;
  if (item.status === 'application_closed' && item.processTrack !== 'exam-formal') return 'closed-direct-item';
  if (isRegionalEducationDisplaySuppressed(item)) return 'regional-education-direct-display';
  if (item.studentChannelAssessment?.hardBlocked) return 'student-hard-blocked';
  if (isUnsuitableForHighSchoolChannel(item)) return 'high-school-unsuitable';
  if (hasMalformedDeadlineText(item)) return 'malformed-deadline';
  if (isUnresolvedDetailedPublicRecruit(item)) return 'unresolved-detailed-public-recruit';
  if (isKbMainPageRecruitLink(item)) return 'kb-main-page-link';
  return '';
}

function normalizePublicationItem(item = {}) {
  let next = { ...item };
  const repairs = [];

  if (!titleIncludesCompanyName(next)) {
    const title = titleWithCompanyName(next.title || next.baseTitle, next.company);
    next = {
      ...next,
      title: next.status === 'application_closed' ? withApplicationClosedSuffix(title.replace(/\(원서 마감\)$/, '')) : title,
      baseTitle: title.replace(/\(원서 마감\)$/, '')
    };
    repairs.push('title-company');
  }

  if (next.status === 'application_closed' && !normalizeSpace(next.title).endsWith('(원서 마감)')) {
    next = { ...next, title: withApplicationClosedSuffix(next.title) };
    repairs.push('closed-title-suffix');
  }

  return { item: next, repairs };
}

function applyPublicationSafetyGuards(items = [], archiveItems = []) {
  const report = {
    policy: 'pre-publication-safety-guard-v1',
    generatedAt: CHECKED_AT,
    blockedCount: 0,
    repairedCount: 0,
    studentRecruitReviewPolicy: 'student-important-recruit-review-queue-v1',
    studentRecruitReviewCount: 0,
    blockedByReason: {},
    repairedByReason: {},
    blockedSamples: [],
    studentRecruitReviewSamples: []
  };
  const reviewKeys = new Set();

  const addStudentRecruitReview = (item, listName, reason = '') => {
    const sample = studentRecruitReviewSample(item, listName, reason);
    if (!sample) return;
    const key = sample.reviewKey || sha([sample.source, sample.company, sample.title, sample.deadline].join('|'));
    if (reviewKeys.has(key)) return;
    reviewKeys.add(key);
    report.studentRecruitReviewCount += 1;
    delete sample.reviewKey;
    if (report.studentRecruitReviewSamples.length < 20) {
      report.studentRecruitReviewSamples.push(sample);
    }
  };

  const guardList = (list, listName) => {
    const safe = [];
    for (const original of list) {
      const { item, repairs } = normalizePublicationItem(original);
      const reason = publicationBlockReason(item);
      if (reason) {
        addStudentRecruitReview(item, listName, reason);
        report.blockedCount += 1;
        report.blockedByReason[reason] = (report.blockedByReason[reason] || 0) + 1;
        if (report.blockedSamples.length < 12) {
          report.blockedSamples.push({
            list: listName,
            reason,
            source: item.source || '',
            company: item.company || '',
            title: item.title || item.id || ''
          });
        }
        continue;
      }
      for (const repair of repairs) {
        report.repairedCount += 1;
        report.repairedByReason[repair] = (report.repairedByReason[repair] || 0) + 1;
      }
      addStudentRecruitReview(item, listName, 'student-recommendation-classification-review');
      safe.push(item);
    }
    return safe;
  };

  return {
    items: guardList(items, 'items'),
    archiveItems: guardList(archiveItems, 'archiveItems'),
    report
  };
}

function buildFeedHealth(payload, safetyReport = null, statusOverride = '') {
  const summary = payload.summary || {};
  const sources = Array.isArray(payload.sourceStatus) ? payload.sourceStatus : [];
  const configuredSources = sources.filter((source) => source.configured);
  const failedConfiguredSources = configuredSources.filter((source) => !source.ok);
  const status = statusOverride
    || (summary.total > 0 && !summary.criticalCoverageMissing && !failedConfiguredSources.length
      ? 'ok'
      : summary.total > 0 ? 'degraded' : 'failed');
  return {
    version: 1,
    generatedAt: CHECKED_AT,
    feedGeneratedAt: payload.generatedAt || '',
    timezone: payload.timezone || 'Asia/Seoul',
    schedule: payload.schedule || '09:10, 14:10, 23:10 KST',
    status,
    summary: {
      total: summary.total || 0,
      active: summary.active || 0,
      deadlineSoon: summary.deadlineSoon || 0,
      applicationClosed: summary.applicationClosed || 0,
      sourcesChecked: sources.length,
      sourcesConfigured: configuredSources.length,
      sourcesFailed: failedConfiguredSources.length,
      criticalCoverageMissing: summary.criticalCoverageMissing || 0,
      staleFallbackItems: summary.staleFallbackItems || 0,
      sourceFallbackProtected: summary.sourceFallbackProtected || 0,
      publicationBlocked: safetyReport?.blockedCount || 0,
      publicationRepaired: safetyReport?.repairedCount || 0,
      studentRecruitSafetyReview: safetyReport?.studentRecruitReviewCount || 0
    },
    sourceFailures: failedConfiguredSources.map((source) => ({
      id: source.id,
      name: source.name,
      isolatedFailure: Boolean(source.isolatedFailure),
      fallbackProtected: Boolean(source.fallbackProtected),
      fallbackItemCount: source.fallbackItemCount || 0,
      message: source.message || ''
    })).slice(0, 20),
    publicationSafety: safetyReport,
    nextOperatorActions: [
      'status가 failed 또는 degraded이면 GitHub Actions의 최신 Update vocational job feed 실행을 확인한다.',
      'publicationSafety.blockedSamples가 있으면 해당 공식 원문에서 마감·자격·URL을 보강한다.',
      'publicationSafety.studentRecruitReviewSamples가 있으면 중요한 공채 후보가 제외·직접분류된 이유와 원문을 확인한다.',
      'sourceFailures의 isolatedFailure가 true인 수집원은 다음 예약 실행에서도 반복되는지 확인한다.'
    ]
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function publicFeedHoldReason(payload, previousItems) {
  if (!previousItems?.size) return '';
  const sources = Array.isArray(payload.sourceStatus) ? payload.sourceStatus : [];
  const failedCoreSources = sources.filter((source) =>
    CORE_PUBLICATION_SOURCE_IDS.has(source.id)
    && source.configured
    && !source.ok
  );
  if (!failedCoreSources.length) return '';
  const protectedCount = failedCoreSources.reduce((sum, source) => sum + Number(source.fallbackItemCount || 0), 0);
  if (protectedCount <= 0) return '';
  return `핵심 수집원 ${failedCoreSources.map((source) => source.name || source.id).join(', ')} 실패로 공개 피드는 직전 정상본을 유지합니다.`;
}

function withPublicationHold(health, reason) {
  if (!reason) return health;
  return {
    ...health,
    status: 'degraded-held',
    publicationHold: {
      heldAt: CHECKED_AT,
      previousFeedPreserved: true,
      reason
    },
    nextOperatorActions: [
      '공개 job-feed.json은 직전 정상본을 유지했습니다. sourceFailures와 publicationHold.reason을 확인합니다.',
      ...(health.nextOperatorActions || [])
    ]
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

function normalizeLegacyProcessTrackLabel(label) {
  if (label === '필기시험 준비 공채' || label === '필기·공식전형') return trackLabel('exam-formal');
  if (label === '필기 없는 채용' || label === '간단 채용') return trackLabel('direct-interview');
  return label;
}

function normalizeLegacyProcessTrackCopy(item = {}) {
  if (!item || typeof item !== 'object') return item;
  const processTrackName = item.processTrack === 'exam-formal'
    ? trackLabel('exam-formal')
    : item.processTrack === 'direct-interview'
      ? trackLabel('direct-interview')
      : normalizeLegacyProcessTrackLabel(item.processTrackName);
  const processLabels = Array.isArray(item.processLabels)
    ? compactTags(item.processLabels.map(normalizeLegacyProcessTrackLabel))
    : item.processLabels;
  const guideTags = Array.isArray(item.guideTags)
    ? compactTags(item.guideTags.map(normalizeLegacyProcessTrackLabel))
    : item.guideTags;
  return {
    ...item,
    processTrackName,
    trackName: processTrackName || normalizeLegacyProcessTrackLabel(item.trackName),
    processLabels,
    guideTags
  };
}

async function readPreviousItems() {
  try {
    const json = await fs.readFile(OUT_FILE, 'utf8');
    const payload = JSON.parse(json);
    const map = new Map();
    const lists = [
      Array.isArray(payload.items) ? payload.items : [],
      Array.isArray(payload.archiveItems) ? payload.archiveItems : []
    ];
    for (const list of lists) {
      for (const item of list) {
        const normalized = normalizeLegacyProcessTrackCopy(item);
        for (const key of previousItemKeys(normalized)) {
          if (!map.has(key)) map.set(key, normalized);
        }
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
    const fallbackAudit = item.collectionAudit || {};
    return {
      ...item,
      firstSeenAt,
      firstSeenDate: formatDate(firstSeenDate),
      collectionAudit: {
        ...collectionAudit,
        missedReviewNeeded: Boolean(collectionAudit.missedReviewNeeded || fallbackAudit.missedReviewNeeded),
        ...(fallbackAudit.fallbackFromPreviousRun ? { fallbackFromPreviousRun: true } : {}),
        ...(fallbackAudit.sourceFallback ? { sourceFallback: true } : {}),
        note: fallbackAudit.sourceFallback || fallbackAudit.fallbackFromPreviousRun
          ? fallbackAudit.note || collectionAudit.note
          : collectionAudit.note
      }
    };
  });
}

function fallbackPreviousItems(previousItems) {
  const seen = new Set();
  const items = [];
  for (const item of previousItems.values()) {
    if (!item?.id || seen.has(item.id)) continue;
    if (!shouldKeep(item)) continue;
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

function fallbackFailedSourceItems(previousItems, sourceStatusList, freshItems) {
  if (!previousItems.size) return [];
  const failedSources = new Set(sourceStatusList
    .filter((source) => source.configured && !source.ok)
    .map((source) => source.id));
  if (!failedSources.size) return [];

  const freshIds = new Set(freshItems.map((item) => item.id));
  const seen = new Set(freshIds);
  const items = [];
  for (const item of previousItems.values()) {
    if (!failedSources.has(item?.source)) continue;
    if (!item?.id || seen.has(item.id)) continue;
    if (!shouldKeep(item)) continue;
    seen.add(item.id);
    items.push({
      ...item,
      staleSourceFallback: true,
      verifiedAt: CHECKED_AT,
      displayNote: `${item.displayNote || '공식 원문 확인 필요'} 현재 실행에서 ${item.sourceName || item.source} 소스가 실패해 직전 정상 데이터를 임시 보존했습니다.`,
      collectionAudit: {
        ...(item.collectionAudit || {}),
        missedReviewNeeded: true,
        fallbackFromPreviousRun: true,
        sourceFallback: true,
        note: `현재 실행에서 ${item.sourceName || item.source} 소스 수집이 실패해 직전 정상 데이터가 임시 보존되었습니다.`
      }
    });
  }
  return items;
}

function annotateSourceFallbackProtection(sourceStatusList, fallbackItems) {
  const fallbackCounts = new Map();
  for (const item of fallbackItems) {
    if (!item?.source) continue;
    fallbackCounts.set(item.source, (fallbackCounts.get(item.source) || 0) + 1);
  }

  return sourceStatusList.map((source) => {
    const fallbackItemCount = fallbackCounts.get(source.id) || 0;
    if (!fallbackItemCount) return source;
    return {
      ...source,
      fallbackProtected: true,
      fallbackItemCount,
      message: source.ok
        ? source.message
        : `${source.message || '연결 실패'} · 직전 정상 공고 ${fallbackItemCount}건 보존`
    };
  });
}

function archiveDedupeKey(item) {
  return [
    item.baseTitle || item.title,
    item.company,
    item.deadline || ''
  ].join('|').toLowerCase();
}

function shouldArchiveItem(item) {
  if (!item?.title || !item.company || !item.url) return false;
  if (item.status !== 'application_closed') return false;
  if (item.processTrack !== 'exam-formal') return false;
  if (isRegionalEducationDisplaySuppressed(item)) return false;
  if (isUnsuitableForHighSchoolChannel(item)) return false;
  return true;
}

function isSupersededGenericArchiveItem(item, currentItems) {
  const title = normalizeSpace(item?.baseTitle || item?.title);
  const url = publicDisplayUrl(item?.url || item?.primaryOfficialUrl || '');
  if (!/고졸·졸업예정\s*채용\s*공고\s*원문\s*확인/.test(title)) return false;
  if (/\/jobs\/RC[A-Za-z0-9_-]+/i.test(url)) return false;
  return currentItems.some((current) => {
    const currentUrl = publicDisplayUrl(current?.url || current?.primaryOfficialUrl || '');
    return current?.source === item.source
      && current?.company === item.company
      && current?.deadline === item.deadline
      && /\/jobs\/RC[A-Za-z0-9_-]+/i.test(currentUrl);
  });
}

function archiveSort(a, b) {
  const deadlineDiff = String(b.deadline || '').localeCompare(String(a.deadline || ''));
  if (deadlineDiff !== 0) return deadlineDiff;
  return String(a.title || '').localeCompare(String(b.title || ''), 'ko-KR');
}

function buildArchiveItems(currentItems, previousItems) {
  const best = new Map();
  const consider = (item) => {
    if (isSupersededGenericArchiveItem(item, currentItems)) return;
    if (!shouldArchiveItem(item)) return;
    const key = archiveDedupeKey(item);
    const existing = best.get(key);
    if (!existing || itemDedupeQuality(item) > itemDedupeQuality(existing)) {
      best.set(key, item);
    }
  };

  currentItems.forEach(consider);
  for (const item of previousItems.values()) consider(item);

  return Array.from(best.values())
    .sort(archiveSort)
    .slice(0, MAX_ARCHIVE_ITEMS);
}

function publicDataKey(...names) {
  return readSecret(...names, 'DATA_GO_KR_SERVICE_KEY');
}

function publicDataApiError(body) {
  const text = htmlText(body).slice(0, 1200);
  const code = getXmlText(body, 'returnReasonCode') || getXmlText(body, 'resultCode') || '';
  const message = getXmlText(body, 'returnAuthMsg') || getXmlText(body, 'resultMsg') || '';
  if (/SERVICE_KEY|INVALID|ERROR|등록되지|인증키|권한/i.test(text) && !/<(item|row)\b/i.test(body)) {
    return normalizeSpace([code, message || text].join(' ')).slice(0, 120);
  }
  return '';
}

function parsePublicDataRecords(body, source, publicSourceUrl) {
  const error = publicDataApiError(body);
  if (error) throw new Error(error);
  return parseGenericOfficialFeed(body, source, publicSourceUrl);
}

function publicJobKeep(item) {
  if (!item.title || !item.company || !item.url) return false;
  if (item.status === 'expired') return false;
  if (isUnresolvedDetailedPublicRecruit(item)) return false;
  if (isUnsuitableForHighSchoolChannel(item)) return false;
  const text = [
    item.title,
    item.company,
    item.education,
    item.career,
    item.employmentType,
    item.detailText,
    item.processTrackName,
    item.sectorName
  ].join(' ');
  const publicYouthTerms = [
    '고졸',
    '고등학교',
    '특성화고',
    '직업계고',
    '마이스터고',
    '기술계고',
    '지역인재',
    '기능인재',
    '9급',
    '공무직',
    '기간제',
    '청년인턴',
    '인턴',
    '신입'
  ];
  const hasPublicYouthTerm = publicYouthTerms.some((term) => text.includes(term));
  const hasStrongHighSchool = hasStrongHighSchoolSignal(item);
  const hasEntrySignal = hasEntryLevelSignal(item);
  const hasEducationOpen = hasEducationOpenSignal(item);
  if (!hasStrongHighSchool && PROFESSIONAL_ONLY_TERMS.some((term) => text.includes(term))) return false;
  return hasPublicYouthTerm || hasEntrySignal || hasEducationOpen || (item.fitScore >= 28 && hasStrongHighSchool);
}

async function fetchPublicDataEndpoint(url, source, publicSourceUrl) {
  const body = await fetchWithTimeout(url, {
    timeoutMs: PUBLIC_API_TIMEOUT_MS,
    headers: { Accept: 'application/json,application/xml,text/xml,*/*;q=0.8' }
  });
  return parsePublicDataRecords(body, source, publicSourceUrl);
}

async function fetchMoefPublicRecruit() {
  const key = publicDataKey('MOEF_PUBLIC_RECRUIT_SERVICE_KEY', 'MOEF_PUBLIC_RECRUIT_API_KEY');
  const base = { ...catalogSource('moef-public-recruit'), configured: Boolean(key) };
  if (!key) {
    return {
      items: [],
      status: sourceStatus(base, { message: 'GitHub Secret MOEF_PUBLIC_RECRUIT_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY 미설정' })
    };
  }

  const attempts = [
    { page: 1, perPage: PUBLIC_DATA_PAGE_SIZE, returnType: 'json' },
    { page: 1, perPage: PUBLIC_DATA_PAGE_SIZE },
    { pageNo: 1, numOfRows: PUBLIC_DATA_PAGE_SIZE, _type: 'json' },
    { pageNo: 1, numOfRows: PUBLIC_DATA_PAGE_SIZE, type: 'json' }
  ];
  const errors = [];
  let rawItems = [];
  let successParams = '';

  for (const params of attempts) {
    const url = buildPublicDataUrl(MOEF_PUBLIC_RECRUIT_LIST_URL, key, params);
    try {
      rawItems = await fetchPublicDataEndpoint(url, base, MOEF_PUBLIC_RECRUIT_DATA_URL);
      successParams = Object.keys(params).join(',');
      break;
    } catch (error) {
      errors.push(error.message);
    }
  }

  const decorateRawItem = (item, companyNoticeCheck = null) => ({
    ...item,
    source: base.id,
    sourceName: base.name,
    sourceDetailUrl: MOEF_PUBLIC_RECRUIT_DATA_URL,
    ...(companyNoticeCheck ? { companyNoticeCheck } : {}),
    description: [item.description, '기재부 공공기관 채용공시 공공기관 잡알리오 공개채용'].join(' ')
  });
  const preliminary = rawItems.map((item) => normalizeItem(decorateRawItem(item))).filter(publicJobKeep);
  const displayItemIds = new Set(preliminary.map((item) => item.id));
  const noticeChecks = new Map();

  for (const item of rawItems) {
    const decorated = decorateRawItem(item);
    const normalizedItem = normalizeItem(decorated);
    if (!displayItemIds.has(normalizedItem.id)) continue;
    if (!decorated.companyNoticeUrl) continue;
    noticeChecks.set(normalizedItem.id, await checkCompanyNoticeUrl(
      decorated.companyNoticeUrl,
      decorated.company,
      decorated.title
    ));
  }

  const normalized = rawItems.map((item) => {
    const decorated = decorateRawItem(item);
    const itemId = normalizeItem(decorated).id;
    return normalizeItem(decorateRawItem(item, noticeChecks.get(itemId)));
  }).filter(publicJobKeep);
  const ok = rawItems.length > 0 || (errors.length < attempts.length && !errors.length);
  const firstDayCandidates = normalized.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const missedReview = normalized.filter((item) => item.collectionAudit?.missedReviewNeeded).length;
  const companyChecked = normalized.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable'
  ].includes(item.sourceVerification?.doubleCheckStatus)).length;

  return {
    items: normalized,
    status: sourceStatus(base, {
      ok,
      itemCount: normalized.length,
      scannedCount: rawItems.length,
      rawItemCount: rawItems.length,
      firstDayCandidates,
      missedReviewNeeded: missedReview,
      message: ok
        ? `기재부 공공기관 채용 API ${rawItems.length}건 점검, 후보 ${normalized.length}건, 공식 공고 접속확인 ${companyChecked}건, 호출방식 ${successParams || '기본'}`
        : `연결 실패: ${errors.slice(0, 2).join('; ')}`
    })
  };
}

function isMpmPublicJobListEndpoint(endpoint) {
  return /PblJobService\/getList/i.test(endpoint);
}

function mpmPublicJobParamAttempts(endpoint) {
  if (!isMpmPublicJobListEndpoint(endpoint)) {
    return [
      { pageNo: 1, numOfRows: PUBLIC_DATA_PAGE_SIZE },
      { pageNo: 1, numOfRows: PUBLIC_DATA_PAGE_SIZE, _type: 'xml' },
      { page: 1, perPage: PUBLIC_DATA_PAGE_SIZE }
    ];
  }

  const attempts = [];
  for (const institutionType of MPM_PUBLIC_JOB_INSTITUTION_TYPES) {
    for (const noticeType of MPM_PUBLIC_JOB_NOTICE_TYPES) {
      attempts.push({
        pageNo: 1,
        numOfRows: PUBLIC_DATA_PAGE_SIZE,
        Pblanc_ty: noticeType,
        Instt_se: institutionType,
        Sort_order: 1
      });
    }
  }
  return attempts;
}

function mpmPublicJobRecordKey(record) {
  return normalizeSpace(record.sourceId)
    || sha([record.title, record.company, record.deadline, record.publishedAt, record.url].join('|'));
}

async function fetchMpmPublicJob() {
  const key = publicDataKey('MPM_PUBLIC_JOB_SERVICE_KEY', 'MPM_PUBLIC_JOB_API_KEY', 'NARAILTER_API_KEY');
  const base = { ...catalogSource('mpm-public-job'), configured: Boolean(key) };
  if (!key) {
    return {
      items: [],
      status: sourceStatus(base, { message: 'GitHub Secret MPM_PUBLIC_JOB_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY 미설정' })
    };
  }

  const configuredUrls = splitSecretUrls(readSecret('MPM_PUBLIC_JOB_API_URL', 'NARAILTER_API_URL'));
  const endpoints = Array.from(new Set([...configuredUrls, ...MPM_PUBLIC_JOB_ENDPOINT_CANDIDATES]));
  const errors = [];
  let rawItems = [];
  let usedEndpoint = '';
  let successScans = 0;

  for (const endpoint of endpoints) {
    const endpointItems = new Map();
    const paramAttempts = mpmPublicJobParamAttempts(endpoint);
    await mapWithConcurrency(paramAttempts, PUBLIC_API_FETCH_CONCURRENCY, async (params) => {
      const url = buildPublicDataUrl(endpoint, key, params);
      try {
        const records = await fetchPublicDataEndpoint(url, base, MPM_PUBLIC_JOB_DATA_URL);
        successScans += 1;
        for (const record of records) {
          endpointItems.set(mpmPublicJobRecordKey(record), record);
        }
      } catch (error) {
        errors.push(`${safePublicFeedUrl(endpoint) || 'candidate'}: ${error.message}`);
      }
    });
    if (endpointItems.size) {
      rawItems = Array.from(endpointItems.values());
      usedEndpoint = safePublicFeedUrl(endpoint) || MPM_PUBLIC_JOB_DATA_URL;
      break;
    }
  }

  const normalized = rawItems.map((item) => normalizeItem({
    ...item,
    source: base.id,
    sourceName: base.name,
    sourceDetailUrl: MPM_PUBLIC_JOB_DATA_URL,
    description: [item.description, '인사혁신처 나라일터 공공취업정보 공무원 지방자치단체 교육청 공공기관 공무직'].join(' ')
  })).filter(publicJobKeep);
  const ok = rawItems.length > 0;
  const firstDayCandidates = normalized.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const missedReview = normalized.filter((item) => item.collectionAudit?.missedReviewNeeded).length;

  return {
    items: normalized,
    status: sourceStatus(base, {
      ok,
      itemCount: normalized.length,
      scannedCount: rawItems.length,
      rawItemCount: rawItems.length,
      firstDayCandidates,
      missedReviewNeeded: missedReview,
      resolvedEndpoint: usedEndpoint,
      message: ok
        ? `인사혁신처 공공취업 API ${rawItems.length}건 점검, 후보 ${normalized.length}건, 공식분류 조회 ${successScans}회`
        : `키 확인됨. 공식 호출 URL 확인 필요: ${errors.slice(0, 2).join('; ')}`
    })
  };
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

  await mapWithConcurrency(requests, requests.length, async (params) => {
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
  });

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

function jobAlioListUrl(params = {}) {
  return buildUrl(JOB_ALIO_RECRUIT_URL, params).toString();
}

function activeCriticalJobAlioItems() {
  return CRITICAL_CURRENT_JOB_ALIO_ITEMS.filter((item) => {
    const distance = daysUntil(parseDate(item.deadline));
    return distance === null || distance >= 0;
  });
}

function makeJobAlioScanTargets() {
  const targets = [];
  for (let pageNo = 1; pageNo <= JOB_ALIO_SCAN_PAGES; pageNo += 1) {
    targets.push({
      id: `recent-page-${pageNo}`,
      url: jobAlioListUrl({ pageNo }),
      reason: 'recent-pages',
      priority: 40 + pageNo
    });
  }
  for (const query of JOB_ALIO_KEYWORD_QUERIES) {
    targets.push({
      id: `keyword-${query.searchType}-${query.keyword}`,
      url: jobAlioListUrl({
        pageNo: 1,
        search_type: query.searchType,
        keyword: query.keyword
      }),
      reason: `keyword:${query.searchType}:${query.keyword}`,
      priority: query.searchType === 'elig' ? 10 : 15
    });
  }
  for (const org of allJobAlioWatchOrgs()) {
    const searchValue = org.orgCode || org.orgName;
    targets.push({
      id: `critical-org-${org.orgCode || sha(org.orgName)}`,
      url: jobAlioListUrl({
        pageNo: 1,
        org_name: searchValue
      }),
      reason: `critical-org:${org.orgName}`,
      priority: 5,
      orgName: org.orgName,
      orgCode: org.orgCode
    });
  }
  return targets;
}

function upsertJobAlioRow(rowsByIdx, row) {
  if (!row?.idx) return;
  const existing = rowsByIdx.get(row.idx);
  if (!existing) {
    rowsByIdx.set(row.idx, {
      ...row,
      scanReasons: compactTags([row.scanReason]),
      priority: row.priority ?? 99
    });
    return;
  }

  rowsByIdx.set(row.idx, {
    ...existing,
    ...row,
    title: existing.title || row.title,
    company: existing.company || row.company,
    region: existing.region || row.region,
    employmentType: existing.employmentType || row.employmentType,
    registeredAt: existing.registeredAt || row.registeredAt,
    deadline: existing.deadline || row.deadline,
    status: existing.status || row.status,
    scanReasons: compactTags([
      ...(existing.scanReasons || []),
      row.scanReason
    ]),
    priority: Math.min(existing.priority ?? 99, row.priority ?? 99)
  });
}

function jobAlioRowAgeDays(row = {}) {
  const registeredDate = parseDate(row.registeredAt || row.publishedAt || '');
  const ageDays = daysBetweenKst(registeredDate, NOW);
  return Number.isFinite(ageDays) ? ageDays : null;
}

function isJobAlioRowActive(row = {}) {
  const deadlineDistance = daysUntil(parseDate(row.deadline || ''));
  return deadlineDistance === null || deadlineDistance >= 0;
}

function isJobAlioRecentDetailRow(row = {}) {
  const ageDays = jobAlioRowAgeDays(row);
  return ageDays !== null
    && ageDays >= 0
    && ageDays <= JOB_ALIO_RECENT_DETAIL_DAYS
    && isJobAlioRowActive(row);
}

function compareJobAlioRowsForDetail(a = {}, b = {}) {
  const aAge = jobAlioRowAgeDays(a);
  const bAge = jobAlioRowAgeDays(b);
  const aRecent = aAge !== null && aAge >= 0 && aAge <= JOB_ALIO_RECENT_DETAIL_DAYS ? aAge : 999;
  const bRecent = bAge !== null && bAge >= 0 && bAge <= JOB_ALIO_RECENT_DETAIL_DAYS ? bAge : 999;
  if (aRecent !== bRecent) return aRecent - bRecent;
  const priorityDiff = (a.priority ?? 99) - (b.priority ?? 99);
  if (priorityDiff !== 0) return priorityDiff;
  const aDeadline = daysUntil(parseDate(a.deadline || ''));
  const bDeadline = daysUntil(parseDate(b.deadline || ''));
  const deadlineDiff = (aDeadline ?? 999) - (bDeadline ?? 999);
  if (deadlineDiff !== 0) return deadlineDiff;
  return String(a.title || '').localeCompare(String(b.title || ''), 'ko-KR');
}

function selectJobAlioRowsForDetail(rowsByIdx) {
  const allRows = Array.from(rowsByIdx.values());
  const recentRows = allRows
    .filter(isJobAlioRecentDetailRow)
    .sort(compareJobAlioRowsForDetail)
    .slice(0, JOB_ALIO_RECENT_DETAIL_LIMIT);
  const selected = new Map();
  const add = (row, dynamicRecentDetail = false) => {
    if (!row?.idx || selected.size >= JOB_ALIO_SCAN_LIMIT) return;
    const existing = selected.get(row.idx) || {};
    selected.set(row.idx, {
      ...existing,
      ...row,
      dynamicRecentDetail: Boolean(existing.dynamicRecentDetail || dynamicRecentDetail)
    });
  };

  recentRows.forEach((row) => add(row, true));
  allRows
    .sort(compareJobAlioRowsForDetail)
    .forEach((row) => add(row, false));

  return {
    rows: Array.from(selected.values()),
    recentRows,
    selectedRecentCount: Array.from(selected.values()).filter((row) => row.dynamicRecentDetail).length
  };
}

function jobAlioStudentSignalText(item = {}) {
  return [
    item.title,
    item.baseTitle,
    item.company,
    item.education,
    item.career,
    item.employmentType,
    item.recruitField,
    item.detailText,
    item.description,
    item.processText,
    item.publicRecruitDetails?.eligibility,
    item.publicRecruitDetails?.process
  ].filter(Boolean).join(' ');
}

function hasJobAlioStudentRecruitSignal(item = {}) {
  const text = jobAlioStudentSignalText(item);
  const explicit = /고졸|고등학교|고교|특성화고|직업계고|마이스터고|졸업예정|졸업\s*예정|고졸\s*(수준|전형|채용|구분|인재)/.test(text);
  const openEducation = /학력\s*무관/.test(text);
  const recruitSignal = /신입|신규직원|공채|공개\s*채용|공개채용|정규직|무기계약직|채용형\s*인턴|채용연계|청년인턴|NCS|직무능력|필기|블라인드\s*채용|일반직|일반행정|행정직|기술직|사무직|전산직|4직급|5급|6급|7급/.test(text);
  return explicit || (openEducation && recruitSignal);
}

function isJobAlioDynamicCurrentCandidate(item = {}) {
  if (item.source !== 'job-alio-openapi') return false;
  if (!['active', 'deadline_soon'].includes(item.status)) return false;
  const publishedDate = parseDate(item.publishedDate || item.publishedAt || item.registeredAt || '');
  const ageDays = daysBetweenKst(publishedDate, NOW);
  if (ageDays === null || ageDays < 0 || ageDays > JOB_ALIO_RECENT_DETAIL_DAYS) return false;
  if (isUnresolvedDetailedPublicRecruit(item) || isUnsuitableForHighSchoolChannel(item)) return false;
  return hasJobAlioStudentRecruitSignal(item);
}

function buildJobAlioDynamicDiscovery(normalizedAll, normalizedKept, rowsByIdx, selectedRows) {
  const allRows = Array.from(rowsByIdx.values());
  const recentRows = allRows.filter(isJobAlioRecentDetailRow);
  const selectedIds = new Set(selectedRows.map((row) => String(row.idx)));
  const keptIds = new Set(normalizedKept.map((item) => String(item.sourceId || '')));
  const currentCandidates = normalizedAll.filter(isJobAlioDynamicCurrentCandidate);
  const missingCandidates = currentCandidates.filter((item) => !keptIds.has(String(item.sourceId || '')));

  return {
    policy: 'dynamic-current-job-alio-detail-scan',
    currentDate: formatDate(NOW),
    recentWindowDays: JOB_ALIO_RECENT_DETAIL_DAYS,
    scanPages: JOB_ALIO_SCAN_PAGES,
    detailLimit: JOB_ALIO_SCAN_LIMIT,
    recentDetailLimit: JOB_ALIO_RECENT_DETAIL_LIMIT,
    recentRowsScanned: recentRows.length,
    recentRowsDetailed: recentRows.filter((row) => selectedIds.has(String(row.idx))).length,
    currentCandidateCount: currentCandidates.length,
    displayedCandidateCount: currentCandidates.filter((item) => keptIds.has(String(item.sourceId || ''))).length,
    missingCandidateCount: missingCandidates.length,
    missingCandidates: missingCandidates.map(reviewItem).slice(0, 12)
  };
}

function extractJobAlioAttachments(html) {
  const attachments = [];
  const seen = new Set();
  const labels = ['공고문', '입사지원서', '직무기술서', '기타 첨부파일'];
  const matches = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']*(?:download|fileNo|file_no|atchFile|recruitFile)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi));

  for (const match of matches) {
    const href = match[1].replace(/&amp;/g, '&');
    let url = '';
    try {
      url = new URL(href, JOB_ALIO_RECRUIT_URL).toString();
    } catch {
      url = '';
    }
    const displayUrl = publicDisplayUrl(url);
    if (!displayUrl || seen.has(displayUrl)) continue;

    const before = html.slice(Math.max(0, match.index - 700), match.index);
    const beforeText = htmlText(before);
    const label = labels.find((candidate) => beforeText.includes(candidate)) || '';
    const title = htmlText(match[2]).replace(/^다운로드\s*/i, '').trim();
    if (!title && !label) continue;

    seen.add(displayUrl);
    attachments.push({
      title: shortText(label && title && !title.includes(label) ? `${label}: ${title}` : (title || label), '공식 첨부자료', 72),
      url: displayUrl
    });
  }

  return attachments.slice(0, 8);
}

async function fetchJobAlioDetail(row) {
  const detailUrl = `https://job.alio.go.kr/recruitview.do?idx=${encodeURIComponent(row.idx)}`;
  const retryTimeouts = (row.priority ?? 99) <= 5 ? JOB_ALIO_CRITICAL_DETAIL_RETRY_TIMEOUTS_MS : [JOB_ALIO_DETAIL_TIMEOUT_MS];
  let html = '';
  try {
    html = await fetchTextWithRetries(detailUrl, {}, retryTimeouts, `job-alio-detail-${row.idx}`);
  } catch (error) {
    const mobileDetailUrl = `https://job.alio.go.kr/mobile2021/recruit/recruitView.do?idx=${encodeURIComponent(row.idx)}`;
    html = await fetchTextWithRetries(mobileDetailUrl, {}, retryTimeouts, `job-alio-mobile-detail-${row.idx}`);
  }
  const text = htmlText(html);
  const originalUrl = text.match(/(?:공고 URL|원문 URL)\s*:?\s*(https?:\/\/\S+)/);
  const period = text.match(/채용기간\s*(\d{2}\.\d{2}\.\d{2}|\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{2}\.\d{2}\.\d{2}|\d{4}\.\d{2}\.\d{2})/);
  const education = extractBetween(text, '학력정보', '근무분야') || '원문 확인';
  const workField = extractBetween(text, '근무분야', '채용구분');
  const career = extractBetween(text, '채용구분', '고용형태') || '원문 확인';
  const employmentType = extractBetween(text, '고용형태', '대체인력여부') || row.employmentType;
  const region = extractBetween(text, '근무지', '급여정보') || row.region;
  const qualification = extractBetween(text, '응시자격', '결격사유');
  const preference = extractBetween(text, '우대내용', '전형절차/방법');
  const processText = extractBetween(text, '전형절차/방법', '공고문');
  const deadline = String(row.deadline || '').match(/\d{2}\.\d{2}\.\d{2}|\d{4}\.\d{2}\.\d{2}/)?.[0] || period?.[2] || row.deadline;
  const publishedAt = row.registeredAt || period?.[1] || text.match(/등록일\s*(\d{4}\.\d{2}\.\d{2}|\d{2}\.\d{2}\.\d{2})/)?.[1] || '';
  const companyNoticeUrl = await resolveOfficialNoticeUrl(originalUrl ? cleanUrl(originalUrl[1]) : '', row.title, row.company);
  const companyNoticeCheck = await checkCompanyNoticeUrl(companyNoticeUrl, row.company, row.title);
  const attachments = extractJobAlioAttachments(html);

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
    recruitField: workField,
    qualification,
    deadline,
    deadlineText: deadline ? `${deadline} 마감` : '마감일 원문 확인',
    publishedAt,
    url: companyNoticeUrl || detailUrl,
    originalUrl: detailUrl,
    sourceDetailUrl: detailUrl,
    companyNoticeUrl,
    companyNoticeCheck,
    attachments,
    processText,
    description: [
      workField,
      qualification,
      preference,
      processText,
      attachments.map((item) => item.title).join(' '),
      row.status,
      '잡알리오 공공기관 채용'
    ].join(' ')
  };
}

function jobAlioCriticalFallbackRawItem(row = {}, critical = {}) {
  const idx = String(row.idx || critical.idx || '').trim();
  const detailUrl = `https://job.alio.go.kr/recruitview.do?idx=${encodeURIComponent(idx)}`;
  const bodyHint = [...(critical.titleTerms || []), ...(critical.bodyTerms || [])].join(' ');
  const education = /학력\s*무관/.test(bodyHint)
    ? '학력무관'
    : (/고졸|고등학교|특성화고|직업계고|마이스터고/.test(bodyHint) ? '고졸' : '원문 확인');
  const employmentType = /(무기계약직|정규직|채용형\s*인턴|채용형인턴|신입직원|신입사원|4직급|5급|6급|7급)/.test(bodyHint)
    ? keywordSnippet(bodyHint, ['무기계약직', '정규직', '채용형 인턴', '채용형인턴', '신입직원', '신입사원', '4직급', '5급', '6급', '7급'], '공식 공채 원문 확인', 80)
    : '공식 공채 원문 확인';

  return {
    source: 'job-alio-openapi',
    sourceName: '잡알리오 공공기관 채용',
    sourceId: idx,
    title: row.title || critical.titleHint || `${critical.company || row.company || '공공기관'} 채용 공고`,
    company: row.company || critical.company || '',
    region: row.region || '원문 확인',
    education,
    career: '신입·공채 원문 확인',
    employmentType,
    deadline: row.deadline || critical.deadline || '',
    publishedAt: row.registeredAt || '',
    url: detailUrl,
    originalUrl: detailUrl,
    sourceDetailUrl: detailUrl,
    description: normalizeSpace([
      '핵심 공채 감시 대상입니다.',
      '상세 원문 확인이 일시 실패해도 누락 방지를 위해 공식 잡알리오 상세 링크를 보존합니다.',
      bodyHint
    ].join(' ')),
    processText: normalizeSpace([
      '공식 공채',
      '전형절차 원문 확인',
      bodyHint
    ].join(' ')),
    applicationMethod: '잡알리오 공식 상세 공고에서 접수 방법 확인',
    attachments: []
  };
}

async function fetchJobAlioRecruit() {
  const base = { ...catalogSource('job-alio-openapi'), configured: true };
  const rawItems = [];
  const errors = [];
  const rowsByIdx = new Map();
  let scannedCount = 0;
  let scanTargetCount = 0;

  await mapWithConcurrency(makeJobAlioScanTargets(), JOB_ALIO_LIST_FETCH_CONCURRENCY, async (target) => {
    try {
      const retryTimeouts = target.priority <= 5 ? JOB_ALIO_CRITICAL_LIST_RETRY_TIMEOUTS_MS : JOB_ALIO_LIST_RETRY_TIMEOUTS_MS;
      const html = await fetchTextWithRetries(target.url, {}, retryTimeouts, target.id);
      const rows = parseJobAlioRows(html);
      scannedCount += rows.length;
      scanTargetCount += 1;
      for (const row of rows) {
        upsertJobAlioRow(rowsByIdx, {
          ...row,
          company: row.company || target.orgName || '',
          scanReason: target.reason,
          priority: target.priority
        });
      }
    } catch (error) {
      errors.push(`${target.id}: ${sanitizeFetchErrorMessage(error.message)}`);
    }
  });

  for (const item of activeCriticalJobAlioItems()) {
    upsertJobAlioRow(rowsByIdx, {
      idx: item.idx,
      title: item.titleHint,
      company: item.company,
      deadline: item.deadline,
      scanReason: `critical-current:${item.id}`,
      priority: 0
    });
  }

  const rowSelection = selectJobAlioRowsForDetail(rowsByIdx);
  const rows = rowSelection.rows;

  const details = await mapWithConcurrency(rows, DETAIL_FETCH_CONCURRENCY, async (row) => {
    try {
      return await fetchJobAlioDetail(row);
    } catch (error) {
      errors.push(`${row.idx}: ${sanitizeFetchErrorMessage(error.message)}`);
      return null;
    }
  });
  const detailItems = details.filter(Boolean);
  rawItems.push(...detailItems);
  const keptDetailIds = new Set(rawItems.map(normalizeItem).filter(shouldKeep).map((item) => String(item.sourceId || '')));
  const criticalFallbackItems = activeCriticalJobAlioItems()
    .filter((critical) => !keptDetailIds.has(String(critical.idx || '')))
    .map((critical) => jobAlioCriticalFallbackRawItem(rowsByIdx.get(critical.idx) || {}, critical));
  rawItems.push(...criticalFallbackItems);

  const normalizedAll = rawItems.map(normalizeItem);
  const normalized = normalizedAll.filter(shouldKeep);
  const dynamicDiscovery = buildJobAlioDynamicDiscovery(normalizedAll, normalized, rowsByIdx, rows);
  const ok = rawItems.length > 0 && errors.length < Math.max(1, rawItems.length);
  const companyChecked = normalized.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable',
    'job_alio_detail_confirmed'
  ].includes(item.sourceVerification?.doubleCheckStatus)).length;
  const firstDayCandidates = normalized.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const missedReview = normalized.filter((item) => item.collectionAudit?.missedReviewNeeded).length;
  const criticalCoverage = buildCriticalJobAlioCoverage(normalized);
  return {
    items: normalized,
    status: sourceStatus(base, {
      ok,
      itemCount: normalized.length,
      scannedCount,
      scanTargetCount,
      candidateRowCount: rowsByIdx.size,
      rawItemCount: rawItems.length,
      recentDetailRows: rowSelection.recentRows.length,
      selectedRecentDetailRows: rowSelection.selectedRecentCount,
      dynamicDiscovery,
      criticalCoverage,
      firstDayCandidates,
      missedReviewNeeded: missedReview,
      message: ok
        ? `공식 공개 원문 ${scannedCount}건/${rowsByIdx.size}후보 점검, 최근 ${JOB_ALIO_RECENT_DETAIL_DAYS}일 상세 ${dynamicDiscovery.recentRowsDetailed}/${dynamicDiscovery.recentRowsScanned}건, 표시누락 ${dynamicDiscovery.missingCandidateCount}건, 공식 공고 확인 ${companyChecked}건`
        : `연결 실패: ${errors.slice(0, 2).join('; ')}`
    })
  };
}

function extractFirstUrl(value) {
  const raw = String(value || '').replace(/&amp;/g, '&');
  const match = raw.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return '';
  return cleanUrl(match[0].replace(/[),.;]+$/g, ''));
}

function parseSeoulHighJobRows(html, pageIndex) {
  const rows = Array.from(html.matchAll(/<li>\s*<a\s+href=["']javascript:fncDetailView\('([^']+)'\);["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi));
  return rows
    .map((match) => {
      const block = match[2];
      const titleHtml = block.match(/<h4\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i)?.[1] || '';
      const title = htmlText(titleHtml).replace(/새글 표시 아이콘/g, '').trim();
      const jobType = htmlText(block.match(/채용직종\s*:\s*([\s\S]*?)<\/p>/i)?.[1] || '');
      const publishedAt = normalizeSpace(block.match(/등록일\s*:\s*([0-9.\-\s]+)/i)?.[1] || '');
      const listNumber = htmlText(block.match(/<span\b[^>]*class=["'][^"']*number[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
      if (!match[1] || !title) return null;
      return {
        seq: match[1],
        listNumber,
        title,
        jobType,
        publishedAt,
        pageIndex
      };
    })
    .filter(Boolean);
}

function seoulHighJobPostBody(params) {
  return new URLSearchParams(params).toString();
}

async function fetchSeoulHighJobListPage(pageIndex) {
  if (pageIndex <= 1) {
    return fetchWithTimeout(SEOUL_HIGHJOB_RECRUIT_URL);
  }
  return fetchWithTimeout(SEOUL_HIGHJOB_RECRUIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: seoulHighJobPostBody({
      pageIndex: String(pageIndex),
      searchCondition: '',
      searchKeyword: ''
    })
  });
}

function parseSeoulHighJobTableFields(html) {
  const fields = {};
  const rows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (match) => match[1]);
  for (const row of rows) {
    const pairs = Array.from(row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi));
    for (const pair of pairs) {
      const key = htmlText(pair[1]);
      const value = htmlText(pair[2]);
      if (key && value && !fields[key]) fields[key] = value;
    }
  }
  return fields;
}

function fieldValue(fields, ...labels) {
  for (const label of labels) {
    if (fields[label]) return fields[label];
  }
  return '';
}

function parseSeoulHighJobAttachments(html) {
  return Array.from(html.matchAll(/<a\s+href=['"]([^'"]*fileDownload[^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => ({
      url: new URL(match[1].replace(/&amp;/g, '&'), SEOUL_HIGHJOB_RECRUIT_URL).toString(),
      title: htmlText(match[2]).replace(/이미지/g, '').trim()
    }))
    .filter((item) => item.title)
    .slice(0, 4);
}

async function fetchSeoulHighJobDetail(row) {
  const html = await fetchWithTimeout(SEOUL_HIGHJOB_DETAIL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: seoulHighJobPostBody({
      job_seq: row.seq,
      pageIndex: String(row.pageIndex || 1),
      pageUnit: '10',
      searchCondition: '',
      searchKeyword: ''
    })
  });
  const fields = parseSeoulHighJobTableFields(html);
  const title = htmlText(html.match(/<div\b[^>]*class=["'][^"']*view-title[^"']*["'][^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || row.title);
  const company = fieldValue(fields, '기업명') || row.title.replace(/^\[[^\]]+\]\s*/, '').split(/\s+채용/)[0];
  const jobType = fieldValue(fields, '채용직종') || row.jobType;
  const employmentType = fieldValue(fields, '고용형태');
  const region = fieldValue(fields, '근무지역') || '서울 또는 원문 확인';
  const deadline = fieldValue(fields, '지원마감');
  const application = fieldValue(fields, '접수방법');
  const homepage = fieldValue(fields, '홈페이지');
  const companyNoticeUrl = extractFirstUrl(application) || extractFirstUrl(homepage);
  const processText = fieldValue(fields, '전형방법');
  const other = fieldValue(fields, '기타');
  const attachments = parseSeoulHighJobAttachments(html);
  const recruitNumber = fieldValue(fields, '모집인원');
  const contact = fieldValue(fields, '담당자', '문의처', '연락처');
  const companyNoticeCheck = companyNoticeUrl
    ? await checkCompanyNoticeUrl(companyNoticeUrl, company, title)
    : {};

  return {
    source: 'seoul-highjob',
    sourceName: '서울특별시교육청 하이잡 채용정보',
    sourceId: row.seq,
    title,
    company,
    region,
    education: includesAny([title, company, jobType, other, attachments.map((item) => item.title).join(' ')].join(' '), STRONG_TERMS)
      ? '고졸·특성화고 관련 원문 확인'
      : '서울특별시교육청 하이잡 원문 확인',
    career: fieldValue(fields, '경력조건') || '원문 확인',
    employmentType,
    recruitField: jobType,
    recruitNumber,
    applicationMethod: application,
    contact,
    attachments,
    deadline,
    deadlineText: deadline ? `${deadline} 마감` : '마감일 원문 확인',
    publishedAt: row.publishedAt,
    url: companyNoticeUrl || SEOUL_HIGHJOB_RECRUIT_URL,
    originalUrl: SEOUL_HIGHJOB_RECRUIT_URL,
    sourceDetailUrl: SEOUL_HIGHJOB_RECRUIT_URL,
    companyNoticeUrl,
    companyNoticeCheck,
    processText,
    description: [
      jobType,
      fieldValue(fields, '모집인원'),
      fieldValue(fields, '업무내용'),
      other,
      application,
      attachments.map((item) => item.title).join(' '),
      '서울특별시교육청 하이잡 특성화고 직업계고 취업지원센터 공식 채용정보'
    ].join(' ')
  };
}

function keepSeoulHighJobItem(item) {
  if (!shouldKeepRegionalEducationVerificationItem(item)) return false;
  if (item.deadline) return true;
  const publishedDate = parseDate(item.publishedDate || item.publishedAt);
  if (!publishedDate) return true;
  const ageDays = daysBetweenKst(publishedDate, NOW);
  return ageDays === null || ageDays <= 45;
}

async function fetchSeoulHighJobRecruit() {
  const base = { ...catalogSource('seoul-highjob'), configured: true };
  const rawItems = [];
  const errors = [];
  let scannedCount = 0;
  const detailRows = [];

  for (let pageIndex = 1; pageIndex <= SEOUL_HIGHJOB_SCAN_PAGES; pageIndex += 1) {
    try {
      const html = await fetchSeoulHighJobListPage(pageIndex);
      const rows = parseSeoulHighJobRows(html, pageIndex);
      scannedCount += rows.length;
      detailRows.push(...rows);
    } catch (error) {
      errors.push(`page ${pageIndex}: ${error.message}`);
    }
  }

  const details = await mapWithConcurrency(detailRows, DETAIL_FETCH_CONCURRENCY, async (row) => {
    try {
      return await fetchSeoulHighJobDetail(row);
    } catch (error) {
      errors.push(`${row.seq}: ${error.message}`);
      return null;
    }
  });
  rawItems.push(...details.filter(Boolean));

  const verificationItems = rawItems.map(normalizeItem).filter(keepSeoulHighJobItem);
  const ok = rawItems.length > 0 && errors.length < Math.max(1, rawItems.length);
  const companyChecked = verificationItems.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable'
  ].includes(item.sourceVerification?.doubleCheckStatus)).length;
  const firstDayCandidates = verificationItems.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const missedReview = verificationItems.filter((item) => item.collectionAudit?.missedReviewNeeded).length;

  return {
    items: [],
    verificationItems,
    status: sourceStatus(base, {
      ok,
      itemCount: 0,
      verificationItemCount: verificationItems.length,
      scannedCount,
      rawItemCount: rawItems.length,
      firstDayCandidates,
      missedReviewNeeded: missedReview,
      message: ok
        ? `서울 하이잡 공식 목록 ${scannedCount}건 점검, 보조검증 후보 ${verificationItems.length}건, 공식 공고 확인 ${companyChecked}건, 첫날 수집 ${firstDayCandidates}건, 누락점검 ${missedReview}건`
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

  const queries = [
    '고졸',
    '특성화고',
    '직업계고',
    '마이스터고',
    '학교장 추천',
    '고졸 금융권',
    '고졸 은행',
    '특성화고 금융',
    '고졸 대기업',
    '특성화고 대기업',
    '마이스터고 대기업',
    '고졸 공채'
  ];
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

async function fetchGenericConfiguredSource(id) {
  const source = catalogSource(id);
  const config = GENERIC_OFFICIAL_SOURCE_CONFIG[id];
  if (!source || !config) {
    return disabledSource(id, source?.name || id, source?.message || '공식 연계 정보 확인 대기', source?.sourceUrl || '');
  }

  const entries = officialFeedEntriesForSource(id, config);
  const builtInFeedCount = entries.filter((entry) => entry.builtIn).length;
  const configuredFeedCount = entries.filter((entry) => entry.configured).length;
  const watchEmployers = Array.from(new Set(entries
    .map((entry) => normalizeSpace(entry.employer))
    .filter((name) => name && name !== '사용자 설정 공식 피드')))
    .slice(0, 160);
  const key = readSecret(...(config.keySecrets || []));
  const configured = entries.length > 0 || Boolean(key);
  if (!entries.length) {
    return {
      items: [],
      status: sourceStatus({ ...source, configured }, {
        ok: false,
        message: configured
          ? `${config.urlSecrets.join(' 또는 ')} 미설정: 공식 API URL 또는 허용된 피드 URL 필요`
          : source.message || config.setupHint
      })
    };
  }

  const requestHeaders = {
    Accept: 'application/json,application/xml,text/xml,text/html;q=0.9,*/*;q=0.7',
    ...(key ? { Authorization: `Bearer ${key}`, 'X-API-Key': key } : {})
  };
  const entryTimeoutMs = (entry) => {
    const timeoutMs = Number(entry?.timeoutMs);
    return Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : entry.builtIn ? OFFICIAL_WATCH_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  };
  const entryCandidateUrls = (entry, primaryUrl = entry?.url) => Array.from(new Set([
    primaryUrl,
    ...(Array.isArray(entry?.fallbackUrls) ? entry.fallbackUrls : [])
  ]
    .map((url) => normalizeSpace(url))
    .filter(Boolean)));
  const fetchEntryBody = async (entry, primaryUrl = entry.url) => {
    let lastError = null;
    for (const sourceUrl of entryCandidateUrls(entry, primaryUrl)) {
      try {
        const requestUrl = injectSecretIntoUrl(sourceUrl, key);
        const body = await fetchWithTimeout(requestUrl, {
          timeoutMs: entryTimeoutMs(entry),
          headers: requestHeaders
        });
        return { body, sourceUrl };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('official feed fetch failed');
  };
  const isEntryReachable = async (entry) => {
    for (const sourceUrl of entryCandidateUrls(entry)) {
      const reachable = await checkUrlReachable(sourceUrl, {
        headers: requestHeaders
      }, Math.min(REACHABILITY_TIMEOUT_MS, entryTimeoutMs(entry)));
      if (reachable) return true;
    }
    return false;
  };

  const verificationOnlyRegionalEducation = id === 'regional-education-job';
  const rawItems = [];
  const errors = [];
  let checkedUrlCount = 0;
  let reachabilityOnlyCount = 0;
  let recruiterApiCheckedCount = 0;
  let recruiterApiTotalCount = 0;
  let recruiterApiCurrentCount = 0;
  let recruiterApiRecordCount = 0;
  const reachabilityOnlyEmployers = [];
  const recruiterApiFailures = [];
  const results = await mapWithConcurrency(entries, GENERIC_OFFICIAL_FEED_CONCURRENCY, async (entry) => {
    try {
      let { body, sourceUrl } = await fetchEntryBody(entry);
      for (let redirectCount = 0; redirectCount < 2; redirectCount += 1) {
        const redirectUrl = extractHtmlRedirectUrl(body, sourceUrl);
        if (!redirectUrl) break;
        sourceUrl = redirectUrl;
        const requestUrl = injectSecretIntoUrl(sourceUrl, key);
        body = await fetchWithTimeout(requestUrl, {
          timeoutMs: entryTimeoutMs(entry),
          headers: requestHeaders
        });
      }
      const records = [...parseGenericOfficialFeed(body, source, sourceUrl, entry)];
      let recruiterApiResult = { checked: false, records: [] };
      let recruiterApiError = '';
      if (entry.builtIn && recruiterJobflexPrefixFromUrl(sourceUrl)) {
        try {
          recruiterApiResult = await fetchRecruiterJobflexRecords(source, sourceUrl, entry);
          records.push(...recruiterApiResult.records);
        } catch (apiError) {
          recruiterApiError = sanitizeFetchErrorMessage(apiError.message);
        }
      }
      return {
        ok: true,
        entry,
        records,
        recordCount: records.length,
        url: safePublicFeedUrl(sourceUrl),
        recruiterApiChecked: recruiterApiResult.checked,
        recruiterApiTotalCount: recruiterApiResult.totalCount || 0,
        recruiterApiCurrentCount: recruiterApiResult.currentCount || 0,
        recruiterApiRecordCount: recruiterApiResult.records?.length || 0,
        recruiterApiError
      };
    } catch (error) {
      if (entry.builtIn && recruiterJobflexPrefixFromUrl(entry.url)) {
        try {
          const recruiterApiResult = await fetchRecruiterJobflexRecords(source, entry.url, entry);
          return {
            ok: true,
            entry,
            records: recruiterApiResult.records,
            recordCount: recruiterApiResult.records.length,
            url: safePublicFeedUrl(entry.url),
            recruiterApiChecked: recruiterApiResult.checked,
            recruiterApiTotalCount: recruiterApiResult.totalCount || 0,
            recruiterApiCurrentCount: recruiterApiResult.currentCount || 0,
            recruiterApiRecordCount: recruiterApiResult.records?.length || 0,
            recruiterApiError: '',
            htmlFetchError: sanitizeFetchErrorMessage(error.message)
          };
        } catch (apiError) {
          const combinedError = `${sanitizeFetchErrorMessage(error.message)}; recruiter API ${sanitizeFetchErrorMessage(apiError.message)}`;
          return {
            ok: false,
            entry,
            records: [],
            recordCount: 0,
            url: safePublicFeedUrl(entry.url),
            recruiterApiChecked: false,
            recruiterApiError: combinedError,
            error: combinedError
          };
        }
      }
      const reachableOnly = entry.builtIn ? await isEntryReachable(entry) : false;
      if (reachableOnly) {
        return {
          ok: true,
          entry,
          records: [],
          recordCount: 0,
          url: safePublicFeedUrl(entry.url),
          reachabilityOnly: true
        };
      }
      return {
        ok: false,
        entry,
        records: [],
        recordCount: 0,
        url: safePublicFeedUrl(entry.url),
        error: sanitizeFetchErrorMessage(error.message)
      };
    }
  });

  for (const result of results) {
    if (result.ok) {
      checkedUrlCount += 1;
      if (result.recruiterApiChecked) {
        recruiterApiCheckedCount += 1;
        recruiterApiTotalCount += result.recruiterApiTotalCount || 0;
        recruiterApiCurrentCount += result.recruiterApiCurrentCount || 0;
        recruiterApiRecordCount += result.recruiterApiRecordCount || 0;
      }
      if (result.recruiterApiError) {
        recruiterApiFailures.push(`${result.entry.employer || result.url}: ${result.recruiterApiError}`);
      }
      if (result.reachabilityOnly) {
        reachabilityOnlyCount += 1;
        reachabilityOnlyEmployers.push(result.entry.employer || result.url);
      }
      rawItems.push(...result.records);
    } else {
      errors.push(`${result.entry.employer || result.url}: ${result.error}`);
    }
  }

  await enrichCompanyNoticeChecks(rawItems);
  const normalizedAll = rawItems.map(normalizeItem);
  const normalized = verificationOnlyRegionalEducation ? [] : normalizedAll.filter(shouldKeep);
  const verificationItems = verificationOnlyRegionalEducation
    ? normalizedAll.filter(shouldKeepRegionalEducationVerificationItem)
    : [];
  const ok = checkedUrlCount > 0 && errors.length < entries.length;
  return {
    items: normalized,
    verificationItems,
    status: sourceStatus({ ...source, configured: true }, {
      ok,
      itemCount: normalized.length,
      verificationItemCount: verificationItems.length,
      scannedCount: rawItems.length,
      configuredFeedCount,
      builtInFeedCount,
      watchEmployerCount: watchEmployers.length,
      watchEmployers,
      checkedUrlCount,
      reachabilityOnlyCount,
      reachabilityOnlyEmployers,
      recruiterApiCheckedCount,
      recruiterApiTotalCount,
      recruiterApiCurrentCount,
      recruiterApiRecordCount,
      recruiterApiFailures: recruiterApiFailures.slice(0, 12),
      failedUrlCount: errors.length,
      watchFailures: errors.slice(0, 12),
      message: ok
        ? `공식 채용 페이지 ${checkedUrlCount}/${entries.length}개 감시, 채용대행 API ${recruiterApiCheckedCount}개 추가확인, 표시후보 ${normalized.length}건, 보조검증 후보 ${verificationItems.length}건, 접속확인전용 ${reachabilityOnlyCount}개, 실패 ${errors.length}개`
        : `연결 실패: ${errors.slice(0, 2).join('; ')}`
    })
  };
}

async function pendingCatalogSources() {
  const pending = SOURCE_CATALOG.filter((item) => item.status !== 'active');
  return mapWithConcurrency(pending, PENDING_SOURCE_CONCURRENCY, (source) => (
    runSource(source.id, () => fetchGenericConfiguredSource(source.id))
  ));
}

function sourceSecretState(source, status) {
  const onboarding = SOURCE_ONBOARDING[source.id] || {};
  const allSecrets = secretNamesForSource(source);
  const genericConfig = GENERIC_OFFICIAL_SOURCE_CONFIG[source.id];
  const builtInFeedCount = genericConfig
    ? officialFeedEntriesForSource(source.id, genericConfig).filter((entry) => entry.builtIn).length
    : builtInOfficialFeedEntriesForSource(source.id).length;
  const requiredSecrets = builtInFeedCount ? [] : allSecrets;
  const optionalSecretNames = builtInFeedCount ? allSecrets : [];
  const configuredSecrets = requiredSecrets.filter(hasSecret);
  const missingSecrets = requiredSecrets.filter((secretName) => !hasSecret(secretName));
  const configuredOptionalSecrets = optionalSecretNames.filter(hasSecret);
  const urlSecrets = genericConfig?.urlSecrets || [];
  const configuredUrls = genericConfig ? configuredUrlsForSource(genericConfig).length : 0;
  const keySecrets = genericConfig?.keySecrets || [];
  const requiredUrlReady = !urlSecrets.length || configuredUrls > 0 || builtInFeedCount > 0;
  const keyReady = !keySecrets.length || keySecrets.some(hasSecret);
  const activeWithoutSecret = source.status === 'active' && !requiredSecrets.length;
  const ready = activeWithoutSecret
    || status?.ok
    || (source.id === 'mpm-public-job' ? Boolean(publicDataKey('MPM_PUBLIC_JOB_SERVICE_KEY', 'MPM_PUBLIC_JOB_API_KEY', 'NARAILTER_API_KEY')) : false)
    || (source.id === 'moef-public-recruit' ? Boolean(publicDataKey('MOEF_PUBLIC_RECRUIT_SERVICE_KEY', 'MOEF_PUBLIC_RECRUIT_API_KEY')) : false)
    || (source.id === 'work24-open-recruit' ? Boolean(readSecret('WORK24_AUTH_KEY', 'WORKNET_AUTH_KEY')) : false)
    || (source.id === 'saramin-job-search' ? Boolean(readSecret('SARAMIN_ACCESS_KEY')) : false)
    || (Boolean(genericConfig) && requiredUrlReady && keyReady);

  return {
    id: source.id,
    name: source.name,
    priority: onboarding.priority || 'P3',
    readiness: source.status,
    type: source.type,
    requiredSecrets,
    optionalSecretNames,
    configuredSecretNames: configuredSecrets,
    configuredOptionalSecretNames: configuredOptionalSecrets,
    missingSecretNames: missingSecrets,
    configuredFeedCount: configuredUrls,
    builtInFeedCount,
    setupStatus: ready ? 'ready' : configuredSecrets.length || configuredUrls ? 'partial' : 'missing',
    canAttemptImmediately: ready,
    adapter: source.status === 'active' ? 'native' : genericConfig ? 'generic-official-feed' : 'pending',
    actionLabel: onboarding.actionLabel || '공식 연계 경로 확인',
    impact: onboarding.impact || '특성화고 공개채용 정보 확보 범위를 넓힌다.',
    setupHint: genericConfig?.setupHint || source.message || '공식 API 또는 허용된 피드 경로 확인 필요',
    easySteps: onboarding.easySteps || ['공식 API 또는 허용된 피드 경로를 확인한다.', '확보된 Secret 이름을 GitHub Actions Secrets에 저장한다.']
  };
}

function buildSecretReadinessReport(sourceStatusList) {
  const statusById = new Map(sourceStatusList.map((status) => [status.id, status]));
  const sources = SOURCE_CATALOG.map((source) => sourceSecretState(source, statusById.get(source.id)));
  const priorityQueue = sources
    .filter((source) => !source.canAttemptImmediately)
    .sort((a, b) => {
      const priorityDiff = (SOURCE_PRIORITY_WEIGHT[a.priority] ?? 9) - (SOURCE_PRIORITY_WEIGHT[b.priority] ?? 9);
      if (priorityDiff !== 0) return priorityDiff;
      const orderDiff = (SOURCE_CATALOG_ORDER.get(a.id) ?? 999) - (SOURCE_CATALOG_ORDER.get(b.id) ?? 999);
      if (orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name, 'ko-KR');
    })
    .map((source) => ({
      id: source.id,
      name: source.name,
      priority: source.priority,
      actionLabel: source.actionLabel,
      missingSecretNames: source.missingSecretNames,
      setupHint: source.setupHint,
      easySteps: source.easySteps
    }));
  return {
    status: sources.every((source) => source.canAttemptImmediately) ? 'all_ready' : 'needs_secrets_or_official_feeds',
    generatedAt: CHECKED_AT,
    totalSources: sources.length,
    readySources: sources.filter((source) => source.canAttemptImmediately).length,
    partialSources: sources.filter((source) => source.setupStatus === 'partial').length,
    missingSources: sources.filter((source) => source.setupStatus === 'missing').length,
    sources,
    priorityQueue,
    easiestNextAction: priorityQueue[0] || null,
    nextSecretNames: Array.from(new Set(sources
      .filter((source) => !source.canAttemptImmediately)
      .flatMap((source) => source.missingSecretNames)))
      .slice(0, 40),
    note: 'Secret 값은 저장하거나 출력하지 않고, 이름과 준비 상태만 기록한다.'
  };
}

function reviewItem(item) {
  return {
    title: item.title,
    company: item.company,
    sourceName: item.sourceName,
    publishedDate: item.publishedDate || '',
    firstSeenDate: item.firstSeenDate || '',
    detectionLagDays: item.collectionAudit?.detectionLagDays ?? null,
    status: item.status,
    primaryOfficialUrl: item.primaryOfficialUrl || item.url || '',
    reviewReason: item.collectionAudit?.note || item.sourceVerification?.verificationNote || '원문 확인 필요'
  };
}

function criticalJobText(item) {
  return [
    item.sourceId,
    item.title,
    item.baseTitle,
    item.company,
    item.education,
    item.career,
    item.recruitField,
    item.detailText,
    item.description,
    item.teacherBriefing?.teacherShareText
  ].filter(Boolean).join(' ');
}

function matchesCriticalJobAlioItem(item, critical) {
  const text = criticalJobText(item);
  if (String(item.sourceId || '') === critical.idx) return true;
  if (!text.includes(critical.company)) return false;
  return [...(critical.titleTerms || []), ...(critical.bodyTerms || [])].every((term) => text.includes(term));
}

function criticalCurrentPriority(item) {
  const index = activeCriticalJobAlioItems().findIndex((critical) => matchesCriticalJobAlioItem(item, critical));
  return index < 0 ? 99 : index;
}

function buildCriticalJobAlioCoverage(items) {
  const current = activeCriticalJobAlioItems();
  const coveredCurrent = [];
  const missingCurrent = [];

  for (const critical of current) {
    const matched = items.find((item) => matchesCriticalJobAlioItem(item, critical));
    if (matched) {
      coveredCurrent.push({
        id: critical.id,
        idx: critical.idx,
        company: critical.company,
        title: matched.title,
        deadline: matched.deadline,
        status: matched.status,
        primaryOfficialUrl: matched.primaryOfficialUrl || matched.url
      });
    } else {
      missingCurrent.push({
        id: critical.id,
        idx: critical.idx,
        company: critical.company,
        titleHint: critical.titleHint,
        deadline: critical.deadline,
        reason: '핵심 공기업 고졸 공채 감시 대상이 현재 피드에 없습니다.'
      });
    }
  }

  return {
    checkedAt: CHECKED_AT,
    watchInstitutionCount: allJobAlioWatchOrgs().length,
    currentRequiredCount: current.length,
    coveredCurrent,
    missingCurrent
  };
}

function buildCollectionReview(items, sourceStatusList, criticalCoverage = buildCriticalJobAlioCoverage(items), studentRecruitReviewSamples = []) {
  const jobAlioDynamicDiscovery = sourceStatusList.find((source) => source.id === 'job-alio-openapi')?.dynamicDiscovery || null;
  const missedReviewItems = items
    .filter((item) => item.collectionAudit?.missedReviewNeeded)
    .map(reviewItem)
    .slice(0, 12);
  const officialNoticePendingItems = items
    .filter((item) => item.processTrack === 'exam-formal'
      && !['company_notice_confirmed', 'company_notice_reachable', 'job_alio_detail_confirmed'].includes(item.sourceVerification?.doubleCheckStatus))
    .map(reviewItem)
    .slice(0, 12);
  const regionalEducationItems = items
    .filter((item) => item.regionalEducationVerification?.count > 0)
    .map(reviewItem)
    .slice(0, 12);
  const sourceGaps = sourceStatusList
    .filter((source) => !source.ok)
    .map((source) => ({
      id: source.id,
      name: source.name,
      readiness: source.readiness,
      configured: source.configured,
      fallbackProtected: Boolean(source.fallbackProtected),
      fallbackItemCount: source.fallbackItemCount || 0,
      message: source.message || '연결 상태 확인 필요'
    }));
  const criticalGapCount = criticalCoverage.missingCurrent.length;
  const dynamicJobAlioGapCount = Number(jobAlioDynamicDiscovery?.missingCandidateCount || 0);
  const studentRecruitSafetyReviewItems = Array.isArray(studentRecruitReviewSamples)
    ? studentRecruitReviewSamples.slice(0, 20)
    : [];

  return {
    status: missedReviewItems.length || officialNoticePendingItems.length || sourceGaps.length || criticalGapCount || dynamicJobAlioGapCount || studentRecruitSafetyReviewItems.length ? 'review_needed' : 'normal',
    generatedAt: CHECKED_AT,
    firstDayGoal: '공채는 게시 첫날 수집을 목표로 하며, 늦게 발견된 공고는 누락 점검 대상으로 기록한다.',
    dynamicJobAlioGoal: '잡알리오 최근 등록 공고는 기관 화이트리스트나 제목 키워드와 무관하게 상세 원문을 열어 고졸·학력무관 후보를 판정한다.',
    studentRecruitSafetyGoal: '학생에게 잘못 추천하지 않도록 제외하되, 공공·금융·대기업·필기/NCS·고졸·정규직 신호가 있는 중요 공채 후보는 안전검토 큐에 반드시 남긴다.',
    missedReviewCount: missedReviewItems.length,
    officialNoticePendingCount: officialNoticePendingItems.length,
    regionalEducationOfficialCount: regionalEducationItems.length,
    regionalEducationDirectDisplayCount: 0,
    sourceGapCount: sourceGaps.length,
    criticalGapCount,
    dynamicJobAlioGapCount,
    studentRecruitSafetyReviewCount: studentRecruitSafetyReviewItems.length,
    jobAlioDynamicDiscovery,
    missedReviewItems,
    officialNoticePendingItems,
    regionalEducationItems,
    studentRecruitSafetyReviewItems,
    sourceGaps,
    criticalCoverage,
    nextActions: [
      '잡알리오 최근 등록 공고 상세 스캔에서 고졸·학력무관 후보가 보이면 기관 화이트리스트 없이 최종 피드 포함 여부를 대조한다.',
      '핵심 공기업 고졸 공채 감시 대상은 보조 안전망으로만 유지하고, 최근 상세 스캔이 1차 누락 방지망이 된다.',
      '중요 공채 후보 안전검토 큐는 제외 신호와 추천 가치 신호를 함께 기록하므로, 좌측 추천 복귀가 필요한지 공식 원문으로 확인한다.',
      '누락점검 공고는 게시일 기준 공식 소스 연결 주기를 확인한다.',
      '공식 공고 미확인 공채는 회사·기관 또는 채용대행 공식 공지 URL을 보강한다.',
      '지역 교육청·학교 취업지원 소식은 직접 결과 카드로 표시하지 않고 잡알리오·고용24·기관 원문과 같은 채용인지 2차·3차 보조검증으로만 붙인다.',
      '미연결 소스는 API Secret 또는 허용된 공식 피드 경로를 확인한다.'
    ]
  };
}

async function main() {
  const previousItems = await readPreviousItems();
  const results = await Promise.all([
    runSource('mpm-public-job', fetchMpmPublicJob),
    runSource('moef-public-recruit', fetchMoefPublicRecruit),
    runSource('work24-open-recruit', fetchWork24OpenRecruit),
    runSource('job-alio-openapi', fetchJobAlioRecruit),
    runSource('seoul-highjob', fetchSeoulHighJobRecruit),
    runSource('saramin-job-search', fetchSaraminJobSearch)
  ]);
  results.push(...await pendingCatalogSources());

  const initialSourceStatusList = results.map((result) => result.status);
  const freshItems = results.flatMap((result) => result.items || []);
  const regionalEducationVerificationItems = results.flatMap((result) => result.verificationItems || []);
  const sourceFallbackItems = fallbackFailedSourceItems(previousItems, initialSourceStatusList, freshItems);
  const sourceStatusList = annotateSourceFallbackProtection(initialSourceStatusList, sourceFallbackItems);
  const allCurrentItems = dedupeAndSortAll([...freshItems, ...sourceFallbackItems]);
  const publishableCurrentItems = allCurrentItems.filter((item) => !item.studentChannelAssessment?.hardBlocked && shouldKeep(item));
  const currentItems = balanceTrackItems(publishableCurrentItems);
  const displayItems = currentItems.length
    ? mergePreviousAudit(currentItems, previousItems)
    : fallbackPreviousItems(previousItems);
  const attachedItems = attachRegionalEducationVerificationSources(displayItems, regionalEducationVerificationItems);
  const attachedArchiveItems = attachRegionalEducationVerificationSources(
    buildArchiveItems(mergePreviousAudit(allCurrentItems, previousItems), previousItems),
    regionalEducationVerificationItems
  );
  const publicationSafety = applyPublicationSafetyGuards(attachedItems, attachedArchiveItems);
  const items = publicationSafety.items.map(normalizeLegacyProcessTrackCopy);
  const archiveItems = publicationSafety.archiveItems.map(normalizeLegacyProcessTrackCopy);
  const previousZipDetailsByUrl = buildPreviousZipDetailsByUrl(previousItems);
  const zipAttachmentSummary = await enhanceZipAttachmentsForItems([...items, ...archiveItems], previousZipDetailsByUrl);
  const active = items.filter((item) => item.status === 'active').length;
  const deadlineSoon = items.filter((item) => item.status === 'deadline_soon').length;
  const applicationClosed = items.filter((item) => item.status === 'application_closed').length;
  const examFormal = items.filter((item) => item.processTrack === 'exam-formal').length;
  const directInterview = items.filter((item) => item.processTrack === 'direct-interview').length;
  const companyNoticeChecked = items.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable',
    'job_alio_detail_confirmed'
  ].includes(item.sourceVerification?.doubleCheckStatus)).length;
  const detailedPublicRecruit = items.filter((item) => item.detailLevel === 'detailed-public-recruit').length;
  const regionalEducationVerified = items.filter((item) => item.regionalEducationVerification?.count > 0).length;
  const regionalEducationVerificationCandidates = regionalEducationVerificationItems.length;
  const briefDirect = items.filter((item) => item.detailLevel === 'brief-company-contact').length;
  const briefingReady = items.filter((item) => item.teacherBriefing?.teacherShareText).length;
  const firstDayCollected = items.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const lateDetected = items.filter((item) => item.collectionAudit?.firstDayStatus === 'late_detected').length;
  const missedReviewNeeded = items.filter((item) => item.collectionAudit?.missedReviewNeeded).length;
  const staleFallbackItems = items.filter((item) => item.staleSourceFallback).length;
  const sourceFallbackProtected = items.filter((item) => item.collectionAudit?.sourceFallback).length;
  const sourcesConfigured = sourceStatusList.filter((source) => source.configured).length;
  const criticalCoverage = buildCriticalJobAlioCoverage(items);
  const collectionReview = buildCollectionReview(items, sourceStatusList, criticalCoverage, publicationSafety.report.studentRecruitReviewSamples);
  const secretReadiness = buildSecretReadinessReport(sourceStatusList);
  const jobAlioWatchOrgs = allJobAlioWatchOrgs();
  const extraJobAlioWatchOrgList = extraJobAlioWatchOrgs();

  const payload = {
    version: 4,
    generatedAt: CHECKED_AT,
    timezone: 'Asia/Seoul',
    schedule: '09:10, 14:10, 23:10 KST',
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
      archivedPublicRecruit: archiveItems.length,
      regionalEducationVerified,
      regionalEducationVerificationLinked: regionalEducationVerified,
      regionalEducationVerificationCandidates,
      regionalEducationDirectDisplayed: 0,
      briefDirect,
      briefingReady,
      firstDayCollected,
      lateDetected,
      missedReviewNeeded,
      criticalCoverageMissing: criticalCoverage.missingCurrent.length,
      dynamicJobAlioGapCount: collectionReview.dynamicJobAlioGapCount,
      staleFallbackItems,
      sourceFallbackProtected,
      publicationBlocked: publicationSafety.report.blockedCount,
      publicationRepaired: publicationSafety.report.repairedCount,
      studentRecruitSafetyReview: publicationSafety.report.studentRecruitReviewCount,
      zipAttachmentsScanned: zipAttachmentSummary.scanned,
      zipAttachmentEntries: zipAttachmentSummary.entryCount,
      zipAttachmentScanFailures: zipAttachmentSummary.failed,
      zipAttachmentCachedScans: zipAttachmentSummary.cached,
      sourcesChecked: sourceStatusList.length,
      sourcesConfigured,
      sourcesReady: secretReadiness.readySources,
      sourcesMissingSetup: secretReadiness.missingSources,
      note: staleFallbackItems
        ? sourceFallbackProtected
          ? `일부 공식 소스가 일시 실패해 직전 정상 공고 ${sourceFallbackProtected}건을 보존하고 나머지 수집 결과와 함께 게시했습니다.`
          : '현재 실행에서 신규 수집이 0건이라 직전 정상 공고를 임시 보존하고 공식 소스 점검이 필요합니다.'
        : sourcesConfigured
        ? '공채 첫날 수집을 최우선으로 점검하고, 공식 공고 2중 확인 중심으로 취업부 브리핑을 자동 생성했습니다.'
        : '공식 API 키가 아직 연결되지 않아 자동 수집 대기 상태입니다.'
    },
    publicationSafety: publicationSafety.report,
    collectionReview,
    secretReadiness,
    collectionPolicy: {
      goal: '공채는 공고 게시 첫날 수집을 최대 과제로 삼고, 늦게 발견된 공고는 누락 점검 대상으로 표시한다.',
      firstDayField: 'collectionAudit.firstDayCollected',
      missedReviewField: 'collectionAudit.missedReviewNeeded',
      applicationClosedTitleSuffix: '(원서 마감)',
      applicationClosedRetainDays: APPLICATION_CLOSED_RETAIN_DAYS,
      applicationClosedArchiveField: 'archiveItems',
      applicationClosedArchiveMaxItems: MAX_ARCHIVE_ITEMS,
      jobAlioScanLimit: JOB_ALIO_SCAN_LIMIT,
      jobAlioScanPages: JOB_ALIO_SCAN_PAGES,
      jobAlioRecentDetailDays: JOB_ALIO_RECENT_DETAIL_DAYS,
      jobAlioRecentDetailLimit: JOB_ALIO_RECENT_DETAIL_LIMIT,
      jobAlioDynamicDiscoveryRule: '최근 등록 잡알리오 공고는 기관 화이트리스트·제목 키워드와 무관하게 상세 원문을 열어 학력정보, 응시자격, 전형절차의 고졸·학력무관 신호를 판정한다.',
      studentRecruitSafetyReviewRule: '좌측 추천에서 제외되거나 게시 직전 차단된 후보라도 공공·금융·대기업·필기/NCS·고졸·학력무관·정규직 신호가 있으면 publicationSafety.studentRecruitReviewSamples에 남겨 중요 공채 후보 누락을 점검한다.',
      jobAlioKeywordQueries: JOB_ALIO_KEYWORD_QUERIES.map((query) => `${query.searchType}:${query.keyword}`),
      jobAlioCriticalWatchInstitutions: jobAlioWatchOrgs.map((org) => org.orgName),
      jobAlioBaseWatchInstitutions: CRITICAL_JOB_ALIO_ORGS.map((org) => org.orgName),
      jobAlioExtraWatchInstitutions: extraJobAlioWatchOrgList.map((org) => org.orgName),
      jobAlioExtraWatchInstitutionSecretNames: JOB_ALIO_EXTRA_WATCH_ORG_SECRET_NAMES,
      jobAlioCurrentCriticalItems: CRITICAL_CURRENT_JOB_ALIO_ITEMS.map((item) => ({
        id: item.id,
        idx: item.idx,
        company: item.company,
        deadline: item.deadline
      })),
      financeLargeCompanyOfficialWatchCount: FINANCE_LARGE_COMPANY_EXPANDED_WATCHLIST.length,
      financeLargeCompanyOfficialWatchEmployers: FINANCE_LARGE_COMPANY_EXPANDED_WATCHLIST.map((entry) => entry.employer),
      financeLargeCompanySignalRule: '대기업·상장/중견기업·1금융·2금융·3금융 공식 채용 페이지와 채용대행 API 목록·상세에서 고졸·특성화고·고등학교 졸업예정·학력무관·사무행원·창구·업무지원·사무보조·기술직·생산직 등 응시 가능 신호와 채용 신호가 함께 확인될 때만 후보로 정규화한다.',
      regionalEducationOfficialWatchCount: REGIONAL_EDUCATION_OFFICIAL_WATCHLIST.length,
      regionalEducationOfficialWatchEmployers: REGIONAL_EDUCATION_OFFICIAL_WATCHLIST.map((entry) => entry.employer),
      regionalEducationSourceRule: '교육청 취업지원센터·학교 채용 소식은 직접 결과 카드로 노출하지 않는다. 잡알리오·고용24·기관·기업 공식 원문이 1차 채용 공고로 확인된 뒤, 같은 채용인지 맞는 경우에만 누락 보완과 2차·3차 보조검증 출처로 붙인다.',
      zipAttachmentRule: 'ZIP 첨부는 자동 수집 단계에서 내부 파일을 정적 첨부 사본으로 추출해 archiveEntries[].url로 보관하고, 추출 링크가 이미 있으면 직전 정상 링크를 우선 재사용해 화면에서는 원본 ZIP 아래에 파일별 열기 링크를 표시한다.',
      seoulHighJobScanPages: SEOUL_HIGHJOB_SCAN_PAGES,
      primarySourceRule: '회사·기관 자체 홈페이지 또는 채용대행 공식 공고를 최우선 원문으로 사용하고, 잡알리오·고용24·사람인 등은 보완 출처로 사용한다.'
    },
    tracks: [
      {
        id: 'exam-formal',
        name: '공채 상세 정보',
        description: '고졸·특성화고 명시 공고와 학력무관 공공기관·금융권·대기업 정규직·무기계약직·채용형 인턴 등 학생에게 추천할 공식 공채. 필기·NCS 신호가 있으면 우선 정렬한다.'
      },
      {
        id: 'direct-interview',
        name: '면접중심·현장형 채용',
        description: '공채 시험 준비형은 아니지만 일반 특성화고 학생에게 현실적인 취업처가 될 수 있는 일반·면접형 취업정보. 마감, 전형, 자격, 첨부자료를 공식 소스에서 자동 요약하고 변동 항목은 다음 수집에서 다시 대조한다.'
      }
    ],
    sourceStatus: sourceStatusList,
    archiveItems,
    items
  };

  const holdReason = publicFeedHoldReason(payload, previousItems);
  if (holdReason) {
    await writeJsonAtomic(HEALTH_FILE, withPublicationHold(buildFeedHealth(payload, publicationSafety.report, 'degraded-held'), holdReason));
    console.log(`job-feed held: ${holdReason}`);
    return;
  }

  const protectedArtifacts = buildProtectedJobArtifacts(payload);
  await writeJsonAtomic(JOB_DETAIL_VAULT_FILE, protectedArtifacts.vault);
  await writeJsonAtomic(OUT_FILE, protectedArtifacts.publicPayload);
  await writeJsonAtomic(HEALTH_FILE, buildFeedHealth(payload, publicationSafety.report));
  console.log(`job-feed: ${items.length} items, ${sourcesConfigured} configured sources`);
}

main().catch(async (error) => {
  const sourceStatusList = [
    sourceStatus({
      id: 'job-feed-runner',
      name: '자동 수집 실행기',
      type: 'runner',
      sourceUrl: '',
      configured: true
    }, { message: error.message })
  ];
  const payload = {
    version: 4,
    generatedAt: CHECKED_AT,
    timezone: 'Asia/Seoul',
    schedule: '09:10, 14:10, 23:10 KST',
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
      regionalEducationVerified: 0,
      regionalEducationVerificationLinked: 0,
      regionalEducationVerificationCandidates: 0,
      regionalEducationDirectDisplayed: 0,
      briefDirect: 0,
      briefingReady: 0,
      firstDayCollected: 0,
      lateDetected: 0,
      missedReviewNeeded: 0,
      staleFallbackItems: 0,
      studentRecruitSafetyReview: 0,
      sourcesChecked: 0,
      sourcesConfigured: 0,
      sourcesReady: 0,
      sourcesMissingSetup: SOURCE_CATALOG.length,
      note: '자동 수집 실행 중 오류가 발생했습니다.'
    },
    tracks: [
      {
        id: 'exam-formal',
        name: '공채 상세 정보',
        description: '고졸·특성화고 명시 공고와 학력무관 공공기관·금융권·대기업 정규직·무기계약직·채용형 인턴 등 학생에게 추천할 공식 공채. 필기·NCS 신호가 있으면 우선 정렬한다.'
      },
      {
        id: 'direct-interview',
        name: '면접중심·현장형 채용',
        description: '공채 시험 준비형은 아니지만 일반 특성화고 학생에게 현실적인 취업처가 될 수 있는 일반·면접형 취업정보. 마감, 전형, 자격, 첨부자료를 공식 소스에서 자동 요약하고 변동 항목은 다음 수집에서 다시 대조한다.'
      }
    ],
    secretReadiness: buildSecretReadinessReport(sourceStatusList),
    sourceStatus: sourceStatusList,
    publicationSafety: {
      policy: 'pre-publication-safety-guard-v1',
      generatedAt: CHECKED_AT,
      blockedCount: 0,
      repairedCount: 0,
      studentRecruitReviewPolicy: 'student-important-recruit-review-queue-v1',
      studentRecruitReviewCount: 0,
      blockedByReason: {},
      repairedByReason: {},
      blockedSamples: [],
      studentRecruitReviewSamples: []
    },
    archiveItems: [],
    items: []
  };
  const preservePreviousFeed = await fileExists(OUT_FILE);
  if (!preservePreviousFeed) {
    await writeJsonAtomic(OUT_FILE, payload);
  }
  const health = buildFeedHealth(payload, payload.publicationSafety, preservePreviousFeed ? 'failed-held' : 'failed');
  await writeJsonAtomic(HEALTH_FILE, preservePreviousFeed
    ? withPublicationHold(health, '자동 수집 실행 오류로 공개 피드는 직전 정상본을 유지합니다.')
    : health);
  console.error(`job-feed failed: ${error.message}`);
  process.exitCode = 1;
});
