# 카드 2 — 비밀번호를 어떻게 보관하는지 확인

확인일: 2026-10-02, 한국 시간. [공식 원문](./TASK-SOURCE.md)의 카드 2 첫 행동·7개 통과 기준·확인 순서·남길 것을 기존 검사 기록과 현재 코드에 대조했다. 본인 비밀번호·DB 저장값을 읽지 않았고 이번 대조에서 새 계정을 만들거나 운영 검사를 반복하지 않았다.

**판정: 카드 2의 구현·해당 검사 범위의 근거·제출 초안은 준비됐다.** 실제 저장값을 설명서와 초안에 추가했다. 전체 로그와 모든 유출 경로의 부재를 증명한 것은 아니며 최종 플랫폼 제출도 아직 하지 않았다.

## 첫 행동과 처리 방식

- 이름·선택 이유: Node/OpenSSL `crypto.scrypt`. 기존 Node 실행 환경의 내장 구현에 무작위 salt와 비용을 적용할 수 있어 선택했다.
- 실제 저장 모습: 설명서 ④와 제출 초안에 합성 시험 두 계정의 PostgreSQL `password_digest` 원문을 옮겼다. 실제 사용자의 비밀번호·저장값은 공개하지 않는다.
- 같은 시험 비밀번호를 두 계정에 사용했으며 각각의 salt/hash가 다름을 확인한 기록과 코드를 연결했다.
- 로그인 요청의 제출용 기록은 비밀번호를 가리고, 가리기 전 응답과 제한된 운영 로그 검사의 부재 결과를 연결했다.

## 통과 기준 7개

| 공식 기준 | 확인 결과 | 근거 |
|---|---|---|
| C101 처리 방법 이름 | crypto.scrypt를 설명서·제출 초안에 명시 | [설명서 ①·②·④](./AUTH-IMPLEMENTATION.md), [제출 초안](./SUBMISSION.md) |
| C102 선택 이유 한 문장 이상 | 기존 Node 환경의 내장 구현·무작위 salt·비용 적용 이유 명시 | 설명서 ②, 제출 초안 |
| C103 실제 DB 저장 모습 | 실제 합성 계정 저장값 A/B를 생략 없이 추가. 시험 원문은 미기재 | 설명서 ④, 제출 초안, [production-api.json](../verification/production-api.json) stored_synthetic_hashes |
| C104 같은 비밀번호의 다른 저장값 | 같은 입력의 두 DB 값이 다름. 16바이트 salt와 32바이트 hash도 다름 | production-api.json, [검사 코드](../scripts/verify-production.mjs), [auth-local.json](../verification/auth-local.json) |
| C105 로그인 기록에 원문 없음 | 기록의 input.password는 REDACTED. 시험 직렬화 결과에 비밀값이 없는지 검사 | production-api.json, 검사 코드의 redact 및 직렬화 검사 |
| C106 로그·화면·응답에 원문 없음 | 시험의 가리기 전 응답과 당시 운영 로그 최근 15분/최대 100개에 비밀값 없음. 화면 입력 마스킹 및 제출 뒤 비우기 확인 | production-api.json raw-password-response-and-runtime-log-scan, [공개 UI 기록](../verification/production-browser.json), [auth.mjs](../public/auth.mjs), [index.html](../public/index.html), [http.mjs](../src/http.mjs) |
| C107 라이브러리에 맡긴 범위·직접 구현 사실 | 암호 함수는 Node/OpenSSL crypto.scrypt. 인증 라우트·저장·검증·세션 정책은 직접 작성했다고 명시 | 설명서 ①·③·④, 제출 초안, [identity-sqlite.mjs](../src/identity-sqlite.mjs), [identity-postgres.mjs](../src/identity-postgres.mjs) |

## 코드와 증거 범위

`hashPassword`는 매 호출 `randomBytes(16)`으로 salt를 만들고 `scrypt N=32768, r=8, p=3, maxmem=128MiB`로 32바이트를 계산한다. DB에는 `scrypt$N$r$p$salt hex$hash hex`만 저장한다. `verifyPassword`는 저장 파라미터·salt로 다시 계산해 `timingSafeEqual`로 비교한다. 공개 PostgreSQL adapter는 이 공유 함수를 사용한다. 비밀번호 암호 알고리즘 자체를 새로 작성한 것이 아니다.

실제 저장값 근거는 **합성 계정**이다. 최신 공개 API 반복에서 계정 생성은 서버 fixture였고 같은 입력의 두 DB 값을 직접 읽어 비교했다. 로그인/응답은 실제 공개 HTTPS였다. 실제 본인 자료나 실제 5일 관찰의 근거로 바꾸어 쓰지 않는다.

로그인에 필요한 입력은 HTTPS POST 본문으로 서버에 전달된다. “제출용 요청 기록에서 원문을 가렸다”는 것이 “전송 본문에 입력값이 없다”는 뜻은 아니다. 응답은 비밀번호와 password_digest를 돌려주지 않으며 서버 오류 로그는 정해진 코드·타입만 출력한다. 화면은 type=password이고 성공/실패 뒤 입력을 비운다. 운영 로그 결과는 당시 제한된 조회 범위이며 전체 과거·미래 기록에 대한 보장이 아니다. 자동 소스 검사도 모든 가능한 비밀값 유출의 부재를 증명하지 않는다.

## 막힐 때 확인 순서와 남길 것

공식 순서대로 salt가 계정마다 다른지 → 사용 함수에 자동 salt 생성이 있는지 → 단순 해시 한 번인지 확인했다. 이 앱은 Node scrypt 호출 전에 직접 무작위 salt를 만들며, 단순 해시 한 번으로 비밀번호를 저장하지 않는다.

방법·이유, 실제 시험 계정 저장값, 동일 입력의 서로 다른 두 값, 가린 로그인 요청·응답과 로그 검사 범위를 설명서·제출 초안·원래 검사 JSON에 남겼다. 원래 검사 JSON의 검사 시각과 결과를 이번 문서 검토 시각으로 바꾸지 않았다. 다음은 카드 3의 세션·로그아웃 뒤 재사용 거절·비밀번호 변경·만료 확인이다.
