# T07 현재 상태와 다음 작업 · 2026-10-02

[해야 할 일 체크](docs/TODO.md) · [전체 공식 기준](docs/TASK-READBACK.md) · [충족 대조](docs/ACCEPTANCE-AUDIT.md) · [인증 설명](docs/AUTH-IMPLEMENTATION.md)

공개 앱: https://skt-aleph-project-7-diary-auth.vercel.app

## 완료한 것

- Node 24 인증/scrypt/8시간 DB 세션/CSRF/서버 소유자 결정/전체 export/계정 삭제.
- 전용 PostgreSQL vagluzmvitdtshjknxrp, 제한된 t07_server·RLS·검증된 TLS, 4물리표/12논리표 JSONB 원자 저장. T06 DB를 재사용하지 않았다.
- Vercel 전용 공개 프로젝트. 새 계정 없이 로그인 화면 접근, 실제 API 9개·화면 10개 통과. 추가 로그 검사의 최신 개수는 production-api.json을 따른다.
- 자동 48개·전용 DB 합성 13개 통과. 가상 5일을 실사용으로 쓰지 않는다. 시험 계정만 UUID를 제한해 정리한다.
- 현재 T06 전체 원본은 무시된 .test-data/t06-readonly/live-export.json에 보존. 읽기 전용 비교는 verification/t06-live-export-check.json. 건수 3/7/8/4/8/8/1, 보존본 2/3/7/3/4/4/1. PT와 변경 이력 모두 포함한다.
- 최종 T06 제출 b9de0298cd200961eac56286c6a6a55299947a96 조상 유지. 실제 원본 저장소는 별도로 보존한다.

## 계속할 순서

1. GitHub 공개 commit·push·익명 접근과 T06 보존 대조 결과를 확인한다. 최신 source URL은 docs/SUBMISSION.md를 따른다.
2. 사용자가 공개 앱에서 직접 본인 계정을 만들고 로그인한다. 비밀번호를 받거나 생성된 시험 계정을 본인 계정이라고 쓰지 않는다. 빈 계정에서 현재 전체 T06 파일의 미리보기/가져오기 후 7표 건수와 canonical digest를 비교한다.
3. 새 ALEPH 관찰 계획을 만든다. 지표는 사용자 선택 완료한 할 일 수(개). 질문·첫 규칙은 사용자 답과 실제 화면 확정이 필요하다. 시작일 안에 1일차를 확정한다.
4. 서로 다른 한국 날짜에 실제 5일. 2일차 뒤·3일차 앞에 실제 1~2일차를 보고 한 규칙만 변경한다. 그 이유·시각·정확한 참조를 남긴다. 미기록을 0으로 만들지 않는다.
5. 실제 5일 손계산/전후 비교/전체 export·사용자 판단을 확보한다. 공식 68개·완주 체크리스트·제출 항목·증거 가림을 모두 다시 대조한 뒤 플랫폼 제출·접수 증거를 남긴다. 현재 미제출이다.

## 재현과 구분

로컬: Node 24, npm ci → npm start, http://127.0.0.1:8009, 별도 .data/t07 계정별 SQLite. 공개 자료와 자동 동기화하지 않는다. npm test / npm run check로 로컬 검사.

cloud-integration.json은 실제 PostgreSQL + 로컬 HTTP + 가상 날짜, production-api.json과 production-browser.json은 실제 HTTPS + 합성 계정이다. 실제 5일은 0일이다. 실제 T06 이관은 actual-migration.json의 7표 digest 일치로 확인했다. 사용자 질문·첫 규칙은 채택됐고 계산 규칙 동의는 기다리는 중이다. 운영 검사는 무시된 전용 env와 검증한 CLI/Bun 경로가 필요하며 원문 credential을 출력하지 않는다. 브라우저 helper는 격리된 gstack만 사용한다. 개인 Chrome 상태를 바꾸지 않는다.

12자는 공식 조건이 아닌 AI 정책이며 아직 변경하지 않았다. MFA 없이 NIST 최소 15자 조건을 충족한다고 주장하지 않는다. 64KB 입력/2MB snapshot/공유 IP 횟수 제한 및 복구·이메일 인증 미구현을 설명서 ⑥에서 유지한다. secrets·실제 비공개 export를 Git에 넣지 않는다.
