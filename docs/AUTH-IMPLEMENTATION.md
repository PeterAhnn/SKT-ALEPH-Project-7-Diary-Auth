# T07 인증 구현 설명서 · 로컬과 공개 운영

2026-10-06 15:07 실제 1일차가 완료 3개로 확정됐다. 현재 1/5일이며 규칙 변경·손계산 대조는 아직 0건이다. [최신 진행과 다음 행동](./OBSERVATION-PROGRESS.md). 아래 시작 당시 0/5일·미완료 표기는 당시 기록으로 보존한다.

2026-10-06 09:48 새 관찰 시작 저장: 기존 기록을 보존하고 동일 기준으로 시작했다. 사용자 선택 할 일 3개가 모두 미완료로 등록됐고 실제 확정은 0/5일이다. [현재 진행과 오늘 할 일](./OBSERVATION-RESTART.md). 아래 이전 점검 수량은 당시 기록이다.

작성·검사일: 2026-10-02, 한국 시간(Asia/Seoul). 공식 여섯 항목을 아래에 연결했다. 로컬 구현과 공개 HTTPS 운영을 합성 계정으로 검사했다. T06 본인 계정 이관은 완료했고 실제 5일 사용과 최종 제출은 미완료다. [해야 할 일](./TODO.md), [전체 공식 기준](./TASK-READBACK.md), [원문](./TASK-SOURCE.md), [제출 초안](./SUBMISSION.md)을 함께 보며 T06 증거를 T07 사용 증거로 쓰지 않는다.

## ① 무엇으로 붙였나

직접 작성한 Node 인증 라우팅과 서버 DB 세션을 사용했다. 앱 버전은 `0.3.0`, 로컬 검사 환경은 Node `24.18.0`, OpenSSL `3.5.7`, SQLite는 `node:sqlite`다. 공개 운영은 Vercel Node 24 + Supabase PostgreSQL `17.11.0.002`, 연결 패키지는 `pg 8.23.1`이다. 관리형 Auth를 사용하지 않고 인증 정책·라우트·저장·세션 무효화 코드를 작성했다. 비밀번호 암호 알고리즘은 Node/OpenSSL의 `crypto.scrypt`를 사용한다.

비밀번호는 12자 이상, UTF-8 1,024바이트 이하를 받으며 공백을 임의로 제거하지 않는다. **12자는 공식 과제 조건이 아니라 AI가 추가한 현재 앱 정책**이다. 아이디는 이메일 형식이며 소문자/앞뒤 공백 정규화 후 중복을 막는다. 이메일 소유 확인은 현재 없다.

| 저장소 | 실제 필드·역할 |
|---|---|
| `identity.sqlite` / `users` | 서버 UUID, 고유 email, `password_digest`, 생성 시각, 삭제 중 접근 차단용 시각 |
| `identity.sqlite` / `sessions` | SHA256 token hash, user UUID, 발급·만료 시각. 원문 token을 DB에 저장하지 않음 |
| `identity.sqlite` / `auth_attempts` | 요청 횟수 제한 bucket·창 시작·횟수. 원문 비밀번호 저장하지 않음 |
| `accounts/<서버 UUID>.sqlite` | 해당 계정의 기존 7표: plans / plan_history / tasks / executions / completion_events / request_receipts / reviews |

기존 7표와 역사적 T06 계약 [pds-schema-v2.json](../contracts/pds-schema-v2.json)은 보존했다. 현재 로컬 저장·export 계약은 [t07-schema-v3.json](../contracts/t07-schema-v3.json)에 실제 빈 DB의 구조를 추출했다. 계정 DB에 관찰 4표와 이관 기록 1표가 추가되고 export schema_version은 3이다. 계정별 파일로 분리하므로 기존 각 일기 행에 `user_id`를 붙이지 않았다. 파일 이름은 사용자가 보내는 값으로 정하지 않는다. 인증 DB 생성 SQL과 비밀번호/세션 구현은 [identity-sqlite.mjs](../src/identity-sqlite.mjs)에 있다.

공개 운영은 별도 T07 프로젝트의 비공개 `t07_private`에 users/sessions/auth_attempts/diaries **물리 4표**를 둔다. diaries의 한 계정 행에 기존 7표·관찰 4표·이관 1표를 **논리 12표 JSONB snapshot**으로 저장한다. 함수의 SQLite `:memory:`는 기존 계약 검증과 동작에만 쓰며 파일에 개인 자료를 쓰지 않는다. 저장 시 PostgreSQL 트랜잭션과 계정 행 잠금으로 snapshot 전체를 갱신하고 중간 오류는 롤백한다. [identity-postgres.mjs](../src/identity-postgres.mjs), [cloud.sql](../db/cloud.sql).

