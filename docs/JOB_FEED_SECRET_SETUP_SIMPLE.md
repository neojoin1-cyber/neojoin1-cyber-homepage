# 채용정보 API 키 연결 쉬운 순서

이 문서는 선생님이 직접 해야 할 일을 최대한 단순하게 정리한 운영용 체크리스트다. API 키 값은 문서, 채팅, 코드, 커밋에 적지 않는다.

## 가장 쉬운 기본 순서

고용24 OPEN-API는 가장 먼저 확보할 핵심 키지만, 그것 하나만 있으면 끝나는 구조는 아니다. 서울특별시교육청 하이잡처럼 별도 키 없이 공식 공개 페이지에서 확인 가능한 교육청 소스는 시스템이 전용 어댑터로 직접 점검한다.

1. GitHub 저장소 `neojoin1-cyber-homepage`로 이동한다.
2. `Settings`를 누른다.
3. 왼쪽 메뉴에서 `Secrets and variables` -> `Actions`를 누른다.
4. `New repository secret`을 누른다.
5. `Name`에는 아래 표의 Secret 이름을 그대로 넣는다.
6. `Secret`에는 발급받은 키 또는 공식 피드 URL을 붙여 넣는다.
7. `Add secret`을 누른다.
8. 저장 후 `Actions` 탭에서 `Update vocational job feed`를 직접 실행하거나, 하루 3회 자동 실행을 기다린다.

## 우선순위

| 우선 | 소스 | 넣을 Secret 이름 | 선생님이 할 일 |
| --- | --- | --- | --- |
| 1 | 고용24 공채속보 | `WORK24_AUTH_KEY` 또는 `WORKNET_AUTH_KEY` | 고용24 OPEN-API 인증키 확보 후 Secret 저장 |
| 2 | 사람인 공채/채용 API | `SARAMIN_ACCESS_KEY` | 사람인 Open API 접근키 확보 후 Secret 저장 |
| 3 | 서울특별시교육청 하이잡 | 없음 | 별도 키 없이 시스템이 공식 채용정보 목록과 상세 원문 자동 확인 |
| 4 | 나라일터 | `NARAILTER_API_URL`, 필요 시 `NARAILTER_API_KEY` | 공식 API 또는 허용된 피드 URL 확인 후 Secret 저장 |
| 5 | 군 부사관·군무원 | `MILITARY_RECRUIT_API_URL`, 필요 시 `MILITARY_RECRUIT_API_KEY` | 각 군 또는 국방부 공식 채용 데이터 경로 확인 |
| 6 | 지역별 교육청 취업지원센터 | `EDU_JOB_CENTER_FEEDS` | 서울 외 교육청 공식 RSS/API URL을 줄바꿈 또는 쉼표로 모아 저장 |
| 7 | 잡코리아 고졸채용 루키 | `JOBKOREA_API_URL`, 필요 시 `JOBKOREA_API_KEY` | 공식 제휴/API 가능 여부 확인 |
| 8 | 인크루트 고졸·신입 | `INCRUIT_API_URL`, 필요 시 `INCRUIT_API_KEY` | 공식 제휴/API 가능 여부 확인 |
| 9 | 비영리·공익기관 | `NONPROFIT_RECRUIT_API_URL`, 필요 시 `NONPROFIT_RECRUIT_API_KEY` | 공식 채용 피드 경로 확인 |

## 절대 하지 않을 일

- API 키를 채팅창에 붙여 넣지 않는다.
- `.env`, `.env.local`, HTML, JavaScript, Markdown 문서에 실제 키를 쓰지 않는다.
- 개인 계정 비밀번호나 콘솔 로그인 정보를 공유하지 않는다.
- 공식 허가가 불명확한 무단 크롤링으로 서비스를 시작하지 않는다.

## 키가 들어온 뒤 시스템이 하는 일

- Secret 값은 출력하지 않고 준비 상태만 `assets/job-feed.json`의 `secretReadiness`에 기록한다.
- 고용24와 사람인은 전용 어댑터로 수집한다.
- 서울특별시교육청 하이잡은 전용 어댑터로 수집한다.
- 나라일터, 군 채용, 서울 외 교육청 등은 먼저 범용 JSON/XML/RSS 어댑터로 읽고, 구조가 확인되면 전용 어댑터로 강화한다.
- 공채는 회사·기관 또는 채용대행 공식 공고를 우선 원문으로 삼고, 부족한 내용만 다른 공식 소스로 보완한다.
