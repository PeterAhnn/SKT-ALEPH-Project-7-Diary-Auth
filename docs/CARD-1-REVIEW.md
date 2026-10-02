# 카드 1 — 선택·이유·가입 흐름·T06 이관 확인

확인일: 2026-10-02, 한국 시간. 사용자의 요청에 따라 카드 1부터 순서대로 확인한다. 오늘 보존한 [공식 원문](./TASK-SOURCE.md)의 첫 행동·통과 기준·막힐 때 확인 순서·남길 것을 아래에 대조했다. 기존 실제 검사 기록과 현재 소스를 검토했으며 이번 문서 대조에서 본인 계정을 로그아웃하거나 자료를 변경하지 않았다. 새 운영 시험을 수행했다고 주장하지 않는다.

**판정: 카드 1의 구현·검증 근거와 제출 초안은 준비됐다. 최종 플랫폼 제출은 아직 하지 않았다.** 카드 2~5는 이 카드의 판정으로 완료 처리하지 않는다.

## 첫 행동과 선택 이유

- 방식·이름·버전: 직접 Node 인증 라우트 + 서버 DB 세션, 앱 0.3.0. 공개 Vercel Node 24 / Supabase PostgreSQL 17.11.0.002 / pg 8.23.1. 비밀번호 암호 함수는 내장 crypto.scrypt.
- 고른 이유: T06의 자료·이력·작업 로직을 이어 쓰고, 매 요청 서버 세션을 확인해 로그아웃 뒤 기존 인증값을 바로 거절한다.
- 검토한 대안과 이유: Supabase Auth는 관리형 인증 기능의 장점이 있으나 로그아웃 직후 기존 JWT 거절에는 추가 세션 확인이 필요하다. 현재는 DB 공급자로 사용한다. 직접 작성한 인증 정책의 유지·검토 부담은 남는다.
- 가입·로그인·로그아웃과 익명 자료 URL 이동을 기존 공개 UI/API 근거에 대조했다.
- 사용자가 선택한 현재 T06 전체 자료는 실제 본인 계정의 가져오기·전체 내보내기로 7표 전체 값의 일치를 확인했다.

## 통과 기준 10개

| 공식 기준 | 확인 결과 | 근거 |
|---|---|---|
| C91 방식과 이름을 제출문에 적기 | 초안에 직접 Node 인증 + DB 세션 명시 | [제출 초안](./SUBMISSION.md), [설명서 ①](./AUTH-IMPLEMENTATION.md) |
| C92 사용 이름·버전 적기 | 앱·실행 환경·DB·연결 패키지 버전 명시 | 제출 초안, 설명서 ①, package.json |
| C93 다른 방법과 선택하지 않은 이유 | Supabase Auth 및 인증 라이브러리 대안과 이유 존재 | 제출 초안, 설명서 ② |
| C94 가입 화면에서 새 계정 만들기 | 공개 HTTPS 가입 폼으로 시험 계정 생성 확인 | [production-browser.json](../verification/production-browser.json) |
| C95 만든 계정 로그인 | 공개 HTTPS 로그인 후 자신의 다이어리 열림 | production-browser.json, [production-api.json](../verification/production-api.json) |
| C96 로그아웃 | 공개 UI가 로그인 화면으로 돌아옴 | production-browser.json |
| C97 익명 자료 URL은 로그인 화면 | 공개 /diary 303 → 로그인 첫 화면, 개인 API 401 | production-browser.json, production-api.json |
| C98 같은 이메일로 두 번 가입 불가 | 상세 로컬 HTTP 중복 가입 409. 공개 API 초기 통과 이력도 보존 | [auth-local.json](../verification/auth-local.json) registration-and-password-storage, [production-qa-history.json](../verification/production-qa-history.json) |
| C99 틀린 비밀번호·없는 계정의 문구 동일 | 두 경우 모두 401 / “아이디 또는 비밀번호를 확인해 주세요.” | auth-local.json, production-api.json |
| C100 T06 이어 붙이기와 실제 내 자료 이관 | 제출된 T06 커밋의 계보 보존. 현재 전체 7표의 모든 값과 digest가 실제 가져오기 직후 export와 일치 | [actual-migration.json](../verification/actual-migration.json), [보존 검사](../verification/t06-preservation-current.json), Git 계보 |

## 근거의 범위와 남길 것

공개 가입/로그인/로그아웃 검사는 실제 HTTPS를 사용하는 **합성 시험 계정** 검사다. T06 가져오기는 **실제 본인 자료**이며 두 종류를 구분한다. 최신 반복 API 검사의 계정 생성은 서버 fixture이고 공개 가입 폼 증거는 별도 production-browser.json이다. 중복 가입의 상세 요청·409 응답은 auth-local.json에 남아 있으며 공개 초기 검사 이력의 요약을 상세 응답으로 바꾸어 쓰지 않는다. 이후 불필요한 반복 가입은 공유 횟수 제한 429에 걸렸고 그 실패도 이력에 남겨 두었다.

가입·로그인·로그아웃 화면 확인 기록과 익명 자료 URL 이동 기록은 production-browser.json에 남아 있다. 공개 로그인 화면은 production-login-desktop.png, 로그인한 합성 화면은 production-authenticated-synthetic.png에 보관했다. 비밀번호·쿠키·토큰·CSRF 원문은 보고서에서 가린다. 실제 본인 export 원문은 공개 Git에 넣지 않는다. 심사자가 실제 계정 비밀번호를 받는 방식은 사용하지 않는다.

실제 이관 비교 당시 건수는 계획 3, 계획 이력 7, 할 일 8, 실행 4, 완료 이벤트 8, 요청 영수증 8, 회고 1이다. 이후 새 관찰 계획을 추가했으므로 현재 전체 export의 digest가 이관 당시와 같아야 한다고 요구하지 않는다.

## 막힐 때 확인 순서와 다음 카드

공식 확인 순서는 비밀번호를 직접 다루기 부담되면 서비스/널리 쓰이는 라이브러리를 검토 → 선택 이유를 한 문장으로 설명 가능한지 확인 → 남의 구현 사용 자체는 감점이 아니며 선택 이유를 남기는 것이다. 현재 선택 이유와 직접 구현의 부담을 문서에 적었다.

다음은 카드 2다. scrypt 선택·이유, 실제 저장 hash, 같은 비밀번호의 다른 salt/hash, 요청·응답·화면·로그의 원문 노출 여부를 순서대로 대조한다.
