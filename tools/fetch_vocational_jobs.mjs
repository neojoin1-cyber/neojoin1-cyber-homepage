import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_FILE = path.join(ROOT_DIR, 'assets', 'job-feed.json');

await loadLocalEnvFile(path.join(ROOT_DIR, '.env.local'));

const NOW = new Date();
const CHECKED_AT = NOW.toISOString();
const MAX_ITEMS = 40;
const REQUEST_TIMEOUT_MS = 18000;
const DETAIL_FETCH_CONCURRENCY = 6;
const APPLICATION_CLOSED_RETAIN_DAYS = 21;
const JOB_ALIO_SCAN_LIMIT = 40;
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
const PROFESSIONAL_ONLY_TERMS = ['전문의', '의사', '약사', '간호사', '방사선사', '공인회계사', '회계사', '변호사', '세무사', '노무사', '법무사', '건축사', '면허 소지', '면허소지', '석사', '박사', '기술사'];
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
const SENIOR_ROLE_PATTERN = /(원장|센터장|기관장|본부장|부원장|개방형\s*직위|전문계약직|연봉계약직|임원|상임감사|비상임감사|감사위원|이사장|대표이사)/;
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
    setupHint: '교육청 취업지원센터 공식 RSS/API URL 묶음을 EDU_JOB_CENTER_FEEDS에 줄바꿈 또는 쉼표로 저장하면 지역 피드를 순회한다.'
  },
  'finance-large-company-recruit': {
    urlSecrets: ['FINANCE_RECRUIT_FEEDS', 'LARGE_COMPANY_RECRUIT_FEEDS'],
    keySecrets: ['FINANCE_RECRUIT_API_KEY', 'LARGE_COMPANY_RECRUIT_API_KEY'],
    setupHint: '은행·금융공기업·대기업 채용 공식 공지/RSS/API URL 묶음을 FINANCE_RECRUIT_FEEDS 또는 LARGE_COMPANY_RECRUIT_FEEDS에 저장하면 공식 공채 후보를 순회한다.'
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
    actionLabel: '금융권·대기업 공식 공채 피드 등록',
    impact: '은행·금융공기업·대기업의 고졸 공개채용을 회사 또는 채용대행 공식 공지 기준으로 보강한다.',
    easySteps: [
      '은행·금융공기업·대기업 채용 공식 공지/RSS/API URL을 확인한다.',
      '여러 URL은 줄바꿈 또는 쉼표로 묶어 FINANCE_RECRUIT_FEEDS 또는 LARGE_COMPANY_RECRUIT_FEEDS Secret에 저장한다.',
      '공채 상세는 공식 원문과 채용대행 원문을 2중 확인한 뒤 전형일정·첨부자료 중심으로 표시한다.'
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
    actionLabel: '교육청 취업지원센터 피드 묶음 등록',
    impact: '지역별 특성화고 취업지원센터 소식을 한곳으로 모으는 기반이다.',
    easySteps: [
      '교육청별 공식 RSS/API/게시판 피드 URL을 확인한다.',
      '여러 URL을 줄바꿈 또는 쉼표로 묶어 EDU_JOB_CENTER_FEEDS Secret에 저장한다.',
      '공식 피드 구조가 확인되면 지역별 어댑터로 정확도를 높인다.'
    ]
  },
  'jobkorea-rookie': {
    priority: 'P2',
    actionLabel: '잡코리아 공식 제휴/API 확인',
    impact: '고졸채용 루키와 중견기업 채용 후보를 보강한다.',
    easySteps: [
      '잡코리아 공식 제휴 또는 허용된 API 경로를 확인한다.',
      '키는 JOBKOREA_API_KEY, URL은 JOBKOREA_API_URL Secret에 저장한다.',
      '필기 없는 채용은 간단 정보와 회사 확인 안내 중심으로 표시한다.'
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
    type: 'official-channel-pending',
    sourceUrl: '',
    group: 'finance-large-company',
    trackHint: 'exam',
    status: 'pending',
    secretNames: ['FINANCE_RECRUIT_FEEDS', 'LARGE_COMPANY_RECRUIT_FEEDS', 'FINANCE_RECRUIT_API_KEY', 'LARGE_COMPANY_RECRUIT_API_KEY'],
    message: '은행·금융공기업·대기업 채용 공식 공지/RSS/API 묶음 확인 후 연결'
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

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  const raw = normalizeSpace(value);
  if (!raw) return [];
  return Array.from(new Set(raw
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean)))
    .slice(0, 20);
}

function configuredUrlsForSource(config) {
  return Array.from(new Set((config.urlSecrets || [])
    .flatMap((secretName) => splitSecretUrls(readSecret(secretName)))))
    .filter(Boolean);
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

function genericRecordToRaw(record, source, publicSourceUrl) {
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
  ]);
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
  ]));
  return {
    source: source.id,
    sourceName: source.name,
    sourceId: pickRecordField(record, ['id', 'idx', 'seq', 'sn', 'no', '공고번호', '채용공시ID', 'recruitId', 'recrutPbancNo', 'pbancNo']) || sha([source.id, title, company, detailUrl].join('|')),
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
      source.name
    ].join(' '))
  };
}

