# T07 다음 작업 · 2026-10-02

현재 로컬 인증 구현과 합성 검사를 마쳤다. 공식 원문은 `docs/TASK-SOURCE.md`, 전체 기준과 최신 상태는 `docs/TASK-READBACK.md`, 구현과 한계는 `docs/AUTH-IMPLEMENTATION.md`를 읽는다. 상속한 T06 보고서·제출·검증 파일을 T07 완료 증거로 쓰지 않는다.

## 현재 구현

- Node 24.18.0, `crypto.scrypt` N=32768/r=8/p=3, 16바이트 random salt, 32바이트 저장 hash.
- 직접 작성한 인증 라우팅 + 서버 DB 세션. 세션 token 32바이트 random, DB에는 SHA256만 저장. 로그인 후 최대 8시간. 매 요청 DB 확인, 로그아웃은 해당 세션 삭제, 비밀번호 변경은 모든 세션 삭제.
- 기본 실행 `npm start`, `127.0.0.1:8009`. `.data/t07`만 사용한다. 환경 예시는 `.env.example`.
- 로그인 계정 UUID로만 계정별 SQLite를 열고 기존 7표 동작을 유지한다. 브라우저 계정 지정은 무시한다.
- 자동 36개, 브라우저 합성 10개 통과. 상세는 `verification/auth-local.json`, `auth-browser.json`.
- 기존 T06 최종 제출 `b9de0298cd200961eac56286c6a6a55299947a96`가 조상. 현재 branch `t07-auth`, local remote `t06-baseline`; GitHub origin 미준비.

## 다음 순서

1. **공개 운영 저장소를 정하고 구현한다.** 현재 Vercel entry는 503이다. 계정별 SQLite가 살아 있는 Node 서버/지속 볼륨 또는 서버 세션을 매 요청 확인하는 PostgreSQL 저장소가 필요하다. 기존 T06 공개 Supabase 스키마와 `.env/.vercel`을 가져오지 않는다. managed Auth를 선택한다면 로그아웃 뒤 JWT 잔여 유효 시간을 서버 검사로 막아야 한다.
2. **T06 실제 자료 이관을 준비한다.** 기존 운영 export와 보존 export를 읽기 전용으로 대조하고 실제 계정은 사용자가 만든다. source ID·날짜·값·7표 관계를 그대로 보존해 빈 T07 개인 계정에 연결하고 원본은 보존한다. 이관·삭제는 아직 실제 계정에서 수행하지 않았다.
3. **5일 관찰 기능을 구현한다.** 사용자 선택 지표 `완료한 할 일 수(개)`. 질문·첫 규칙은 `docs/OBSERVATION-PLAN.md` 제안과 사용자 답을 반영한다. 날짜별 확인 기록, 계산 규칙 고정, 2일차 뒤·3일차 앞 단 한 번의 계획 규칙 변경, 합계·평균·기여 기록, 전체 한 파일 export를 저장 구조에 추가한다. 현재 기존 See는 T06 분 집계이며 5일 관찰 화면이 아니다.
4. **실제 5일 사용**을 사용자 기록으로 확보한다. 합성 시험/과거 T06 자료를 대신 쓰지 않는다. 실제 1~2일차를 본 다음 변경 이유·참조·시각을 사용자와 정한다.
5. 공개 HTTPS·시크릿 창 로그인 첫 화면, 공개 소스 full commit·T06 ancestry, 최종 비밀값 검사를 확인한다. 설명서의 로컬 근거를 실제 운영 근거와 구분해 갱신하고 제출 문안의 미완료를 해소한다. 플랫폼 제출은 아직 하지 않았다.

## 브라우저 검사 재현

다음 명령은 전용 합성 저장소를 사용한다. 실제 계정/운영 환경을 대상으로 실행하지 않는다.

```powershell
$env:PORT='8010'
$env:DIARY_RECORD_ORIGIN='synthetic'
$env:DIARY_AUTH_DIRECTORY='.test-data/browser-auth'
node server.mjs
```

다른 터미널에서 설치된 gstack 소스 CLI를 지정한다. Windows compiled browse 실행이 EEXIST로 실패해 같은 설치의 Bun source entry를 사용했다. `.gstack`은 무시된 격리 검사 상태다.

```powershell
$env:T07_BROWSE_BUN='C:\Users\Administrator\.bun\bin\bun.exe'
$env:T07_BROWSE_CLI='C:\Users\Administrator\.agents\skills\gstack\browse\src\cli.ts'
node scripts/verify-auth-browser.mjs
```

helper가 무작위 합성 계정을 UI로 생성하며 원문 credential을 출력/보고서에 저장하지 않는다. 서버를 종료한 뒤 합성 DB의 보관·정리는 실제 확인 결과대로 기록한다. 아직 삭제하지 않은 테스트 계정을 삭제했다고 적지 않는다.