서버 전용 `t07_server`는 superuser/DB 생성/role 생성/BYPASSRLS 권한이 없다. 4표에 RLS가 있고 anon/authenticated는 schema 접근 권한이 없다. diaries는 서버에서 인증된 계정의 transaction-local `t07.user_id`와 일치해야 읽고 쓸 수 있다. 계정·세션 조회는 인증 서버 역할만 허용한다. TLS는 공급자 CA와 호스트를 검증하며 `rejectUnauthorized:true`를 유지한다. DB 비밀번호는 Vercel sensitive 환경 변수에만 올리고 브라우저/공개 Git에 넣지 않았다.

## ② 왜 그걸 골랐나

T06이 이미 Node 24와 SQLite로 동작하므로 기존 ID·관계·수정 이력을 유지하면서 인증 동작을 확인하기 쉽다. 세션을 요청마다 서버 DB에서 확인하면 로그아웃/비밀번호 변경 뒤 같은 인증값의 재사용을 바로 거절할 수 있다. 공개 서버리스의 임시 파일에 의존하지 않도록 전용 PostgreSQL과 snapshot 트랜잭션을 추가했다. 기존 작업 로직은 메모리 SQLite로 재사용한다. 계정별 2MB 한도와 계정 단위 직렬 저장은 작은 다이어리에 맞춘 구현 선택이며 큰 자료의 일반적 확장 구조를 주장하지 않는다.

비밀번호는 무작위 16바이트 salt, 32바이트 결과, `scrypt N=32768, r=8, p=3, maxmem=128MiB`로 처리한다. 이 비용 조합은 [OWASP Password Storage 안내](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)의 scrypt 선택지 중 하나다. 새 외부 패키지를 넣지 않고 검증된 Node 구현을 쓸 수 있어 선택했다. Node도 [crypto.scrypt 문서](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)에서 무작위 salt를 권고한다. 사용한 비용과 salt는 hash 문자열에 함께 보존한다.

