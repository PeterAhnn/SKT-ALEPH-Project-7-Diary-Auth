# T06 인수인계

정리일: 2026-09-30

## 1. 목표

「플랜두씨 다이어리 1 — 내 계획과 실제를 담는 앱」의 실제 DB·Plan/Do/See·공개 결과물·검증한 전체 커밋을 완성하고 T07 기준점을 보존한다. 공식 전체 설명·카드 1~5·제출 화면 대조는 [docs/TASK-READBACK.md](docs/TASK-READBACK.md)에 있다.

## 2. 현재 상태

Node.js 24 기본 HTTP/ES modules 앱, 실제 SQLite, Vercel API/Supabase PostgreSQL 저장 계층을 구현했다. 실사용 DB에는 자동 합성 seed가 없다. 로그인 기능 없이 공식 공개 안내를 첫 화면에 표시한다.

승인 원계획 **ALEPH 과제 진행·검증 정리**에 Task7·현재 완료4·실측 실행3을 저장했다. 실행은 T05 실제 AI 협업 구간이며 예상300분은 승인된 AI 추천이다. 원자료 초·반올림 분·원시 시각은 [승인 자료](records/user-approved-recommendation.json)에 보존했다. 원계획 집계는 7/4/0/3, 예상300·실제18·차이−282분이다.

승인 자료를 빈 Supabase 프로젝트 **yynsaokvquggrbdrmalr**로 옮겼고 이전 시점의 7표·모든 필드·export 동일성을 확인했다. [verification/cloud-transfer.json](verification/cloud-transfer.json)을 따른다. 회고/다음 계획 추가 뒤 최신 전체 수량은 [docs/FINAL-REPORT.md](docs/FINAL-REPORT.md)를 확인한다.

사용자가 고른 개선 **작업 전에 파일 읽기와 검사 실행 권한부터 확인한다**를 cloud UI로 저장하고 다음 계획 **ALEPH 남은 검증 마무리**(2026-10-01~02, 예상135분)에 연결했다. 다음 계획에는 아직 할 일이 없다. 전체 cloud 수량은 Plan2/history3/Task7/Execution3/completion4/receipt4/review1이다.

