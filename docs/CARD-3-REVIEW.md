# 카드 3 — 세션과 종료 확인

확인일: 2026-10-02, 한국 시간. [공식 원문](./TASK-SOURCE.md)의 첫 행동·8개 통과 기준·확인 순서·남길 것을 현재 코드와 보존한 검사 기록에 대조했다. 이번에는 Git의 알려진 비밀값 검사를 다시 수행했으며, 본인 계정 로그아웃·비밀번호 변경·만료 또는 운영 계정 시험은 새로 수행하지 않았다.

**판정: 세션 구현·로그아웃/변경/만료 검사 근거와 제출 초안은 준비됐다.** 만료는 시험 시각 조절 결과다. 비밀값 검사 범위와 실제 배포 bundle 미검사는 아래에 명시하며 최종 제출 전에 최신 묶음을 다시 점검한다.

## 첫 행동과 구현

- 사람을 알아보는 방식: 서버 DB 세션. 무작위 32바이트 세션값을 공개 Secure/HttpOnly/SameSite=Strict 쿠키로 전달하며 DB에는 SHA256만 저장한다.
- 같은 공개 URL·GET·기존 인증값을 보관한 요청의 로그아웃 전 200/후 401을 설명서와 제출 초안에 나란히 적었다. Cookie·CSRF 원문은 공개하지 않는다.
- 수명: 발급부터 8시간, 자동 연장 없음. 응답에 expires_at이 있고 매 요청 서버 DB에서 만료를 검사한다.
- URL에 인증값을 넣지 않는 코드, 고정 서명키를 쓰지 않는 구조, 운영 비밀값의 서버 환경 변수와 Git/배포 업로드 제외 설정, 알려진 비밀값 검사를 연결했다.

## 통과 기준 8개

| 공식 기준 | 확인 결과 | 근거 |
|---|---|---|
| C108 알아보는 방식 명시 | 서버 DB 세션을 설명서·초안에 명시 | [설명서 ①·③·④](./AUTH-IMPLEMENTATION.md), [제출 초안](./SUBMISSION.md) |
| C109 성공·로그아웃 뒤 거절을 나란히 기록 | 공개 GET /api/state 200 → POST logout 200 → 기존 값 GET /api/state 401 | [production-api.json](../verification/production-api.json) same-old-auth-after-logout, 설명서 ④, 제출 초안 |
| C110 같은 주소·방식·기존 값 | 검사 코드가 보관한 oldA로 동일 GET/헤더를 전후 전달. 보고서의 same_url_method_cookie=true | [검사 코드](../scripts/verify-production.mjs), production-api.json |
| C111 만료시각과 수명 명시 | 28,800초, expires_at 반환, 매 요청 만료 확인. 공개 시험 만료 401, 로컬 경계 전 200/경계 401 | [identity-postgres.mjs](../src/identity-postgres.mjs), [identity-sqlite.mjs](../src/identity-sqlite.mjs), production-api.json forced-test-session-expiry, [auth-local.json](../verification/auth-local.json) expiry-boundary |
| C112 인증값을 URL에 넣지 않음 | Cookie에서만 세션을 읽음. 클라이언트 호출 URL에 세션값을 추가하지 않음 | [http.mjs](../src/http.mjs) sessionToken/cookie, [auth.mjs](../public/auth.mjs), [app.mjs](../public/app.mjs), 검사 요청 path |
| C113 발급 비밀키의 노출 없음 | 세션은 randomBytes로 만들며 고정 서명키 없음. 운영 비밀값은 서버 환경 변수, 공개 소스/업로드 제외 설정과 알려진 값 Git 검사 연결 | identity-postgres.mjs login, [.gitignore](../.gitignore), [.vercelignore](../.vercelignore), [배포 설정](../vercel.json), [환경 설정 코드](../scripts/configure-vercel-cloud.mjs), [현재 Git 검사](../verification/history-secret-check-card-3.json) |
| C114 종료·비밀번호 변경 뒤 이전 값 거절 | 로그아웃은 해당 세션 삭제. 변경은 계정의 모든 세션 삭제 트랜잭션. 기존 두 세션 각각 401 | production-api.json same-old-auth-after-logout / password-change-all-sessions-denied, identity-postgres.mjs logout/changePassword |
| C115 기록에서 인증값 가림 | Cookie·Set-Cookie·CSRF는 REDACTED. 실제 원문은 증거에 넣지 않음 | production-api.json, 검사 코드 redact 및 직렬화 검사, 설명서·초안의 비교 표 |

## 검증 범위와 남길 것

로그아웃 전후의 주소·방식·인증값은 동일하고 사이에 로그아웃 요청만 있다. 단순히 브라우저 쿠키를 지워서 익명 거절을 얻은 검사가 아니다. 성공 응답은 문서에 ok 필드만 발췌했으며 원래 JSON에 전체 합성 state와 401 응답이 있다. 시험 계정은 검사 후 삭제됐다. 실제 사용자 자료·실제 5일 관찰로 쓰지 않는다.

공개 만료는 시험 계정의 DB expires_at을 과거로 바꾼 뒤 기존 값이 401인지 확인했다. 로컬 경계 검사는 제어된 시계와 60초 시험 수명을 사용했고 운영 28,800초 설정도 기록했다. 실제 8시간 기다린 결과라고 적지 않는다.

현재 [Git 검사](../verification/history-secret-check-card-3.json)는 기록된 reviewed_source_head에서 도달 가능한 blob 236개를 실제 로컬 DB 비밀번호·Vercel OIDC 원문 두 값과 대조했다. 둘 다 발견되지 않았다. 원래 history-secret-check.json은 덮어쓰지 않고 별도 결과를 남겼다. 해당 HEAD 뒤 문서 커밋이 이 검사에 포함됐다고 주장하지 않는다. 현재 파일의 구문·알려진 값/패턴 검사는 별도로 수행한다.

고정 세션 서명키는 없고 DB 접속 비밀번호는 공급자 서버 환경에 필요하다. .env*는 업로드에서 제외되며 공개 출력은 public, 함수 포함 파일은 DB SQL과 공개 HTML로 지정돼 있다. 이것은 코드·설정·기록 검토이며 실제 원격 배포 bundle을 내려받아 모든 파일을 검사한 결과가 아니다. 알려진 두 값과 패턴 검사만으로 미지의 모든 비밀값 부재를 보장하지 않는다.

## 막힐 때 확인 순서

공식 순서대로 서버에서도 기존 값을 끊는지 → 만료 시각을 확인하는지 → 비밀번호 변경 때도 기존 값이 끊기는지 확인했다. logout의 DB 세션 행 삭제, authenticate의 expires_at 검사, changePassword의 모든 세션 삭제와 각각의 거절 응답을 연결했다. 다음은 카드 4의 양방향 읽기·수정·삭제 거절과 자료 불변 확인이다.
