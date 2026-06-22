import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'assets', 'job-feed.json');
const execFileAsync = promisify(execFile);

await loadLocalEnvFile(path.join(ROOT_DIR, '.env.local'));

const NOW = new Date();
const CHECKED_AT = NOW.toISOString();
const MAX_ITEMS = 40;
const REQUEST_TIMEOUT_MS = 18000;
const PUBLIC_API_TIMEOUT_MS = 9000;
const DETAIL_FETCH_CONCURRENCY = 6;
const JOB_ALIO_LIST_FETCH_CONCURRENCY = 8;
const PUBLIC_API_FETCH_CONCURRENCY = 8;
const APPLICATION_CLOSED_RETAIN_DAYS = 365;
const MAX_ARCHIVE_ITEMS = 160;
const JOB_ALIO_SCAN_LIMIT = 220;
const JOB_ALIO_SCAN_PAGES = 6;
const OFFICIAL_WATCH_TIMEOUT_MS = 15000;
const COMPANY_NOTICE_TIMEOUT_MS = 15000;
const GENERIC_OFFICIAL_FEED_CONCURRENCY = 5;
const EXTERNAL_CLIENT_GRACE_MS = 1500;
const MIN_FALLBACK_TIMEOUT_MS = 1200;
const REACHABILITY_TIMEOUT_MS = 7000;
const ZIP_ATTACHMENT_TIMEOUT_MS = 12000;
const ZIP_ATTACHMENT_CONCURRENCY = 3;
const ZIP_ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
const ZIP_ATTACHMENT_MAX_ENTRIES = 160;
const DEFAULT_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6'
};

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
const PROFESSIONAL_ONLY_TERMS = ['전문의', '의사', '약사', '간호사', '방사선사', '공인회계사', '회계사', '변호사', '세무사', '노무사', '법무사', '건축사', '정교사', '교원자격', '교사 자격', '보육교사', '면허 소지', '면허소지', '석사', '박사', '기술사'];
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
const SENIOR_ROLE_PATTERN = /(원장|센터장|기관장|본부장|부원장|교장|공모교장|교감|원감|개방형\s*직위|전문계약직|연봉계약직|임원|상임감사|비상임감사|감사위원|이사장|대표이사)/;
const RESTRICTED_ROLE_PATTERN = /(관리직|별정직|책임연구원|선임연구원|교수)/;

