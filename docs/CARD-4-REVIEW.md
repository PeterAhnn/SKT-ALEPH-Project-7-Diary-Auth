# 카드 4 — 남의 자료 접근과 자료 불변 확인

확인일: 2026-10-02, 한국 시간. [공식 원문](./TASK-SOURCE.md)의 첫 행동·11개 통과 기준·두 확인 순서·남길 것을 현재 코드와 실제 공개 HTTPS 합성 검사 기록에 대조했다. 이번 대조에서 운영 시험을 반복하거나 본인 자료를 시험에 사용하지 않았다.

**판정: 카드 4의 구현·근거·제출 초안 준비 완료.** 시험 요청/전체 응답은 [card-4-review.json](../verification/card-4-review.json)에 원래 production-api.json에서 옮겼으며 원래 검사 시각과 합성 구분을 보존했다.

## 통과 기준 11개

| 공식 기준 | 확인 결과 | 근거 |
|---|---|---|
| C116 두 계정에 자료 저장, 비밀번호 미기재 | 합성 A/B 각각 계획 1개·할 일 1개 저장 200 및 자신의 할 일 조회 200 | [production-api.json](../verification/production-api.json) two-way-read-edit-delete-isolation, [제출 초안](./SUBMISSION.md) |
| C117 A→B 읽기 | GET B task 404, 요청과 전체 거절 응답 보존 | card-4-review.json denials[0] |
| C118 A→B 수정 | PATCH B task 404, 가린 헤더·시험 본문·거절 응답 보존 | denials[1] |
| C119 A→B 삭제 | DELETE B task 404 | denials[2] |
| C120 B→A 세 가지 | A task에 GET/PATCH/DELETE 모두 404 | denials[3..5] |
| C121 403 또는 404 | 6건 모두 존재를 감추는 404 / NOT_FOUND | 모든 denials |
| C122 자료 불변 | A/B 전체 state 동일, 각 할 일 건수 1→1. 새로운 자료도 없음 | full_state_unchanged, counts, [검사 코드](../scripts/verify-production.mjs)의 deepEqual |
| C123 URL·헤더·본문 계정 힌트 무효 | A 세션에서 B UUID 지정한 GET query/X-User-Id 및 POST user_id에도 A 자료만 200 | account_hint_requests의 요청과 전체 응답 |
| C124 익명 직접 요청 거절 | GET /api/state 401 / UNAUTHENTICATED | production-api.json public-without-account-and-private-denial |
| C125 목록에 남의 자료 없음 | 계정 힌트 목록의 task는 A 한 건이고 B task ID 없음. export에도 B 없음 | account_hint_requests, foreign_task_absent_from_hint_lists, foreign_task_absent_from_export |
| C126 차단 소스 위치 명시 | 인증 계정으로 snapshot 선택, 자신의 state에 없는 ID 404, 쓰기 전 대상 확인 | [설명서 ③·④](./AUTH-IMPLEMENTATION.md), 제출 초안, [http.mjs](../src/http.mjs), [identity-postgres.mjs](../src/identity-postgres.mjs), [store-sqlite.mjs](../src/store-sqlite.mjs) |

## 요청·응답 및 코드의 연결

설명서·초안에 실제 합성 task ID를 포함한 양방향 6개 요청과 동일한 전체 404 응답을 적었다. Cookie/CSRF는 가리고 PATCH의 expected_version/title 등 시험 본문은 JSON에 남겼다. 소유자 힌트 요청은 오류로 거절하는 정책이 아니라 무시하고 본인 목록을 반환하는 정책이다. 자신의 정상 수정/삭제 200은 거절 전후 불변 대조를 마친 뒤 별도로 수행했다.

HTTP 인증 gate → session.user.id → withDiary에서 해당 계정/세션 재확인 → 해당 계정 snapshot의 읽기/쓰기 경로다. 기존 행마다 user_id를 붙인 구조라고 잘못 설명하지 않는다. 물리 diaries 계정 행과 논리 12표 snapshot 분리, 트랜잭션 잠금·롤백을 사용한다.

## 막힐 때 확인 순서와 남길 것

목록 혼입은 목록에도 주인 조건이 있는지 → 한 건/목록 경로가 다른지 → 전체 응답의 남의 ID 부재 순서로 확인했다. 두 경로 모두 같은 인증 계정 snapshot에서 읽고 전체 목록을 대조했다.

자료 변경은 저장보다 소유자 확인이 먼저인지 → 오류 때 이전 변경도 롤백하는지 → 전후 건수 순서로 확인했다. 전체 state deepEqual과 건수는 원래 공개 검사, 중간 오류 롤백은 [cloud-integration.json](../verification/cloud-integration.json)의 실제 PostgreSQL 합성 검사에 있다. 이는 모든 가능한 공격을 검증했다는 뜻은 아니다.

두 계정 자료 생성·양방향 6건·계정 힌트·익명 요청·목록/export 비혼입·자료 불변·차단 코드 위치를 보관했다. 다음 카드 5의 실제 5일과 합성 시험 기록은 구분한다.
