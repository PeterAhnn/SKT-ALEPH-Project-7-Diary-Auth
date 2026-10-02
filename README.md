# 플랜두씨 다이어리 2 · T07

T06의 Plan → Do → See 앱에 가입·로그인과 계정별 자료 보호를 붙였습니다. [공개 앱](https://skt-aleph-project-7-diary-auth.vercel.app)의 로그인 첫 화면은 누구나 열 수 있고 개인 기록은 로그인한 계정에만 보입니다.

**현재:** 공개 HTTPS·전용 PostgreSQL 배포 및 운영 API 검사 완료. 자동 48개, PostgreSQL 합성 검사 13개, 공개 API 검사 10개 통과. T06 실제 계정 이관은 7표 전체 digest 일치로 확인했습니다. 실제 5일 관찰과 최종 제출은 미완료입니다. 관찰 지표는 사용자가 선택한 **완료한 할 일 수(개)**이며 질문·첫 계획 규칙은 사용자 채택 완료, 계산 동의와 관찰 시작 저장은 확인 전입니다. [해야 할 일 체크](docs/TODO.md).

[공식 안내와 진행 상태](docs/TASK-READBACK.md) · [충족 여부와 확인 일정](docs/ACCEPTANCE-AUDIT.md) · [인증 구현 설명서](docs/AUTH-IMPLEMENTATION.md) · [5일 관찰 준비](docs/OBSERVATION-PLAN.md) · [전체 자료 이관](docs/DATA-MIGRATION.md) · [다음 작업](HANDOFF.md) · [제출 초안](docs/SUBMISSION.md)

## 실행

Node.js 24에서 실행합니다. 현재 확인한 런타임은 Node 24.18.0이며 공개 저장소 연결에는 `pg 8.23.1`을 사용합니다.

```powershell
npm ci
npm start
```

주소: `http://127.0.0.1:8009`. 가입 후 로그인해서 기록을 시작합니다. `.data/t07/identity.sqlite`에 계정·세션을, `.data/t07/accounts/<서버 계정 UUID>.sqlite`에 해당 계정의 다이어리를 저장합니다. 처음에는 빈 다이어리입니다. T06의 `.env`, `.vercel`, 운영 DB를 복사하지 마세요.

비밀번호는 Node `crypto.scrypt`로 처리합니다. 서버 세션은 최대 8시간 유지하고 로그아웃·비밀번호 변경 시 서버 DB에서 무효화합니다. 로그인 화면에서 이메일 소유 확인과 자동 비밀번호 재설정을 현재 지원하지 않는다고 안내합니다. 계정 삭제는 현재 비밀번호와 계정 아이디를 다시 입력한 뒤 계정과 이 앱의 개인 DB 파일을 함께 삭제합니다.

로컬 개발은 loopback HTTP와 계정별 SQLite를 사용합니다. 공개 운영은 Vercel HTTPS와 T07 전용 Supabase PostgreSQL을 사용합니다. `api/index.mjs`가 제한된 DB 역할로 서버에서만 연결하며, 인증·세션과 계정별 12표 JSONB를 지속 저장합니다. 함수 임시 파일에 개인 자료를 저장하지 않습니다. [실제 배포 구조와 한계](docs/CLOUD-DEPLOYMENT-PLAN.md).

## 확인한 범위

```powershell
npm test
npm run check
```

- 자동 검사 48개 통과: 기존 다이어리 회귀, 인증·소유자 분리·관찰·이관, 12표 cloud snapshot 복원, TLS 설정 및 socket이 없는 서버리스 요청 검사.
- 격리된 gstack Chromium에서 합성 계정으로 화면 검사 10개 통과: 가입·로그인·계획 저장·새로고침·로그아웃·직접 주소 접근·잘못된 로그인, 375px 가로 넘침 확인.
- [가린 HTTP 요청·응답](verification/auth-local.json), [브라우저 검사 기록](verification/auth-browser.json), [로그인 화면](verification/login-desktop.png), [모바일 화면](verification/login-mobile.png), [합성 로그인 화면](verification/authenticated-synthetic.png).

로컬 검사는 합성 자료입니다. 추가 [PostgreSQL 검사](verification/cloud-integration.json) 13개와 [공개 HTTPS API 검사](verification/production-api.json) 10개도 합성 계정으로 수행했으며 실제 5일 사용을 증명하지 않습니다. 소스 검사는 지정 패턴과 문법 검사이며 모든 종류의 비밀값 부재를 보증하지 않습니다.

## 실제 관찰과 이관

1. T06 자료가 있다면 빈 계정에서 ‘T06 자료 가져오기’로 전체 JSON을 선택하고 표별 건수를 확인해 가져옵니다. 원본 ID·날짜·값·7표 관계를 보존합니다. 현재 공개 자료는 제출 보존본과 다르며 사용자는 현재 전체 자료의 이관을 선택했습니다. [읽기 전용 대조](verification/t06-live-export-check.json).
2. 새 계획을 만든 뒤 ‘5일’에서 질문·첫 규칙·계산 기준을 직접 확정합니다. 관찰 시작 날짜 안에 1일차를 확정하세요. 처음 질문은 AI 제안이며 첫 규칙은 빈 칸입니다.
3. 완료 이벤트가 한국 날짜별 개수로 계산됩니다. 같은 날 같은 할 일은 한 번, 미기록은 실제 0과 구분합니다. 하루를 확정하면 그 날짜에 완료를 더 추가할 수 없습니다.
4. 2일차 확정 뒤 실제 1~2일차를 보고 규칙 하나를 변경합니다. 그다음 서로 다른 날짜에 3~5일차를 이어 갑니다. 변경 없이 3일차 완료/확정은 거절됩니다.
5. 5일 합계·평균 및 전후 2일/3일을 비교하고 직접 계산한 값을 입력해 대조합니다. 전체 내보내기는 기존 7표와 관찰·변경·대조·이관 기록을 한 JSON에 포함합니다. 계정·세션·비밀번호는 포함하지 않습니다.

[관찰/이관 자동 검사](verification/observation-local.json) · [이관 오류·롤백 검사](verification/migration-local.json) · [관찰 화면 검사](verification/observation-browser.json) · [현재 로컬 계약](contracts/t07-schema-v3.json)

추가 브라우저 검사 10개는 **가상 날짜·합성 개수**로 이관 UI, 5일 화면, 한 번의 규칙 변경, 손계산 입력을 확인한 결과입니다. 실제 사용 5일의 증거가 아닙니다. 실제 사용자 계정 이관과 첫 관찰은 아직 시작하지 않았습니다.

## T06 연속성과 보관

실제 최종 T06 제출 커밋은 `b9de0298cd200961eac56286c6a6a55299947a96`이며 T07 Git 이력의 조상으로 유지했습니다. 출발 HEAD는 후속 문서 커밋 `db3de5dcc8a0d5d99da7a0f7e5908c7fd0ddad93`입니다. T07에 원격 GitHub 저장소·고정 공개 소스 URL은 아직 없습니다.

상속한 `records/`, `contracts/pds-schema-v2.json`, 기존 `docs/`와 `verification/`의 T06 자료는 역사적 기준 자료입니다. **T07 사용·검사 결과로 재분류하지 않습니다.** 원래 안내는 [T06 README](docs/T06-README.md), [T06 인수인계](docs/T06-HANDOFF.md), [T06 제출 기록](docs/T06-SUBMISSION.md)에 보존했습니다. T06 원본 저장소는 이 작업에서 변경하지 않았습니다.
