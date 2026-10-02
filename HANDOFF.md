# T07 다음 작업 · 2026-10-02

현재 로컬 인증·5일 관찰·이관 기능과 합성 검사를 마쳤다. 공식 원문은 `docs/TASK-SOURCE.md`, 전체 기준과 최신 상태는 `docs/TASK-READBACK.md`, 구현과 한계는 `docs/AUTH-IMPLEMENTATION.md`를 읽는다. 상속한 T06 보고서·제출·검증 파일을 T07 완료 증거로 쓰지 않는다.

## 현재 구현

- Node 24.18.0, `crypto.scrypt` N=32768/r=8/p=3, 16바이트 random salt, 32바이트 저장 hash.
- 직접 작성한 인증 라우팅 + 서버 DB 세션. 세션 token 32바이트 random, DB에는 SHA256만 저장. 로그인 후 최대 8시간. 매 요청 DB 확인, 로그아웃은 해당 세션 삭제, 비밀번호 변경은 모든 세션 삭제.
- 기본 실행 `npm start`, `127.0.0.1:8009`. `.data/t07`만 사용한다. 환경 예시는 `.env.example`.
- 로그인 계정 UUID로만 계정별 SQLite를 열고 기존 7표 동작을 유지한다. 브라우저 계정 지정은 무시한다.
- 자동 45개, 인증 화면 10개 및 관찰/이관 화면 10개 통과. 모두 합성 검사이며 가상 날짜를 실제 사용으로 쓰지 않는다. 최신 근거는 observation-local.json·migration-local.json·observation-browser.json과 현재 로컬 계약 t07-schema-v3.json이다.
- 기존 T06 최종 제출 `b9de0298cd200961eac56286c6a6a55299947a96`가 조상. 현재 branch `t07-auth`, local remote `t06-baseline`; GitHub origin 미준비.

## 다음 순서

전체 충족 대조는 docs/ACCEPTANCE-AUDIT.md와 verification/acceptance-audit.json을 먼저 읽는다. 로컬만으로 최종 제출은 충족하지 않는다. 12자는 공식 조건이 아닌 AI 정책이며 현재 길이 기준은 바꾸지 않았다. 실제 관찰은 공개 운영 확인 뒤 시작하는 순서를 권한다. 이는 공식에 없는 로컬 관찰 금지 조건을 추가하는 것이 아니다.

1. **공개 운영 저장소를 정하고 구현한다.** 현재 Vercel entry는 503이다. 계정별 SQLite가 살아 있는 Node 서버/지속 볼륨 또는 서버 세션을 매 요청 확인하는 PostgreSQL 저장소가 필요하다. 기존 T06 공개 Supabase 스키마와 `.env/.vercel`을 가져오지 않는다. managed Auth를 선택한다면 로그아웃 뒤 JWT 잔여 유효 시간을 서버 검사로 막아야 한다.
2. **현재 T06 전체 자료를 이관한다.** 사용자가 2026-10-02 현재 공개 자료 전체를 기준으로 선택했다. 보존본 대비 계획 2→3, 이력 3→7, 할 일 7→8, 실행 3→4, 완료/요청 각 4→8, 회고 1→1이며 추가·수정을 보존한다. PT 자료도 포함한다. 읽기 전용 대조는 verification/t06-live-export-check.json, 이관 파일은 무시된 .test-data/t06-readonly/live-export.json이며 실행 순서는 docs/DATA-MIGRATION.md에 있다. 실제 계정은 사용자가 만든다. 비어 있는 본인 계정에 업로드 미리보기 후 가져오기를 수행하고 7표 digest를 대조한다. 원본을 보존한다. 현재 실제 계정 이관은 미수행이다.
3. **새 ALEPH 계획에서 실제 관찰을 시작한다.** 5일 탭과 저장·한 번의 변경·전후 비교·직접 입력한 손계산 대조·12표 전체 export는 구현했다. 사용자 지표는 `완료한 할 일 수(개)`. 질문과 첫 규칙은 사람이 직접 확정한다. 시작 날짜의 1일차를 확정하고, 매일 기록을 모두 마친 뒤 날짜를 확정한다. 확정 날짜에 추가 완료를 막는다. 2일차 뒤 실제 1~2일차를 보고 한 규칙 변경 후 3일차부터 진행한다. 규칙 변경은 미리 만들어 넣지 않는다.
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

## 최신 화면 검사 재현

위에서 지정한 gstack runtime 환경 변수로 `node scripts/verify-observation-browser.mjs`를 실행한다. helper 자체가 임시 합성 HTTP/SQLite 서버를 만들고 날짜를 제어한다. 실제 서버에는 날짜 제어 API가 없다. 5일 값은 [2,0,3,1,2], 합계 8·평균 1.6이며 기능 시험용이다. UI 이관·질문/규칙·변경·손계산·375px 및 계정 관리 버튼 가독성을 확인했다. helper 종료 시 임시 서버·DB를 정리한다.

1차 helper의 검사 10개는 통과했으나 종료 후 about:blank 이동을 gstack이 거절해 process가 1로 끝났다. 불필요한 이동을 제거한 뒤 같은 검사와 정리가 exit 0으로 끝났다. 모바일 계정 관리 버튼과 관찰 정보 배치를 보완한 최종 화면은 observation-mobile.png에 남긴다. 실패를 실제 기능 실패 또는 실사용 결과로 바꾸어 적지 않는다.