function parseGenericOfficialFeed(body, source, sourceUrl) {
  const trimmed = body.trim();
  const publicSourceUrl = source.sourceUrl || safePublicFeedUrl(sourceUrl);
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const payload = JSON.parse(trimmed);
    return collectJsonRecords(payload).map((record) => genericRecordToRaw(record, source, publicSourceUrl));
  }
  if (trimmed.startsWith('<')) {
    return collectXmlRecords(trimmed, publicSourceUrl).map((record) => ({
      ...record,
      source: source.id,
      sourceName: source.name,
      sourceId: sha([source.id, record.title, record.company, record.url].join('|')),
      sourceDetailUrl: publicSourceUrl
    }));
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
  } else if (source?.trackHint === 'exam' || ['public-institution', 'government', 'military', 'finance', 'finance-large-company', 'large-company'].includes(sector)) {
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
  const interviewLine = keywordSnippet([processText, detailText].join(' '), ['면접', '면접전형', '심층면접'], '면접 일정·방식 원문 확인');
  const resultLine = keywordSnippet([processText, detailText].join(' '), ['합격자', '최종합격', '발표', '임용'], '합격자 발표·임용일 원문 확인');
  const attachmentLines = attachments.length
    ? attachments.map((item) => `${item.title}: ${item.url}`)
    : ['공고문·입사지원서·직무기술서는 공식 공고에서 확인 필요'];
  const applicationLine = status === 'application_closed'
    ? (deadline ? `${deadline} 원서 마감` : '원서 마감')
    : firstText(raw.deadlineText, deadline ? `${deadline} 마감` : '', applicationMethod, '마감일 원문 확인');

  const summaryLines = compactTags([
    `${company} ${isPublicRecruit ? '공채·공식전형' : '채용정보'}`,
    recruitField ? `채용부문: ${recruitField}` : `공고명: ${title}`,
    recruitNumber ? `채용규모: ${recruitNumber}` : '',
    `학력·자격: ${shortText(eligibility, '응시자격 원문 확인', 120)}`,
    raw.region ? `근무지: ${shortText(raw.region, '원문 확인', 80)}` : '',
    raw.employmentType ? `고용형태: ${shortText(raw.employmentType, '원문 확인', 80)}` : ''
  ]);

  const scheduleLines = compactTags([
    `원서접수: ${shortText(applicationLine, '마감일 원문 확인', 120)}`,
    `전형절차: ${shortText(processText, process.processNote, 150)}`,
    `필기전형: ${shortText(writtenExamLine, '필기 원문 확인', 120)}`,
    `면접전형: ${shortText(interviewLine, '면접 원문 확인', 120)}`,
    `발표·임용: ${shortText(resultLine, '발표·임용 원문 확인', 120)}`
  ]);

  const schoolActionItems = compactTags([
    verification.doubleCheckLabel,
    schoolRecommendation === 'required' ? '학교장 추천 가능 인원과 추천 기준 확인' : '학교장 추천 필요 여부 원문 확인',
    '지원 가능 학년·졸업예정 기준 확인',
    '공고문·입사지원서·직무기술서 첨부 확보',
    process.writtenExam === 'not_found' ? '회사 인사담당자에게 세부 조건 확인' : '필기/NCS 대비 일정 안내',
    collectionAudit.missedReviewNeeded ? '공고 게시일과 첫날 수집 누락 여부 점검' : '공고 게시 첫날 수집 기록'
  ]);

  const studentActionItems = compactTags([
    '원서접수 마감 전 지원계정·제출서류 확인',
    schoolRecommendation === 'required' ? '학교장 추천 신청 서류 준비' : '',
    process.writtenExam === 'not_found' ? '면접 예상 질문과 회사 직무 확인' : 'NCS·직무능력·인적성 대비',
    '자기소개서·경험기술서 초안 작성',
    '근무지·고용형태·임용예정일 확인'
  ]);

  const sourceLines = compactTags([
    officialUrl ? `공식 원문: ${officialUrl}` : '공식 원문 URL 확인 필요',
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
    ...schoolActionItems.slice(0, 5).map((line) => `- ${line}`),
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
    label: isPublicRecruit ? '취업부 공채 브리핑' : '간단 채용 확인 브리핑',
    detailLevel: isPublicRecruit ? servicePolicy.detailLevel : 'brief-company-contact',
    headline: `${company} - ${title}`,
    summaryLines,
    scheduleLines,
    examSubjects,
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
      hiring: compactTags([
        normalizeSpace(raw.recruitField || raw.jobField || raw.workField || raw.position),
        normalizeSpace(raw.recruitNumber || raw.hiringCount || raw.recruitCount)
      ]).join(' · ') || '채용부문·규모 원문 확인',
      eligibility: [normalizeSpace(raw.education), normalizeSpace(raw.career)].filter(Boolean).join(' · ') || '응시자격 원문 확인',
      process: normalizeSpace(raw.processText || process.processNote).slice(0, 260) || '전형절차 원문 확인',
      application: status === 'application_closed'
        ? (deadline ? `${deadline} 원서 마감` : '원서 마감')
        : normalizeSpace(raw.deadlineText) || (deadline ? `${deadline} 마감` : '마감일 원문 확인'),
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

function dedupeAndSort(items) {
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

function itemDedupeQuality(item) {
  const verificationWeight = {
    company_notice_confirmed: 50,
    company_notice_reachable: 42,
    company_notice_linked: 34,
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
    for (const params of paramAttempts) {
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
    }
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
    recruitField: workField,
    qualification,
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
    const details = await mapWithConcurrency(rows, DETAIL_FETCH_CONCURRENCY, async (row) => {
      try {
        return await fetchJobAlioDetail(row);
      } catch (error) {
        errors.push(`${row.idx}: ${error.message}`);
        return null;
      }
    });
    rawItems.push(...details.filter(Boolean));
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
  if (!shouldKeep(item)) return false;
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

  const normalized = rawItems.map(normalizeItem).filter(keepSeoulHighJobItem);
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
        ? `서울 하이잡 공식 목록 ${scannedCount}건 점검, 후보 ${normalized.length}건, 공식 공고 확인 ${companyChecked}건, 첫날 수집 ${firstDayCandidates}건, 누락점검 ${missedReview}건`
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

  const urls = configuredUrlsForSource(config);
  const key = readSecret(...(config.keySecrets || []));
  const configured = urls.length > 0 || Boolean(key);
  if (!urls.length) {
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

  const rawItems = [];
  const errors = [];
  let successCount = 0;
  for (const sourceUrl of urls) {
    try {
      const requestUrl = injectSecretIntoUrl(sourceUrl, key);
      const body = await fetchWithTimeout(requestUrl, {
        headers: {
          Accept: 'application/json,application/xml,text/xml,text/html;q=0.9,*/*;q=0.7',
          ...(key ? { Authorization: `Bearer ${key}`, 'X-API-Key': key } : {})
        }
      });
      const records = parseGenericOfficialFeed(body, source, sourceUrl);
      rawItems.push(...records);
      successCount += 1;
    } catch (error) {
      errors.push(error.message);
    }
  }

  const normalized = rawItems.map(normalizeItem).filter(shouldKeep);
  const ok = successCount > 0 && errors.length < urls.length;
  return {
    items: normalized,
    status: sourceStatus({ ...source, configured: true }, {
      ok,
      itemCount: normalized.length,
      scannedCount: rawItems.length,
      configuredFeedCount: urls.length,
      message: ok
        ? `공식 설정 피드 ${successCount}/${urls.length}개 확인, 후보 ${normalized.length}건`
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
  const requiredSecrets = secretNamesForSource(source);
  const configuredSecrets = requiredSecrets.filter(hasSecret);
  const missingSecrets = requiredSecrets.filter((secretName) => !hasSecret(secretName));
  const genericConfig = GENERIC_OFFICIAL_SOURCE_CONFIG[source.id];
  const urlSecrets = genericConfig?.urlSecrets || [];
  const configuredUrls = genericConfig ? configuredUrlsForSource(genericConfig).length : 0;
  const keySecrets = genericConfig?.keySecrets || [];
  const requiredUrlReady = !urlSecrets.length || configuredUrls > 0;
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
    configuredSecretNames: configuredSecrets,
    missingSecretNames: missingSecrets,
    configuredFeedCount: configuredUrls,
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

function buildCollectionReview(items, sourceStatusList) {
  const missedReviewItems = items
    .filter((item) => item.collectionAudit?.missedReviewNeeded)
    .map(reviewItem)
    .slice(0, 12);
  const officialNoticePendingItems = items
    .filter((item) => item.processTrack === 'exam-formal'
      && !['company_notice_confirmed', 'company_notice_reachable'].includes(item.sourceVerification?.doubleCheckStatus))
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

  return {
    status: missedReviewItems.length || officialNoticePendingItems.length || sourceGaps.length ? 'review_needed' : 'normal',
    generatedAt: CHECKED_AT,
    firstDayGoal: '공채는 게시 첫날 수집을 목표로 하며, 늦게 발견된 공고는 누락 점검 대상으로 기록한다.',
    missedReviewCount: missedReviewItems.length,
    officialNoticePendingCount: officialNoticePendingItems.length,
    sourceGapCount: sourceGaps.length,
    missedReviewItems,
    officialNoticePendingItems,
    sourceGaps,
    nextActions: [
      '누락점검 공고는 게시일 기준 공식 소스 연결 주기를 확인한다.',
      '공식 공고 미확인 공채는 회사·기관 또는 채용대행 공식 공지 URL을 보강한다.',
      '미연결 소스는 API Secret 또는 허용된 공식 피드 경로를 확인한다.'
    ]
  };
}

async function main() {
  const previousItems = await readPreviousItems();
  const results = [];
  results.push(await fetchMpmPublicJob());
  results.push(await fetchMoefPublicRecruit());
  results.push(await fetchWork24OpenRecruit());
  results.push(await fetchJobAlioRecruit());
  results.push(await fetchSeoulHighJobRecruit());
  results.push(await fetchSaraminJobSearch());
  results.push(...await pendingCatalogSources());

  const sourceStatusList = results.map((result) => result.status);
  const freshItems = results.flatMap((result) => result.items);
  const sourceFallbackItems = fallbackFailedSourceItems(previousItems, sourceStatusList, freshItems);
  const currentItems = dedupeAndSort([...freshItems, ...sourceFallbackItems]);
  const items = currentItems.length
    ? mergePreviousAudit(currentItems, previousItems)
    : fallbackPreviousItems(previousItems);
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
  const briefingReady = items.filter((item) => item.teacherBriefing?.teacherShareText).length;
  const firstDayCollected = items.filter((item) => item.collectionAudit?.firstDayCollected).length;
  const lateDetected = items.filter((item) => item.collectionAudit?.firstDayStatus === 'late_detected').length;
  const missedReviewNeeded = items.filter((item) => item.collectionAudit?.missedReviewNeeded).length;
  const staleFallbackItems = items.filter((item) => item.staleSourceFallback).length;
  const sourcesConfigured = sourceStatusList.filter((source) => source.configured).length;
  const collectionReview = buildCollectionReview(items, sourceStatusList);
  const secretReadiness = buildSecretReadinessReport(sourceStatusList);

  const payload = {
    version: 4,
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
      briefingReady,
      firstDayCollected,
      lateDetected,
      missedReviewNeeded,
      staleFallbackItems,
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
      jobAlioScanLimit: JOB_ALIO_SCAN_LIMIT,
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
        description: '필기시험이 확인되지 않은 중견기업 중심 채용. 핵심 조건만 간단히 제공하고 세부 조건은 회사 확인을 안내한다.'
      }
    ],
    secretReadiness: buildSecretReadinessReport(sourceStatusList),
    sourceStatus: sourceStatusList,
    items: []
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.error(`job-feed failed: ${error.message}`);
  process.exitCode = 1;
});