앱/T07 기준점은 [b9de0298cd200961eac56286c6a6a55299947a96](https://github.com/PeterAhnn/SKT-ALEPH-Project-6-Diary/commit/b9de0298cd200961eac56286c6a6a55299947a96)이다. push·원격 해시·로그인하지 않은 GitHub 화면·HTTP/API200을 확인했다. 최종 Vercel 배포 dpl_EzpXjtay3cRvFr1vJXV2rPwV8JpM는 READY·Node24.x이며 메타데이터의3가지 전체해시가 기준점과 같다. [공개 앱](https://skt-aleph-project-6-diary.vercel.app)은 무인증 HTTP200·실제 PostgreSQL이며 내장 브라우저에 열어 두었다.

## 3. 실행 명령

Node.js 24가 필요하다. 외부 런타임 패키지 의존성은 없다.

    npm start
    npm test
    npm run check

기본 포트는 8006이다. .env의 Supabase URL/publishable 키가 있으면 PostgreSQL, 없으면 .data/diary.sqlite를 사용한다. 8006의 승인 자료 SQLite는 cloud 이전 시점 백업이며 이후 추가된 회고/다음 계획은 공개DB와 최종export에 보존했다. 일시적인 합성검사8007·cloud검사8008 서버는 작업 후 정리한다. 재개 시 실제 서버/포트 상태를 확인한다.

    node scripts/write-schema.mjs
    node scripts/transfer-to-cloud.mjs verify

스키마 생성은 실제 SQLite PRAGMA를 새로 읽고 저장된 운영 PostgreSQL 7표·58필드 카탈로그와 비교한다. 운영 조회 시각은 유지하며 새 cloud 검사로 표시하지 않는다. 이전 검증은 당시8006/8008의7표·export 동일성을 검사한 근거다. 회고 추가 뒤 local/cloud가 달라져 실패할 수 있고 자동 덮어쓰기를 하지 않는다. 승인 자료 가져오기를 다시 실행하려면 출처 해시와 현재 기록을 확인한다.

작업 폴더: C:\Users\Administrator\Desktop\SKT ALEPH\SKT-ALEPH\SKT-ALEPH-Project-6-Diary.

## 4. 통과 검사

- 로컬 자동 검사 27/27: 디스크 재시작, Plan 이력/충돌, 완료 중복/다시열기, Do 분리, 집계 경계/정렬, 삭제 복구, 다음 계획 단일 생성, 입력 거절, HTTP 안전성.
- 실제 PostgreSQL 익명 역할 35/35: RPC·중복/충돌·이력, 원시 테이블 쓰기/DELETE 제한, 잘못된 입력 거절. 최초 검사 [verify-postgres-result.json](db/verify-postgres-result.json)은 ROLLBACK 전후0건, 최적화 후 [verify-postgres-optimized-result.json](db/verify-postgres-optimized-result.json)은 실제 자료를 보존한35/35 결과다.
- Supabase security advisors 0건. 해당 검사 범위의 결과이며 모든 안전성 보증으로 확대하지 않는다.
- 승인 자료의 local/PG 7표 deep equality·ID/UTC 시각/버전/숫자 보존·한 파일 export 동일.
- 합성 UI 입력/완료/검색/상태 필터·See 기여 기록·삭제/복구 뒤 실행 유지·스크립트 모양 문자열의 문자 표시/미실행. 사용자 회고/다음 계획은 실제 cloud UI와 API 연결을 확인했다.

## 5. 남은 문제

구현·DB·공개 접근·모바일·다운로드·고정 소스와 배포 대조는 완료했다. [verification/delivery.json](verification/delivery.json), [public-verification.json](verification/public-verification.json), [public-write-validation.json](verification/public-write-validation.json)을 따른다. 최신 전체 설명·5단계와 현재 공개 자료를 다시 대조해 2026-09-30 18:10 서울에 공식 폼 제출을 마쳤다. [verification/platform-submission.json](verification/platform-submission.json)과 성공/대기 화면을 보존했다. 현재 **강사 승인 대기**이며 강사/마스터 승인·채점은 아직 완료되지 않았다.

## 6. 다음 행동

1. 사용자 검토는 [docs/REQUIREMENTS-CHECK.md](docs/REQUIREMENTS-CHECK.md)·[docs/FINAL-REPORT.md](docs/FINAL-REPORT.md)·[docs/SUBMISSION.md](docs/SUBMISSION.md)를 사용한다. 제출 완료와 강사/마스터 승인은 구분한다.
2. T07은 마스터 승인으로 실제 안내가 열린 뒤 최신 페이지를 먼저 읽고 시작한다. 위 앱 기준 전체 커밋·[contracts/pds-schema-v2.json](contracts/pds-schema-v2.json)·승인 정본·[verification/current-export.json](verification/current-export.json)·[browser-export.json](verification/browser-export.json)·T06 접수 기록을 보존한다.
3. 공개 자료는 편집 가능하므로 제출/다음 과제 전에 현재 상태와 보존된 export의 차이를 확인한다. 이후 보고서·근거 커밋은 앱 기준점을 대체하지 않는다.

## 7. 건드리지 말 것

- 공식 수량·집계·날짜 규칙, 제출 항목명과 실제 소문자 전체 커밋 /commit/ URL.
- 승인 원자료·원본 초/시각/해시와 T05 동결 근거. AI 협업을 직접 공부 시간으로 바꾸지 않는다.
- T06 로그인 없음·정확한 공개 안내, Plan 불변 이력·실행 분리·DB 요청 중복 방지.
- .env, .data, .test-data, .vercel은 Git 제외. 키를 제품 화면·보고서·제출·Git에 넣지 않는다. service-role/secret 키를 사용하지 않는다.
- 기존 인증 내장 브라우저 우선. 공개 접근/반복 QA는 격리된 gstack 세션이며 개인 Chrome 탭/탭 그룹을 만들지 않는다.