| 검토한 대안 | 현재 선택하지 않은 이유 |
|---|---|
| Supabase Auth 같은 관리형 서비스 | 비밀번호·이메일 기능을 맡길 장점이 있다. 공식 [세션 문서](https://supabase.com/docs/guides/auth/sessions)는 로그아웃 직후 기존 JWT를 막아야 할 때 `session_id`가 `auth.sessions`에 남아 있는지 별도 확인할 것을 안내한다. 기본 JWT 검증만으로 즉시 재사용 거절을 주장할 수 없어, PostgreSQL에도 매 요청 확인하는 DB 세션을 사용했다. Supabase는 DB 공급자로만 사용했다. |
| 별도 세션/인증 라이브러리 | 쿠키 처리·저장소 연동을 재사용할 수 있다. 현재 T06의 작은 Node 서버에 프레임워크를 추가하기보다 내장 crypto와 명시적 세션 DB로 필요한 흐름을 먼저 검증했다. 직접 작성한 인증 정책의 유지·검토 부담은 남는다. |

## ③ 어디를 어떻게 고쳤나

HTTP 라우트는 로컬·공개 운영이 공유한다. 로컬 [server.mjs](../server.mjs)는 SQLite adapter를, 공개 [api/index.mjs](../api/index.mjs)는 [identity-postgres.mjs](../src/identity-postgres.mjs)의 PostgreSQL adapter를 주입한다. 공개 adapter도 [identity-sqlite.mjs](../src/identity-sqlite.mjs)의 비밀번호 검증·scrypt 함수를 재사용한다.

| 흐름 | 실제 처리와 소스 |
|---|---|
| 가입 | [auth.mjs](../public/auth.mjs)의 가입 폼 → [http.mjs](../src/http.mjs) `POST /api/auth/register` → 로컬 `identity-sqlite.mjs` 또는 공개 `identity-postgres.mjs`의 `register` → 공유 `hashPassword`. random salt로 scrypt를 수행하고 유일 email을 저장한다. 응답은 public user만 포함한다. |
| 로그인 | 같은 폼 → `POST /api/auth/login` → `login` / `verifyPassword`. 없는 계정도 같은 비용으로 비교하고 틀린 비밀번호와 동일 401 문구를 준다. 성공하면 32바이트 random token을 만들고 DB에 SHA256만 저장한다. token은 `HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` cookie로 보내며 production에서는 `Secure`도 붙인다. 브라우저 JSON에는 user·CSRF·만료만 보낸다. |
| 로그아웃 | 로그아웃 버튼 → `POST /api/auth/logout` → `logout`이 서버 세션 hash 행을 삭제하고 cookie도 지운다. 같은 URL·method·기존 cookie로 다시 요청하면 DB 조회에 실패해 401이다. |
| 자료 조회 | [app.mjs](../public/app.mjs) → `GET /api/state`, `GET /api/export`, 개별 조회 → HTTP 인증 gate → `withDiary(session.user.id, ...)`. 서버가 인증한 UUID의 DB만 연다. 그 DB에 없는 다른 계정 record ID는 404다. 쿼리·헤더·본문의 계정 지정은 소유자 선택에 쓰지 않는다. |

모든 개인 API는 인증 전에 자료를 반환하지 않는다. 쓰기는 세션에서 파생한 CSRF 값을 `X-CSRF-Token`으로 확인하고 origin도 확인한다. 정상 cookie만 갖고 CSRF 없이 저장하려는 요청은 403이다. 브라우저 코드에 token 발급용 고정 비밀키는 없다. 인증값은 주소창에 전달하지 않는다. cookie token은 브라우저 JavaScript가 읽을 수 없고 CSRF 값은 로그인 동안 메모리에만 둔다.

세션은 로그인부터 최대 8시간이며 자동 연장하지 않는다. 비밀번호 변경은 현재 비밀번호를 다시 확인하고 hash 변경과 **모든 기존 세션 삭제**를 한 트랜잭션으로 수행한다. 다른 브라우저의 기존 세션도 끊긴다. 로그인 횟수는 계정당 5분 10회/IP당 5분 30회, 가입은 IP당 1시간 10회, 재인증은 계정당 5분 10회로 제한하며 scrypt 동시 작업은 최대 4개다.

계정 삭제는 현재 비밀번호와 정확한 email 확인 후 접근을 먼저 차단하고 세션을 삭제한 뒤 해당 SQLite와 WAL/SHM 파일 및 계정 행을 삭제한다. 파일 정리가 실패하면 계정 접근은 계속 차단하고 안전한 503을 반환한다. 이는 로컬 앱 파일 삭제이며 모든 외부 백업의 물리적 소거를 보장하지 않는다.

[server.mjs](../server.mjs)는 로컬 T07 전용 디렉터리와 loopback 서버를 사용한다. 기존 T06 공개 Supabase 환경이 지정되면 시작을 거절한다. [api/index.mjs](../api/index.mjs)는 전용 PostgreSQL adapter를 사용하고 미구성·잘못된 T06 설정에는 503을 반환한다. 기존 공개 어댑터 [store-supabase.mjs](../src/store-supabase.mjs)와 과거 SQL은 이력 보존 자료이며 T07 서버가 호출하지 않는다. 운영 계정 삭제는 user 삭제와 FK cascade로 세션·해당 전체 snapshot을 제거하며 타 계정 자료는 유지한다.

T06 실제 최종 제출은 `b9de0298cd200961eac56286c6a6a55299947a96`, T07의 출발 HEAD는 후속 문서 커밋 `db3de5dcc8a0d5d99da7a0f7e5908c7fd0ddad93`다. 고정 [공개 구현 소스](https://github.com/PeterAhnn/SKT-ALEPH-Project-7-Diary-Auth/commit/ccf765df053456161e881e541e4fd177ee7adc03)와 공개 push·익명 접근을 확인했다. 최종 제출 커밋이 T07의 조상임을 로컬 Git으로 확인했다. 이관 미리보기/가져오기를 구현하고 합성 자료로 확인했다. 현재 T06 공개 자료와 보존 export가 달랐으며 사용자가 현재 T06 전체 자료를 이관 기준으로 선택했다. 실제 사용자 계정으로 UI 이관 후 전체 export를 받아 7표 건수와 모든 값의 canonical digest가 일치함을 확인했다. [actual-migration.json](../verification/actual-migration.json).

## ④ 안 열리는 것을 확인한 기록

실행한 근거: [auth-local.json](../verification/auth-local.json)의 가린 HTTP 요청/응답·저장 hash·건수와 [auth-browser.json](../verification/auth-browser.json)의 실제 화면 검사. 두 파일 모두 `data_origin: synthetic`이다. 비밀번호·cookie·token·CSRF 원문은 `[REDACTED]`로 가렸다. 같은 인증값인지의 대조는 시험 중 원문을 메모리에서 비교한 assertion으로 수행하고 값은 제출하지 않는다.

아래 **다섯 묶음의 이름·구성은 AI의 근거 정리 제안**이다. 공식 안내는 다섯 가지 확인을 요구하지만 각 이름을 열거하지 않았다.

| 확인 묶음 | 성공 요청 | 거절 요청 | 실제 근거 |
|---|---|---|---|
| 1. 로그인 유무 | 로그인 후 `GET /api/state` 200 | 같은 개인 state/export API 비로그인 401; 자료 생성도 401 | `anonymous-access-and-csrf` |
| 2. 인증값 수명 | 기존 cookie로 `GET /api/state` 200 | 같은 URL·GET·cookie로 로그아웃 뒤 401; 비밀번호 변경 뒤 기존 두 세션 모두 401; 만료 경계 뒤 401 | `same-value-after-logout`, `password-change-revokes-all-sessions`, `expiry-boundary` |
| 3. 남의 자료 읽기 | A/B 각 자기 task GET 200 | A→B·B→A task GET 404 | `bidirectional-ownership` |
| 4. 남의 자료 수정·삭제 | 각 자기 task PATCH/DELETE 200 | 반대 계정 task PATCH/DELETE 각각 404 | 같은 근거. 거절 전후 A/B 전체 state가 동일하고 task 건수 각 1→1. 정상 수정/삭제 대조는 그 비교를 마친 뒤 별도 자기 task로 수행. |
| 5. 저장 요청 진위 | 로그인·정상 CSRF로 plan POST 200 | 같은 POST에서 CSRF 없음 또는 다른 origin은 403 | `anonymous-access-and-csrf`; 거절 뒤 state 불변 확인 후 정상 저장 대조 |

소유자 거절은 공식 필수 읽기·수정·삭제 **양방향 6개**, 추가 완료·복구·실행·자식 생성 등 **10개**를 검사했다. 계정 UUID를 쿼리/헤더/본문에 위조한 state 요청도 다른 자료를 돌려주지 않고 자기 목록만 200으로 반환한다. 이는 요청 전체를 오류로 거절하는 정책이 아니라 **다른 계정 선택을 무효화하는 정책**이다. 목록·export에 다른 계정 데이터가 없음을 `account-hints-list-and-export`에서 확인했다.

### 카드 2: 실제 저장값과 원문 노출 확인

[production-api.json](../verification/production-api.json)의 `stored_synthetic_hashes`에서 가져온 아래 두 값은 **같은 시험 비밀번호로 만든 합성 계정**의 실제 PostgreSQL `password_digest`다. 계정 생성은 서버 fixture, 로그인 검사는 공개 HTTPS였다. 시험 계정은 검사 후 삭제했으며 실제 본인 계정의 저장값을 공개하지 않는다.

```text
A: scrypt$32768$8$3$77ad01023e2474ff047de72f785ff846$33ed6cf4fe4cc439faeea720738874c9ffcfb2fc1b1b8b3a84a1289f72a8eabe
B: scrypt$32768$8$3$3bba35a235935c755af3ca78dbf0618d$6cd6864c6e9ff3d490766752c204860e065e9ea742a1de50fb9404d56bb4d538
```

저장 형식은 `scrypt$N$r$p$salt의 hex$hash의 hex`다. 무작위 16바이트 salt와 32바이트 hash가 둘 다 다르다. [검사 코드](../scripts/verify-production.mjs)는 같은 시험 비밀번호를 두 계정에 사용하고 실제 DB 값을 읽어 서로 다름을 확인했다. 로컬 `registration-and-password-storage`도 별도의 합성 두 계정으로 같은 검사를 수행했다. 비용 파라미터·salt·hash를 함께 저장하므로 로그인할 때 같은 비용과 salt로 다시 계산해 `timingSafeEqual`로 비교할 수 있다. 알고리즘을 새로 만든 것이 아니라 Node/OpenSSL `crypto.scrypt`를 호출하며 라우트·저장·검증 정책은 직접 작성했다.

로그인 입력은 HTTPS POST 본문으로 서버에 전달된다. 실제 전송 본문과 **제출용 요청 기록**을 혼동하지 않는다. 제출 기록의 `input.password`는 `[REDACTED]`이고 응답은 비밀번호·저장 hash를 돌려주지 않는다. `raw-password-response-and-runtime-log-scan`은 가리기 전 시험 응답의 비밀번호 부재와 당시 운영 로그 **최근 15분·최대 100개**에서 시험 비밀번호·인증값·DB 비밀번호 부재를 확인했다. 전체 과거·미래 로그의 부재를 증명한 것은 아니다.

화면 입력은 `type=password`이고 성공/실패 후 입력을 비우며 비밀번호를 메시지에 출력하지 않는다. 공개 UI의 실패 후 비우기 검사는 production-browser.json, 해당 코드는 [auth.mjs](../public/auth.mjs)와 [index.html](../public/index.html)에 있다. 서버 저장소 오류 로그는 정해진 코드/타입만 출력한다. 로그인을 실패시킨 두 경우의 상태와 문구도 같다. 자동 소스 패턴 검사 역시 모든 가능한 유출 경로 부재의 증명은 아니다. [카드 2 대조표](./CARD-2-REVIEW.md).

`disposable-account-deletion`은 합성 계정 DB 및 WAL/SHM 파일 제거, 이전 세션·로그인 거절, 반대 계정 state 불변을 확인했다. [브라우저 화면](../verification/authenticated-synthetic.png)은 실제 검사용 합성 계정이며 사용자 실제 다이어리 화면이 아니다. 초기 로컬 자동 검사 45개, 인증 화면 10개, 관찰/이관 화면 10개가 통과했다. cloud 경계 검사를 추가한 현재 자동 검사는 48개다. 후자는 가상 날짜·합성 개수이며 실제 5일 사용이 아니다.

공개 운영에서도 [production-api.json](../verification/production-api.json)의 10개 합성 검사로 서로 다른 저장 hash, 같은 오류, Secure/HttpOnly/SameSite cookie, 익명/CSRF/origin 거절, 양방향 6건 404·전체 불변·위조 무효·export 분리, 자기 수정/삭제 성공, 같은 인증값의 로그아웃 뒤 401, 비밀번호 변경 후 두 세션 401, 시험 세션 만료 후 401, 자기 계정 삭제·타 계정 불변을 확인했다. 최신 API 반복의 계정 생성은 서버 fixture이며 공개 가입 폼 검사는 production-browser.json에 별도로 있다. 만료는 시험 계정의 만료시각을 앞당긴 검사이며 실제 8시간을 기다린 결과가 아니다.

[cloud-integration.json](../verification/cloud-integration.json)의 13개는 실제 전용 PostgreSQL과 로컬 HTTP adapter 검사다. 다른 계정 snapshot에 RLS가 적용되고, 새 adapter에서도 동일 state가 복원되며 동시 저장·중간 오류 롤백·전체 7표 합성 이관·가상 5일 12표 재복원을 확인했다. 가상 날짜는 실제 5일 사용으로 세지 않는다. 자동 검사는 최종 48개 통과했다. 첫 공개 가입 검사는 socket이 없는 서버리스 요청에서 503으로 실패했고 이를 수정한 다음 전체 공개 API 검사가 통과했다. 실패를 보관하고 성공으로 바꾸어 적지 않는다.

### 카드 3: 같은 인증값의 로그아웃 전후 응답

사용자를 알아보는 방식은 **서버 DB 세션**이다. 로그인 때 만든 무작위 32바이트 값은 `pds_session` 쿠키로 전달하고 DB에는 SHA256만 저장한다. 매 개인 요청에서 해당 세션·계정·만료 시각을 확인한다. 쿠키는 공개 운영에서 `Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`이다. 고정 서명 비밀키로 JWT를 발급하는 구조가 아니다.

[production-api.json](../verification/production-api.json)의 `same-old-auth-after-logout`을 다음과 같이 나란히 옮겼다. 성공 응답은 `ok` 필드만 발췌하며 전체 합성 state는 원래 JSON에 있다.

| 비교 항목 | 로그아웃 전 | 로그아웃 후 |
|---|---|---|
| 공개 주소 | `https://skt-aleph-project-7-diary-auth.vercel.app/api/state` | 같은 주소 |
| 요청 방식 | `GET` | `GET` |
| Cookie | `pds_session=[REDACTED: 같은 기존 값]` | `pds_session=[REDACTED: 같은 기존 값]` |
| X-CSRF-Token | `[REDACTED: 같은 기존 값]` | `[REDACTED: 같은 기존 값]` |
| HTTP 상태 | `200` | `401` |
| 응답 | 발췌: `{"ok":true}` | `{"ok":false,"error":{"code":"UNAUTHENTICATED","message":"로그인한 뒤 내 기록을 열어 주세요."}}` |

사이에 실행한 요청은 `POST /api/auth/logout` 200이다. 검사 코드는 기존 인증값을 보관한 `oldA`로 전후 요청을 수행하므로 쿠키를 비우거나 새 인증값으로 바꿔서 거절을 얻은 것이 아니다. 서버의 `logout`이 세션 hash 행을 삭제한다. 이 요청 순서는 합성 시험 계정에 대한 실제 공개 HTTPS 검사다.

세션은 로그인 발급 시각부터 **8시간(28,800초)**, 자동 연장은 없다. 시험 로그인 응답의 실제 `expires_at` 예는 `2026-10-02T15:03:19.489Z`다. 만료 비교는 서버에서 매 요청 `expires_at > 현재 시각`으로 수행한다. 공개 `forced-test-session-expiry`는 시험 계정의 DB 만료시각을 앞당긴 뒤 기존 값으로 401을 확인했으며 실제 8시간 대기가 아니다. 로컬 `expiry-boundary`는 제어된 시계와 시험 60초로 경계 전 200/경계 401을 확인했다.

비밀번호 변경은 hash 갱신과 해당 계정의 모든 세션 삭제를 같은 트랜잭션에서 수행한다. 공개 `password-change-all-sessions-denied`에는 변경 200 뒤 기존 두 세션의 `GET /api/state` 401/401이 있다. 인증값은 URL 대신 Cookie 헤더로만 전달하며 HTTP 라우트도 쿠키에서만 읽는다. 제출 기록의 Cookie·Set-Cookie·CSRF는 가린다.

고정 세션 서명키는 없으며 DB 비밀번호 등 운영 비밀값은 서버 환경 변수로만 읽는다. `.gitignore`와 `.vercelignore`는 `.env*`·개인 DB·검사 자료를 제외한다. 배포 설정은 공개 출력 디렉터리를 `public`, 함수 포함 파일을 DB SQL과 공개 HTML로 지정한다. 공급자 서버 환경에는 필요한 DB 비밀번호가 있어야 하므로 “어느 곳에도 비밀값이 존재하지 않는다”고 쓰지 않는다. [현재 Git 검사](../verification/history-secret-check-card-3.json)는 기록된 HEAD에서 도달 가능한 Git blob 236개에 알려진 DB 비밀번호·Vercel OIDC 원문이 없음을 확인했다. 이 두 값과 소스 패턴 검사는 미지의 모든 비밀값 부재의 증명이 아니며 실제 배포 bundle을 내려받아 검사한 결과도 아니다. [카드 3 대조표](./CARD-3-REVIEW.md)에 코드·배포 제외 설정·근거 범위를 연결했다.

### 카드 4: 양방향 읽기·수정·삭제 거절

실제 공개 HTTPS 합성 검사에서는 A/B 두 시험 계정 각각에 계획 1개와 할 일 1개를 저장했다. 자신의 할 일 조회는 200, 아래 남의 할 일 접근은 양방향 모두 404였다. 각 요청의 Cookie/CSRF는 `[REDACTED]`다. PATCH 본문은 `expected_version:1`과 `title:"외부 수정"` 등 원래 검사 JSON의 시험 필드를 보냈다. 아래 ID는 합성 자료이며 실제 본인 자료가 아니다.

| 방향 | 요청 | HTTP 상태 |
|---|---|---|
| A→B 읽기 | `GET /api/tasks/d120861b-78b5-461d-91d3-ad00c54d7e51` | 404 |
| A→B 수정 | `PATCH /api/tasks/d120861b-78b5-461d-91d3-ad00c54d7e51` | 404 |
| A→B 삭제 | `DELETE /api/tasks/d120861b-78b5-461d-91d3-ad00c54d7e51` | 404 |
| B→A 읽기 | `GET /api/tasks/a5918981-e019-433f-8711-d54680f4599e` | 404 |
| B→A 수정 | `PATCH /api/tasks/a5918981-e019-433f-8711-d54680f4599e` | 404 |
| B→A 삭제 | `DELETE /api/tasks/a5918981-e019-433f-8711-d54680f4599e` | 404 |

6건의 실제 응답은 모두 `{"ok":false,"error":{"code":"NOT_FOUND","message":"해당 기록을 찾을 수 없습니다."}}`다. 거절 전후 A/B 할 일 건수는 각각 1→1이고 두 계정의 전체 state가 같았다. 자신의 정상 수정/삭제 200은 불변 비교를 끝낸 뒤 별도로 수행했다.

A의 세션으로 `GET /api/state?user_id=3c6e3e63-450a-462d-8fb9-5b8f67e9390c`와 같은 B UUID의 `X-User-Id` 헤더를 보낸 요청은 200이지만 A의 자료만 반환했다. `POST /api/state` 본문에 같은 B UUID의 `user_id`를 넣어도 동일했다. 전체 응답의 tasks에는 A의 위 할 일 하나만 있고 B의 ID는 없었다. export에도 B의 자료가 없었다. 이 정책은 계정 지정 힌트를 무시하는 것이며 해당 요청을 403/404로 거절한다고 적지 않는다. 익명 `GET /api/state`는 401과 `UNAUTHENTICATED` 응답이었다.

자료 주인은 [http.mjs](../src/http.mjs)의 인증 gate와 `withStore`가 `session.user.id`로 결정한다. 공개 [identity-postgres.mjs](../src/identity-postgres.mjs)의 `withDiary`는 인증된 계정·세션을 트랜잭션에서 다시 확인하고 해당 계정 snapshot만 연다. 한 건 조회는 그 state에 없는 ID를 404로 반환하며 쓰기는 [store-sqlite.mjs](../src/store-sqlite.mjs)의 대상 행 확인을 통과해야 한다. 목록·export도 같은 계정 경로를 사용하고 오류 시 트랜잭션을 롤백한다. [카드 4 대조표](./CARD-4-REVIEW.md), [가린 요청·전체 응답](../verification/card-4-review.json)은 원래 production-api.json에서 검토한 자료다. 이번 대조에서 운영 시험을 반복한 결과가 아니다.

### 카드 5: 현재 실제 관찰 상태

2026-10-02 공개 본인 계정 화면을 새로 불러오고 전체 JSON을 내려받아 확인했다. 관찰 시작은 한국 시간 **17:21:52**, 질문은 “하루 시작에 할 일을 정하면 하루 완료 개수는 어떻게 달라질까?”, 첫 규칙은 “하루 시작에 할 일 3개를 정하고 진행한다”로 저장돼 있다. 지표는 완료한 할 일 수, 단위는 개이며 계산·누락·중복·이상값·반올림·월요일 주 시작 기준도 함께 저장됐다. 이전 문서의 ‘계산 동의/시작 저장 대기’는 현재 상태와 달라 정정했다.

현재 확정 날짜 **0/5일**, 관찰 계획의 할 일 0개, 규칙 변경 0건, 손계산 대조 0건이다. 화면의 오늘 0개는 아직 미확정이며 실제 0개 기록으로 세지 않았다. [현재 상태 근거](../verification/card-5-current-status.json), [카드 5의 32개 대조](./CARD-5-REVIEW.md). 전체 내보내기 한 파일에는 기존 7표·관찰 4표·이관 1표가 있으며 비밀번호·계정·세션 필드는 없다. 원본 파일과 본인 화면은 공개 Git에서 제외한 비공개 증거 폴더에 보관했다. 계정 삭제 시 내 자료도 함께 삭제된다는 안내가 현재 화면에 있고 실제 본인 계정은 삭제하지 않았다.

서로 다른 실제 날짜 5일, 2일차 뒤·3일차 앞의 실제 규칙 변경, 같은 계산의 전후 비교, 직접 합계·평균 대조, 최종 전체 export와 사용자 판단은 아직 미완료다. 현재 내려받은 파일은 진행 상태 확인용이며 완성된 5일 제출 근거로 쓰지 않는다.

## ⑤ AI와 나

- **AI에게 맡긴 일:** T06 조상 이력 연결, 로컬 인증 선택·구현, 서버 소유자 분리, 자동·브라우저 합성 검사, 공식 원문과 구현·근거 연결.
- **사용자가 판단한 일:** 실제 관찰 지표를 ‘완료한 할 일 수(개)’로 선택했다. 기존 ALEPH 공부·과제 진행 주제를 유지하고, 보존본 이후 변경을 포함한 현재 T06 전체 자료를 이관 기준으로 선택했다. 제안한 질문·첫 계획 규칙을 채택했고 직접 계정 생성·로그인했다. 실제 완료 기록과 해석은 아직 확보하지 않았다.
- **AI 제안을 따르지 않은 일:** AI가 선택과 검증을 임의로 진행한 부분은 그대로 수용하지 않고 직접 확인하고 수정했다. 사용자 원문은 “선택과 검증을 마음대로 해서 직접 확인하고 수정함”이다. 구체적인 수정 사례는 추가로 확인하지 않았으므로 만들어 쓰지 않는다.

## ⑥ 아직 못 막은 것

| 실제 한계·미구현 | 위험·영향과 남은 작업 |
|---|---|
| 작은 snapshot 저장과 운영 백업 한계 | 계정당 JSONB 2MB, HTTP 입력 64KB 한도를 둔다. 매 요청 메모리로 복원하고 계정 행을 잠그므로 큰 자료/높은 동시성 성능을 검증하지 않았다. 공급자 백업의 복구/소거 시험과 비용 증가 대응은 미수행이다. 현재 T06 파일은 약 38KB로 입력 한도 안이다. |
| 이메일 소유 확인·자동 비밀번호 재설정·MFA 없음 | 다른 사람 이메일 모양으로 가입할 수 있고 비밀번호 분실 복구가 없다. 로그인 화면에 한계를 표시했다. 현재 공개 운영에서도 이 인증/복구 한계가 남는다. |
| 파일·백업 암호화/소거와 관리자 접근 통제 없음 | 앱 요청은 분리하지만 호스트 파일을 읽을 권한이 있으면 계정 DB·hash를 볼 수 있다. 계정 삭제가 외부 백업·T06 공개 원본까지 지우지 않는다. T06 원본은 계정 삭제와 무관하게 보존된다. |
| 현재 비밀번호 길이·MFA 정책 | MFA 없이 최소 12자를 받으므로 [NIST SP 800-63B-4 §3.1.1.2](https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver)의 비밀번호 단독 인증 최소 15자 조건을 만족하지 않는다. 12자는 과제 필수가 아닌 AI 정책이며, 과제 검사 통과를 외부 보안 기준 준수로 표시하지 않는다. |
| 프록시 IP 횟수 제한과 자체 인증 정책 | PostgreSQL bucket은 지속 저장하지만 서버리스에서 socket이 없으면 `unknown` 공유 bucket을 사용한다. 위조 IP 헤더를 신뢰하지 않는 대신 여러 사람이 가입/로그인 제한을 공유할 수 있다. 신뢰된 공급자 IP 전달 경로·분산 부하 검사는 미수행이다. 직접 작성한 인증의 검토·유지 책임이 있다. |
| 실제 5일 사용·판단 미확보 | 새 5일 화면과 저장·한 번의 변경·전후 집계·손계산 대조 기능은 로컬 검사했다. 이관 기준은 현재 전체 자료로 선택했다. 질문·첫 규칙과 실제 날짜별 행동은 사용자가 정하고 기록해야 한다. 합성 검사 5일이나 과거 T06 기록으로 대체하지 않는다. |

2026-10-06 제출 준비 재개 시 사용자의 위 판단을 반영했다. 10월 6일 재로그인 후 실제 전체 export와 화면에서 확정 0/5일·규칙 변경 0건·손계산 0건을 확인했다. 시작일 미확정으로 기존 기록을 보존하고 새 관찰에서 시작해야 한다. [실제 상태](../verification/card-5-current-status-20261006.json). **T07 공식 완주 또는 최종 제출 완료를 주장하지 않는다**.

### 추가된 관찰·이관 흐름

‘5일’ 탭 → app.mjs → 인증/CSRF gate → observation-store.mjs와 observation.sql. start는 질문·첫 규칙·고정 기준을, day는 서버 한국 날짜와 완료 ID를, rule은 실제 1~2일차 참조와 변경 시각/이유를, check는 입력한 손계산 대조를 보존한다. completion guard가 확정일 추가 완료와 변경 없는 3일차 시작을 막는다.

‘T06 자료 가져오기’ → 파일 미리보기 → migration.mjs. schema 2의 전체 7표·필드·ID·실제 날짜·관계·중복을 임시 DB로 검증하고 canonical SHA256을 비교한다. 비어 있는 인증 계정 DB에서만 전체를 한 트랜잭션으로 삽입한다. 보존값/관계가 같고 중간 오류 시 전체 롤백됨을 migration-local.json에서 확인했다. 실제 현재 T06 읽기 전용 대조는 t06-live-export-check.json이며 읽기 전용 비교 자체는 이관 증거가 아니며 실제 이관은 actual-migration.json에 별도로 확인했다.