const WORK24_OPEN_RECRUIT_URL = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L21.do';
const SARAMIN_JOB_SEARCH_URL = 'https://oapi.saramin.co.kr/job-search';
const JOB_ALIO_RECRUIT_URL = 'https://job.alio.go.kr/recruit.do';
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
const MPM_PUBLIC_JOB_INSTITUTION_TYPES = ['g01', 'g02', 'g03', 'g04'];
const PUBLIC_DATA_PAGE_SIZE = 60;
const JOB_ALIO_KEYWORD_QUERIES = [
  { searchType: 'title', keyword: '고졸' },
  { searchType: 'title', keyword: '특성화고' },
  { searchType: 'title', keyword: '직업계고' },
  { searchType: 'title', keyword: '마이스터고' },
  { searchType: 'title', keyword: '졸업예정' },
  { searchType: 'elig', keyword: '고졸' },
  { searchType: 'elig', keyword: '고등학교' },
  { searchType: 'elig', keyword: '졸업예정' },
  { searchType: 'elig', keyword: '특성화고' },
  { searchType: 'elig', keyword: '직업계고' }
];
const CRITICAL_JOB_ALIO_ORGS = [
  { orgCode: 'C0247', orgName: '한국전력공사', aliases: ['한전', 'KEPCO'] },
  { orgCode: 'C0187', orgName: '한국방송통신전파진흥원', aliases: ['KCA'] },
  { orgCode: 'C0306', orgName: '한전KDN', aliases: [] },
  { orgCode: 'C0305', orgName: '한전KPS(주)', aliases: ['한전KPS'] },
  { orgCode: 'C0248', orgName: '한국전력기술주식회사', aliases: ['한국전력기술'] },
  { orgCode: 'C0220', orgName: '한국수력원자력', aliases: ['한수원'] },
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
  { orgCode: 'C0150', orgName: '한국농어촌공사', aliases: [] },
  { orgCode: 'C0166', orgName: '한국방송광고진흥공사', aliases: ['코바코'] },
  { orgCode: 'C0251', orgName: '한국인터넷진흥원', aliases: ['KISA'] },
  { orgCode: 'C0261', orgName: '한국직업능력연구원', aliases: [] }
];
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
  { employer: 'NH농협은행', group: 'finance', url: 'https://with.nonghyup.com/jbnf/jbnfLst.do?srcAuthDsc=1', tags: ['1금융권', '은행'] },
  { employer: 'IBK기업은행', group: 'finance', url: 'https://ibk.incruit.com/index_main_2025.asp', tags: ['금융공기업', '은행'] },
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
  'finance-large-company-recruit': FINANCE_LARGE_COMPANY_OFFICIAL_WATCHLIST,
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
    impact: '은행·금융공기업·대기업의 고졸 공개채용을 내장 공식 채용 페이지와 추가 공식 피드 기준으로 보강한다.',
    easySteps: [
      '기본 실행만으로 주요 대기업·1금융권·2금융권 공식 채용 페이지를 매일 3회 감시한다.',
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
    impact: '공무직·정부기관 공개채용과 필기형 전형을 보강한다.',
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
      '필기·체력검정·면접 일정이 있는 채용은 필기·공식전형으로 우선 분류한다.'
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
      '필기 없는 채용은 공식 소스 자동요약과 변동 항목 재수집 중심으로 표시한다.'
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
      '공개채용·필기형 전형 여부를 원문 중심으로 분류한다.'
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
    name: '금융권·대기업 고졸 공채 공식 피드',
    type: 'official-watchlist',
    sourceUrl: '',
    group: 'finance-large-company',
    trackHint: 'exam',
    status: 'pending',
    secretNames: ['FINANCE_RECRUIT_FEEDS', 'LARGE_COMPANY_RECRUIT_FEEDS', 'FINANCE_RECRUIT_API_KEY', 'LARGE_COMPANY_RECRUIT_API_KEY'],
    message: '주요 대기업·1금융권·2금융권 공식 채용 페이지 내장 감시, 추가 피드 Secret 보강 가능'
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
  '체력시험',
  '군무원',
  '공무원',
  '부사관',
  '공개경쟁'
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
  '체력시험',
  '군무원',
  '공무원',
  '부사관',
  '공개경쟁'
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

function extractOfficialDeadlineText(text) {
  const normalized = normalizeSpace(text);
  if (!normalized) return '';
  const datePattern = '(?:20)?\\d{2}\\s*[.\\-/년]\\s*\\d{1,2}\\s*[.\\-/월]\\s*\\d{1,2}';
  const ranged = normalized.match(new RegExp(`(?:접수|원서|지원|채용)?\\s*(?:기간|접수)\\D{0,60}(?:${datePattern})\\D{0,20}(?:~|-|부터|까지)\\D{0,20}(${datePattern})`, 'i'));
  if (ranged) return ranged[1].replace(/\s+/g, '');
  const deadline = normalized.match(new RegExp(`(?:마감|종료|접수마감|원서마감)\\D{0,40}(${datePattern})`, 'i'));
  if (deadline) return deadline[1].replace(/\s+/g, '');
  const dates = Array.from(normalized.matchAll(new RegExp(datePattern, 'g')), (match) => match[0].replace(/\s+/g, ''));
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

function pageLevelHtmlRecord(html, source, sourceUrl, publicSourceUrl, feedEntry = {}) {
  const pageText = htmlText(html).slice(0, 50000);
  if (!officialHtmlHasRecruitCandidate(pageText, sourceUrl)) return [];
  const title = shortText(officialHtmlTitle(html), `${feedEntry.employer || source.name} 고졸·졸업예정 채용 공고 원문 확인`, 120);
  const deadline = extractOfficialDeadlineText(pageText);
  return [{
    source: source.id,
    sourceName: source.name,
    sourceId: sha([source.id, feedEntry.employer, sourceUrl, title].join('|')),
    title: title.includes(feedEntry.employer || '') ? title : `${feedEntry.employer || source.name} ${title}`,
    company: feedEntry.employer || source.name,
    region: '원문 확인',
    education: pageText.includes('학력무관') || pageText.includes('학력 무관') ? '학력무관' : '고졸·특성화고 관련 원문 확인',
    career: pageText.includes('신입') || pageText.includes('공채') ? '신입·공채 원문 확인' : '원문 확인',
    employmentType: keywordSnippet(pageText, ['정규직', '계약직', '인턴', '무기계약직', '기간제'], '원문 확인', 80),
    deadline,
    deadlineText: deadline ? `${deadline} 마감` : '마감일 원문 확인',
    recruitField: keywordSnippet(pageText, ['고졸', '특성화고', '직업계고', '마이스터고', '행원', '기술직', '생산직', '기능직'], '채용부문 원문 확인', 100),
    applicationMethod: '회사·기관 또는 채용대행 공식 채용 페이지에서 접수방법 확인',
    url: publicDisplayUrl(sourceUrl),
    originalUrl: publicSourceUrl,
    sourceDetailUrl: publicSourceUrl,
    companyNoticeUrl: publicDisplayUrl(sourceUrl),
    processText: keywordSnippet(pageText, ['필기', 'NCS', '인적성', '서류전형', '면접전형', 'AI역량'], '전형절차 원문 확인', 220),
    description: shortText(pageText, '공식 채용 페이지에서 고졸·특성화고 관련 신호가 확인되었습니다.', 720)
  }];
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
    if (xmlRecords.length || htmlRecords.length) {
      return [...xmlRecords, ...htmlRecords];
    }
    return feedEntry.builtIn
      ? []
      : pageLevelHtmlRecord(trimmed, source, sourceUrl, publicSourceUrl, feedEntry);
  }
  return [];
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

function parseDate(value) {
  const raw = normalizeSpace(value);
  if (!raw) return null;

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
  if (compact) return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T23:59:59+09:00`);

  const dotted = raw.match(/^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (dotted) {
    const month = dotted[2].padStart(2, '0');
    const day = dotted[3].padStart(2, '0');
    return new Date(`${dotted[1]}-${month}-${day}T23:59:59+09:00`);
  }

  const shortDotted = raw.match(/^(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
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

function hasWrittenExamSignal(value) {
  const text = normalizeSpace(value);
  if (includesAny(text, WRITTEN_EXAM_TERMS)) return true;
  return [
    /NCS\s*(직업기초능력|직무수행능력|직무능력)?\s*(평가|검사|시험|필기)/i,
    /(필기|시험|평가|검사)\s*[^.。]{0,20}NCS/i
  ].some((pattern) => pattern.test(text));
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
  const hasExam = hasWrittenExamSignal(haystack);
  const hasDirect = includesAny(haystack, DIRECT_TERMS);
  const sector = classifySector(raw, haystack);
  const isRegionalEducationRecruit = isRegionalEducationConcreteRecruit(raw);
  const labels = [sectorLabel(sector)];

  let processTrack = 'direct-interview';
  let writtenExam = 'unknown';
  let confidence = 'review';
  let note = '공식 소스에서 추출한 전형 키워드 기준으로 자동 분류했습니다.';

  if (hasExam) {
    processTrack = 'exam-formal';
    writtenExam = 'confirmed';
    confidence = 'high';
    labels.push('필기 확인');
    note = '필기시험 또는 공식 선발 절차가 원문 키워드에서 확인됩니다.';
  } else if (isRegionalEducationRecruit) {
    processTrack = 'direct-interview';
    writtenExam = 'not_found';
    confidence = 'high';
    labels.push('교육청 보조검증');
    note = '지역 교육청 취업지원센터 소식은 직접 표시 후보가 아니라 잡알리오·고용24·기관 원문을 보강하는 2차·3차 검증 출처로 분리합니다.';
  } else if (hasDirect || source?.trackHint === 'direct' || ['mid-sme', 'part-time'].includes(sector)) {
    processTrack = 'direct-interview';
    writtenExam = 'not_found';
    confidence = hasDirect || source?.trackHint === 'direct' ? 'medium' : 'review';
    labels.push(hasDirect ? '서류·면접 중심' : '필기 미탐지');
    note = '필기시험 신호가 없어 서류·면접 중심 채용으로 자동 분류했습니다.';
  } else if (source?.trackHint === 'exam' || ['public-institution', 'government', 'military', 'finance', 'finance-large-company', 'large-company'].includes(sector)) {
    processTrack = 'exam-formal';
    writtenExam = 'likely';
    confidence = 'medium';
    labels.push('공식전형 후보');
    note = '공공·군·정부 채용 성격상 공식 선발 절차 후보로 분류했습니다.';
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
  const isRegionalEducationRecruit = isRegionalEducationConcreteRecruit(raw);

  let doubleCheckStatus = 'official_source_summarized';
  let doubleCheckLabel = '공식 소스 자동요약';
  let verificationNote = '공식 채용 소스에서 마감·자격·전형·첨부 정보를 자동 추출했습니다. 변동 가능 항목은 다음 수집에서 다시 대조합니다.';

  if (isRegionalEducationRecruit && hasCompanyNotice) {
    doubleCheckStatus = check.status === 'content_matched' ? 'regional_education_confirmed' : 'regional_education_linked';
    doubleCheckLabel = check.status === 'content_matched' ? '교육청 보조검증 원문확인' : '교육청 보조검증 링크확보';
    verificationNote = '지역 교육청 취업지원센터 소식은 직접 결과 카드로 노출하지 않고, 잡알리오·고용24·기관 공고와 같은 채용인지 대조하는 보조 검증 출처로만 사용합니다.';
  } else if (hasCompanyNotice && check.status === 'content_matched') {
    doubleCheckStatus = 'company_notice_confirmed';
    doubleCheckLabel = '공식 공고 2중확인';
    verificationNote = '공식 채용 소스와 회사·기관 또는 채용대행 공식 공지사항 내용을 함께 확인했습니다.';
  } else if (hasCompanyNotice && check.reachable) {
    doubleCheckStatus = 'company_notice_reachable';
    doubleCheckLabel = '공식 공고 접속확인';
    verificationNote = '공식 채용 소스와 회사·기관 또는 채용대행 공식 공지사항 링크를 함께 확인했습니다. 세부 변동 가능 항목은 다음 수집에서 다시 대조합니다.';
  } else if (hasCompanyNotice) {
    doubleCheckStatus = 'company_notice_linked';
    doubleCheckLabel = '공식 공고 링크확보';
    verificationNote = '공식 채용 소스에서 회사·기관 또는 채용대행 공식 공지사항 링크를 확보했습니다. 접속 대조는 다음 수집에서 이어갑니다.';
  } else if (isPublicRecruit) {
    doubleCheckStatus = 'company_notice_required';
    doubleCheckLabel = '공식 공고 자동탐색중';
    verificationNote = '공채 상세 제공을 위해 회사·기관 또는 채용대행 공식 공지사항 URL을 자동 탐색 중입니다.';
  }

  return {
    sourceOfficialUrl: sourceOfficialUrl || displayOfficialUrl,
    companyNoticeUrl,
    primaryOfficialUrl: companyNoticeUrl || sourceOfficialUrl || displayOfficialUrl,
    officialNoticePriority: isRegionalEducationRecruit
      ? 'regional-education-verification-only-source'
      : companyNoticeUrl
        ? 'company-or-agency-notice-first'
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
    const isDetailed = ['company_notice_confirmed', 'company_notice_reachable'].includes(verification.doubleCheckStatus);
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
    displayNote: '필기시험 신호가 없는 채용은 마감, 전형, 자격, 첨부자료 중심으로 자동 요약합니다.',
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

function isZipAttachment(item) {
  const title = normalizeSpace(item?.title || item?.name || item?.fileName || item?.filename);
  const url = cleanUrl(item?.url || item?.href || item?.link || item?.downloadUrl || item?.fileUrl);
  return /\.zip(?:$|[?#\s])/i.test(`${title} ${url}`) || /(?:zip|압축파일|압축\s*자료)/i.test(title);
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

function findZipEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function parseZipEntries(buffer) {
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
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) break;

    const rawPath = decodeZipEntryName(buffer.subarray(nameStart, nameEnd), Boolean(flags & 0x0800));
    const pathValue = cleanZipEntryPath(rawPath);
    offset = nameEnd + extraLength + commentLength;
    if (!pathValue || pathValue.endsWith('/') || seen.has(pathValue)) continue;

    seen.add(pathValue);
    const parts = pathValue.split('/');
    entries.push({
      name: parts[parts.length - 1],
      path: pathValue,
      folder: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
      size: uncompressedSize || compressedSize || null
    });
  }

  if (declaredEntryCount > entries.length && entries.length >= ZIP_ATTACHMENT_MAX_ENTRIES) {
    entries.truncated = true;
  }
  return entries;
}

async function inspectZipAttachment(item) {
  const url = publicDisplayUrl(item.url || item.href || item.link || item.downloadUrl || item.fileUrl);
  if (!url) return { archiveFormat: 'zip', archiveScanStatus: 'missing_url', archiveEntries: [] };
  try {
    const buffer = await fetchBinaryWithTimeout(url);
    const entries = parseZipEntries(buffer);
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

function enhanceAttachmentArrayWithZipEntries(attachments, zipDetailsByUrl) {
  if (!Array.isArray(attachments)) return attachments;
  return attachments.map((attachment) => {
    if (!isZipAttachment(attachment)) return attachment;
    const url = publicDisplayUrl(attachment.url || attachment.href || attachment.link || attachment.downloadUrl || attachment.fileUrl);
    const details = zipDetailsByUrl.get(url);
    return details ? { ...attachment, ...details } : attachment;
  });
}

async function enhanceZipAttachmentsForItems(items) {
  const zipTargets = new Map();
  for (const item of items) {
    const attachmentGroups = [
      Array.isArray(item.attachments) ? item.attachments : [],
      Array.isArray(item.publicRecruitDetails?.attachments) ? item.publicRecruitDetails.attachments : []
    ];
    for (const attachments of attachmentGroups) {
      for (const attachment of attachments) {
        if (!isZipAttachment(attachment)) continue;
        const url = publicDisplayUrl(attachment.url || attachment.href || attachment.link || attachment.downloadUrl || attachment.fileUrl);
        if (url && !zipTargets.has(url)) zipTargets.set(url, attachment);
      }
    }
  }

  const zipDetailsByUrl = new Map();
  await mapWithConcurrency(Array.from(zipTargets.entries()), ZIP_ATTACHMENT_CONCURRENCY, async ([url, attachment]) => {
    zipDetailsByUrl.set(url, await inspectZipAttachment({ ...attachment, url }));
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
  for (const details of zipDetailsByUrl.values()) {
    scanned += 1;
    entryCount += details.archiveEntryCount || 0;
    if (details.archiveScanStatus === 'failed') failed += 1;
  }
  return { scanned, entryCount, failed };
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
  if (text.includes('전공')) subjects.push('전공시험');
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
  const applicationLine = status === 'application_closed'
    ? (deadline ? `${deadline} 원서 마감` : '원서 마감')
    : firstText(raw.deadlineText, deadline ? `${deadline} 마감` : '', applicationMethod, '마감일 자동 추출 대기');

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
    label: isRegionalEducationRecruit ? '교육청 보조검증 브리핑' : isPublicRecruit ? '취업부 공채 브리핑' : '간단 채용 확인 브리핑',
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
    labels.push('면접중심');
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
  if (SENIOR_ROLE_PATTERN.test(text)) return true;
  if (!strongHighSchool && !entryLevel && !educationOpen && RESTRICTED_ROLE_PATTERN.test(text)) return true;
  if (!strongHighSchool && PROFESSIONAL_ONLY_TERMS.some((term) => text.includes(term))) return true;
  if (hasAdvancedEducationOnly(item)) return true;
  if (!strongHighSchool && !entryLevel && !educationOpen && isCareerOnlyRole(item)) return true;
  return false;
}

function normalizeItem(raw) {
  const baseTitle = normalizeSpace(raw.title);
  const company = normalizeSpace(raw.company);
  const deadlineDate = parseDate(raw.deadline || raw.deadlineTimestamp);
  const deadline = formatDate(deadlineDate);
  const deadlineDistance = daysUntil(deadlineDate);
  const url = cleanUrl(raw.url) || cleanUrl(raw.originalUrl) || cleanUrl(raw.sourceDetailUrl);
  const score = scoreItem(raw);
  const process = classifyProcess(raw);
  const sourceVerification = buildSourceVerification(raw, process, url);
  const servicePolicy = buildServicePolicy(process, sourceVerification);
  const publishedDate = parseDate(raw.publishedAt || raw.registeredAt || raw.postedAt || raw.openDate || raw.postingDate);
  const collectionAudit = buildCollectionAudit(raw, publishedDate);
  const isExamFormal = process.processTrack === 'exam-formal';
  const isRegionalEducationVerificationSource = servicePolicy.detailLevel === 'regional-education-verification-source';
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
  const attachments = normalizeAttachmentList(raw, sourceVerification);

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
    publicRecruitDetails: isExamFormal ? {
      companyNotice: sourceVerification.companyNoticeUrl ? '회사·기관 공식 공고 확인' : '회사·기관 공식 공고 자동 탐색중',
      sourceCheck: sourceVerification.doubleCheckLabel,
      hiring: compactTags([
        normalizeSpace(raw.recruitField || raw.jobField || raw.workField || raw.position),
        normalizeSpace(raw.recruitNumber || raw.hiringCount || raw.recruitCount)
      ]).join(' · ') || '채용부문·규모 자동 추출 대기',
      eligibility: [normalizeSpace(raw.education), normalizeSpace(raw.career)].filter(Boolean).join(' · ') || '응시자격 자동 추출 대기',
      process: normalizeSpace(raw.processText || process.processNote).slice(0, 260) || '전형절차 자동 추출 대기',
      application: status === 'application_closed'
        ? (deadline ? `${deadline} 원서 마감` : '원서 마감')
        : normalizeSpace(raw.deadlineText) || (deadline ? `${deadline} 마감` : '마감일 자동 추출 대기'),
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

function shouldKeep(item) {
  if (!item.title || !item.company || !item.url) return false;
  if (isRegionalEducationDisplaySuppressed(item)) return false;
  if (item.status === 'expired') return false;
  if (item.status === 'application_closed' && item.processTrack !== 'exam-formal') return false;
  if (isUnsuitableForHighSchoolChannel(item)) return false;
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
  const directItems = regularItems.filter((item) => item.processTrack === 'direct-interview');
  const directTarget = Math.min(directItems.length, Math.max(6, Math.floor(MAX_ITEMS * 0.25)));

  criticalItems.forEach(add);
  directItems.slice(0, directTarget).forEach(add);
  regularItems.forEach(add);
  return selected.slice(0, MAX_ITEMS);
}

function itemDedupeQuality(item) {
  const verificationWeight = {
    company_notice_confirmed: 50,
    company_notice_reachable: 42,
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
    const lists = [
      Array.isArray(payload.items) ? payload.items : [],
      Array.isArray(payload.archiveItems) ? payload.archiveItems : []
    ];
    for (const list of lists) {
      for (const item of list) {
        for (const key of previousItemKeys(item)) {
          if (!map.has(key)) map.set(key, item);
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

function archiveSort(a, b) {
  const deadlineDiff = String(b.deadline || '').localeCompare(String(a.deadline || ''));
  if (deadlineDiff !== 0) return deadlineDiff;
  return String(a.title || '').localeCompare(String(b.title || ''), 'ko-KR');
}

function buildArchiveItems(currentItems, previousItems) {
  const best = new Map();
  const consider = (item) => {
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
  for (const org of CRITICAL_JOB_ALIO_ORGS) {
    targets.push({
      id: `critical-org-${org.orgCode}`,
      url: jobAlioListUrl({
        pageNo: 1,
        org_name: org.orgCode
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
  let html = '';
  try {
    html = await fetchWithTimeout(detailUrl);
  } catch (error) {
    const mobileDetailUrl = `https://job.alio.go.kr/mobile2021/recruit/recruitView.do?idx=${encodeURIComponent(row.idx)}`;
    html = await fetchWithTimeout(mobileDetailUrl);
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

async function fetchJobAlioRecruit() {
  const base = { ...catalogSource('job-alio-openapi'), configured: true };
  const rawItems = [];
  const errors = [];
  const rowsByIdx = new Map();
  let scannedCount = 0;
  let scanTargetCount = 0;

  await mapWithConcurrency(makeJobAlioScanTargets(), JOB_ALIO_LIST_FETCH_CONCURRENCY, async (target) => {
    try {
      const html = await fetchWithTimeout(target.url);
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

  const rows = Array.from(rowsByIdx.values())
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .slice(0, JOB_ALIO_SCAN_LIMIT);

  const details = await mapWithConcurrency(rows, DETAIL_FETCH_CONCURRENCY, async (row) => {
    try {
      return await fetchJobAlioDetail(row);
    } catch (error) {
      errors.push(`${row.idx}: ${sanitizeFetchErrorMessage(error.message)}`);
      return null;
    }
  });
  rawItems.push(...details.filter(Boolean));

  const normalized = rawItems.map(normalizeItem).filter(shouldKeep);
  const ok = rawItems.length > 0 && errors.length < Math.max(1, rawItems.length);
  const companyChecked = normalized.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable'
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
      criticalCoverage,
      firstDayCandidates,
      missedReviewNeeded: missedReview,
      message: ok
        ? `공식 공개 원문 ${scannedCount}건/${rowsByIdx.size}후보 점검, 검색경로 ${scanTargetCount}개, 공식 공고 확인 ${companyChecked}건, 핵심공고 누락 ${criticalCoverage.missingCurrent.length}건`
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
    .slice(0, 80);
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

  const verificationOnlyRegionalEducation = id === 'regional-education-job';
  const rawItems = [];
  const errors = [];
  let checkedUrlCount = 0;
  let reachabilityOnlyCount = 0;
  const reachabilityOnlyEmployers = [];
  const results = await mapWithConcurrency(entries, GENERIC_OFFICIAL_FEED_CONCURRENCY, async (entry) => {
    try {
      let sourceUrl = entry.url;
      let requestUrl = injectSecretIntoUrl(sourceUrl, key);
      let body = await fetchWithTimeout(requestUrl, {
        timeoutMs: entry.builtIn ? OFFICIAL_WATCH_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
        headers: {
          Accept: 'application/json,application/xml,text/xml,text/html;q=0.9,*/*;q=0.7',
          ...(key ? { Authorization: `Bearer ${key}`, 'X-API-Key': key } : {})
        }
      });
      for (let redirectCount = 0; redirectCount < 2; redirectCount += 1) {
        const redirectUrl = extractHtmlRedirectUrl(body, sourceUrl);
        if (!redirectUrl) break;
        sourceUrl = redirectUrl;
        requestUrl = injectSecretIntoUrl(sourceUrl, key);
        body = await fetchWithTimeout(requestUrl, {
          timeoutMs: entry.builtIn ? OFFICIAL_WATCH_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
          headers: {
            Accept: 'application/json,application/xml,text/xml,text/html;q=0.9,*/*;q=0.7',
            ...(key ? { Authorization: `Bearer ${key}`, 'X-API-Key': key } : {})
          }
        });
      }
      const records = parseGenericOfficialFeed(body, source, sourceUrl, entry);
      return {
        ok: true,
        entry,
        records,
        recordCount: records.length,
        url: safePublicFeedUrl(sourceUrl)
      };
    } catch (error) {
      const reachableOnly = entry.builtIn
        ? await checkUrlReachable(entry.url, {
          headers: {
            Accept: 'application/json,application/xml,text/xml,text/html;q=0.9,*/*;q=0.7',
            ...(key ? { Authorization: `Bearer ${key}`, 'X-API-Key': key } : {})
          }
        }, Math.min(REACHABILITY_TIMEOUT_MS, OFFICIAL_WATCH_TIMEOUT_MS))
        : false;
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
      failedUrlCount: errors.length,
      watchFailures: errors.slice(0, 12),
      message: ok
        ? `공식 채용 페이지 ${checkedUrlCount}/${entries.length}개 감시, 표시후보 ${normalized.length}건, 보조검증 후보 ${verificationItems.length}건, 접속확인전용 ${reachabilityOnlyCount}개, 실패 ${errors.length}개`
        : `연결 실패: ${errors.slice(0, 2).join('; ')}`
    })
  };
}

async function pendingCatalogSources() {
  const results = [];
  for (const source of SOURCE_CATALOG.filter((item) => item.status !== 'active')) {
    results.push(await fetchGenericConfiguredSource(source.id));
  }
  return results;
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
    watchInstitutionCount: CRITICAL_JOB_ALIO_ORGS.length,
    currentRequiredCount: current.length,
    coveredCurrent,
    missingCurrent
  };
}

function buildCollectionReview(items, sourceStatusList, criticalCoverage = buildCriticalJobAlioCoverage(items)) {
  const missedReviewItems = items
    .filter((item) => item.collectionAudit?.missedReviewNeeded)
    .map(reviewItem)
    .slice(0, 12);
  const officialNoticePendingItems = items
    .filter((item) => item.processTrack === 'exam-formal'
      && !['company_notice_confirmed', 'company_notice_reachable'].includes(item.sourceVerification?.doubleCheckStatus))
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
      message: source.message || '연결 상태 확인 필요'
    }));
  const criticalGapCount = criticalCoverage.missingCurrent.length;

  return {
    status: missedReviewItems.length || officialNoticePendingItems.length || sourceGaps.length || criticalGapCount ? 'review_needed' : 'normal',
    generatedAt: CHECKED_AT,
    firstDayGoal: '공채는 게시 첫날 수집을 목표로 하며, 늦게 발견된 공고는 누락 점검 대상으로 기록한다.',
    missedReviewCount: missedReviewItems.length,
    officialNoticePendingCount: officialNoticePendingItems.length,
    regionalEducationOfficialCount: regionalEducationItems.length,
    regionalEducationDirectDisplayCount: 0,
    sourceGapCount: sourceGaps.length,
    criticalGapCount,
    missedReviewItems,
    officialNoticePendingItems,
    regionalEducationItems,
    sourceGaps,
    criticalCoverage,
    nextActions: [
      '핵심 공기업 고졸 공채 감시 대상이 빠지면 잡알리오 상세번호·기관검색·검색어 경로를 즉시 재점검한다.',
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
    fetchMpmPublicJob(),
    fetchMoefPublicRecruit(),
    fetchWork24OpenRecruit(),
    fetchJobAlioRecruit(),
    fetchSeoulHighJobRecruit(),
    fetchSaraminJobSearch()
  ]);
  results.push(...await pendingCatalogSources());

  const sourceStatusList = results.map((result) => result.status);
  const freshItems = results.flatMap((result) => result.items || []);
  const regionalEducationVerificationItems = results.flatMap((result) => result.verificationItems || []);
  const sourceFallbackItems = fallbackFailedSourceItems(previousItems, sourceStatusList, freshItems);
  const allCurrentItems = dedupeAndSortAll([...freshItems, ...sourceFallbackItems]);
  const currentItems = balanceTrackItems(allCurrentItems);
  const displayItems = currentItems.length
    ? mergePreviousAudit(currentItems, previousItems)
    : fallbackPreviousItems(previousItems);
  const items = attachRegionalEducationVerificationSources(displayItems, regionalEducationVerificationItems);
  const archiveItems = attachRegionalEducationVerificationSources(
    buildArchiveItems(mergePreviousAudit(allCurrentItems, previousItems), previousItems),
    regionalEducationVerificationItems
  );
  const zipAttachmentSummary = await enhanceZipAttachmentsForItems([...items, ...archiveItems]);
  const active = items.filter((item) => item.status === 'active').length;
  const deadlineSoon = items.filter((item) => item.status === 'deadline_soon').length;
  const applicationClosed = archiveItems.length;
  const examFormal = items.filter((item) => item.processTrack === 'exam-formal').length;
  const directInterview = items.filter((item) => item.processTrack === 'direct-interview').length;
  const companyNoticeChecked = items.filter((item) => [
    'company_notice_confirmed',
    'company_notice_reachable'
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
  const sourcesConfigured = sourceStatusList.filter((source) => source.configured).length;
  const criticalCoverage = buildCriticalJobAlioCoverage(items);
  const collectionReview = buildCollectionReview(items, sourceStatusList, criticalCoverage);
  const secretReadiness = buildSecretReadinessReport(sourceStatusList);

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
      staleFallbackItems,
      zipAttachmentsScanned: zipAttachmentSummary.scanned,
      zipAttachmentEntries: zipAttachmentSummary.entryCount,
      zipAttachmentScanFailures: zipAttachmentSummary.failed,
      sourcesChecked: sourceStatusList.length,
      sourcesConfigured,
      sourcesReady: secretReadiness.readySources,
      sourcesMissingSetup: secretReadiness.missingSources,
      note: staleFallbackItems
        ? '현재 실행에서 신규 수집이 0건이라 직전 정상 공고를 임시 보존하고 공식 소스 점검이 필요합니다.'
        : sourcesConfigured
        ? '공채 첫날 수집을 최우선으로 점검하고, 공식 공고 2중 확인 중심으로 취업부 브리핑을 자동 생성했습니다.'
        : '공식 API 키가 아직 연결되지 않아 자동 수집 대기 상태입니다.'
    },
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
      jobAlioKeywordQueries: JOB_ALIO_KEYWORD_QUERIES.map((query) => `${query.searchType}:${query.keyword}`),
      jobAlioCriticalWatchInstitutions: CRITICAL_JOB_ALIO_ORGS.map((org) => org.orgName),
      jobAlioCurrentCriticalItems: CRITICAL_CURRENT_JOB_ALIO_ITEMS.map((item) => ({
        id: item.id,
        idx: item.idx,
        company: item.company,
        deadline: item.deadline
      })),
      financeLargeCompanyOfficialWatchCount: FINANCE_LARGE_COMPANY_OFFICIAL_WATCHLIST.length,
      financeLargeCompanyOfficialWatchEmployers: FINANCE_LARGE_COMPANY_OFFICIAL_WATCHLIST.map((entry) => entry.employer),
      financeLargeCompanySignalRule: '대기업·1금융·2금융 공식 채용 페이지에서 고졸·특성화고·졸업예정·학력무관·기술직·생산직·행원 등 응시 가능 신호와 채용 신호가 함께 확인될 때만 후보로 정규화한다.',
      regionalEducationOfficialWatchCount: REGIONAL_EDUCATION_OFFICIAL_WATCHLIST.length,
      regionalEducationOfficialWatchEmployers: REGIONAL_EDUCATION_OFFICIAL_WATCHLIST.map((entry) => entry.employer),
      regionalEducationSourceRule: '교육청 취업지원센터·학교 채용 소식은 직접 결과 카드로 노출하지 않는다. 잡알리오·고용24·기관·기업 공식 원문이 1차 채용 공고로 확인된 뒤, 같은 채용인지 맞는 경우에만 누락 보완과 2차·3차 보조검증 출처로 붙인다.',
      zipAttachmentRule: 'ZIP 첨부는 자동 수집 단계에서 중앙 디렉터리 파일명을 읽어 archiveEntries로 보관하고, 화면에서는 원본 ZIP 링크 아래에 내부 폴더·파일 목록을 펼쳐 표시한다.',
      seoulHighJobScanPages: SEOUL_HIGHJOB_SCAN_PAGES,
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
        description: '필기시험 신호가 없는 채용. 마감, 전형, 자격, 첨부자료를 공식 소스에서 자동 요약하고 변동 항목은 다음 수집에서 다시 대조한다.'
      }
    ],
    sourceStatus: sourceStatusList,
    archiveItems,
    items
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(`${OUT_FILE}.tmp`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(`${OUT_FILE}.tmp`, OUT_FILE);
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
      sourcesChecked: 0,
      sourcesConfigured: 0,
      sourcesReady: 0,
      sourcesMissingSetup: SOURCE_CATALOG.length,
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
        description: '필기시험 신호가 없는 채용. 마감, 전형, 자격, 첨부자료를 공식 소스에서 자동 요약하고 변동 항목은 다음 수집에서 다시 대조한다.'
      }
    ],
    secretReadiness: buildSecretReadinessReport(sourceStatusList),
    sourceStatus: sourceStatusList,
    archiveItems: [],
    items: []
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.error(`job-feed failed: ${error.message}`);
  process.exitCode = 1;
});
