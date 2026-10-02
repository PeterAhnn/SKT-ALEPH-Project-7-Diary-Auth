# T07 공개 운영 · 2026-10-02

[공개 앱](https://skt-aleph-project-7-diary-auth.vercel.app) · [해야 할 일](./TODO.md)

사용자가 제출까지 계속 진행하도록 요청했고, 사전에 제안한 PeterAhn's Org에서 전용 DB를 만들었다. 생성 도구의 project 비용 확인은 월 0 USD였고 조직은 Free다. 생성 당시 확인 값이며 향후 이용 증가 비용을 보증하지 않는다. 기존 T06 프로젝트는 변경하지 않았다. 이전 준비 점검은 verification/cloud-prerequisites.json에 역사적 상태로 보존한다.

| 항목 | 실제 구성 |
|---|---|
| Supabase | skt-aleph-t07-diary-auth / vagluzmvitdtshjknxrp / ap-northeast-2 / PostgreSQL 17.11.0.002 |
| Vercel | skt-aleph-project-7-diary-auth / peter-ahns-projects / Node 24 / HTTPS |
| 연결 | pg 8.23.1, Supavisor transaction pooler, TLS CA·호스트 검증, 함수별 pool max 2 |
| 인증 | 직접 Node 라우트, crypto.scrypt, 요청마다 서버 DB 세션 확인, 8시간, Secure/HttpOnly/SameSite Strict cookie |
| 물리 저장 | t07_private.users / sessions / auth_attempts / diaries. 모든 4표 RLS, anon/authenticated schema 권한 없음 |
| 자료 | 서버 세션 UUID의 diary 한 행에 논리 12표 JSONB snapshot, 계정당 2MB |
| 저장 원자성 | 계정/세션 공유 잠금 → diary FOR UPDATE → SQLite :memory: 검증 → snapshot 갱신. 실패 시 PG 롤백 |
| 소유자 RLS | 서버가 확인한 UUID를 transaction-local t07.user_id로 설정. foreign snapshot은 조회되지 않음 |
| 비밀값 | 제한된 t07_server 역할 비밀번호는 무시된 .env.cloud.local과 Vercel sensitive env. 브라우저/공개 Git에 제외 |

t07_server에는 superuser, CREATEDB, CREATEROLE, BYPASSRLS 권한이 없다. 계정·세션 표는 인증 서버 역할만 조회한다. DB 접속용 역할은 애플리케이션 신뢰 경계이며 서버 침해 시 모든 계정이 위험할 수 있다. RLS가 서버 관리자 침해까지 막는다고 주장하지 않는다.

공개 API 9개와 화면 10개가 실제 배포 주소에서 통과했다. 추가 로그/원문 응답 검사는 최종 보고서의 검사 개수와 범위에 따른다. 전용 DB 통합 13개는 로컬 HTTP + 실제 PostgreSQL, 48개 자동 검사는 로컬이다. 모두 합성 계정/자료이며 실제 관찰로 세지 않는다. 공개 API report는 verification/production-api.json, 화면은 production-browser.json, DB는 cloud-integration.json이다.

처음 배포는 가입 503: 서버리스 요청에 socket이 없었다. socket 없는 요청에 안전한 공유 횟수 제한 bucket을 사용하도록 수정하고 회귀 검사와 공개 재검사를 통과했다. TLS 인증을 끄거나 T06 공개 저장소로 우회하지 않았다.

실제 한계: HTTP 입력 64KB, 계정 자료 2MB, 매 요청 전체 snapshot 복원 및 계정 단위 저장 잠금, 공유 IP fallback bucket, 이메일 인증·자동 복구·MFA 없음, 백업 복구/소거 및 부하 시험 미수행. 배포 지역은 첫 빌드에서 iad1로 확인했고 DB는 한국이다. 낮은 지연이나 고부하 성능을 주장하지 않는다. 상세 한계는 인증 설명서 ⑥에 있다.

다음은 본인 계정 생성 → 현재 T06 전체 7표 이관/digest 대조 → 새 ALEPH 계획에서 실제 질문·첫 규칙 고정 → 실제 5일과 한 번의 변경 → 최종 설명/제출이다. 본인 비밀번호를 채팅이나 심사자에게 보내지 않는다. 실제 이관은 본인 계정으로 완료했고 7표 건수·전체 값 digest가 일치했다. 실제 5일/플랫폼 제출은 아직 수행하지 않았다.
