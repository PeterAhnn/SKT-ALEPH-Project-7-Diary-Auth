# 플랜두씨 다이어리 2 · T07

T06의 Plan → Do → See 앱에 가입·로그인과 계정별 자료 보호를 붙인 로컬 구현입니다. 로그인 첫 화면은 누구나 열 수 있고 개인 기록은 로그인한 계정에만 보입니다.

**현재:** 로컬 인증·내보내기·계정 삭제 검사 완료. 공개 HTTPS 배포, T06 실제 자료 이관, 실제 5일 사용과 최종 제출은 미완료입니다. 관찰 지표는 사용자가 선택한 **완료한 할 일 수(개)**이며 질문·첫 계획 규칙은 제안 단계입니다.

[공식 안내와 진행 상태](docs/TASK-READBACK.md) · [인증 구현 설명서](docs/AUTH-IMPLEMENTATION.md) · [5일 관찰 준비](docs/OBSERVATION-PLAN.md) · [다음 작업](HANDOFF.md) · [제출 초안](docs/SUBMISSION.md)

## 실행

Node.js 24에서 외부 패키지 설치 없이 실행합니다. 현재 확인한 런타임은 Node 24.18.0입니다.

```powershell
npm start
```

주소: `http://127.0.0.1:8009`. 가입 후 로그인해서 기록을 시작합니다. `.data/t07/identity.sqlite`에 계정·세션을, `.data/t07/accounts/<서버 계정 UUID>.sqlite`에 해당 계정의 다이어리를 저장합니다. 처음에는 빈 다이어리입니다. T06의 `.env`, `.vercel`, 운영 DB를 복사하지 마세요.

비밀번호는 Node `crypto.scrypt`로 처리합니다. 서버 세션은 최대 8시간 유지하고 로그아웃·비밀번호 변경 시 서버 DB에서 무효화합니다. 로그인 화면에서 이메일 소유 확인과 자동 비밀번호 재설정을 현재 지원하지 않는다고 안내합니다. 계정 삭제는 현재 비밀번호와 계정 아이디를 다시 입력한 뒤 계정과 이 앱의 개인 DB 파일을 함께 삭제합니다.

로컬 개발은 loopback HTTP를 사용합니다. 외부 공개 운영은 HTTPS와 지속 저장소가 필요하며 현재 준비되지 않았습니다. `api/index.mjs`는 기존 T06 공개 DB에 연결하지 않고 503으로 응답합니다.

## 확인한 범위

```powershell
npm test
npm run check
```

- 자동 검사 36개 통과: 기존 다이어리 회귀, 비밀번호 salt, 중복 가입, 같은 로그인 오류, 익명 API 거절, CSRF, 세션 종료·만료, 양방향 소유자 차단, 계정 위조 무효, 내보내기, 삭제, 로그인 횟수 제한, 미구성 서버리스 차단.
- 격리된 gstack Chromium에서 합성 계정으로 화면 검사 10개 통과: 가입·로그인·계획 저장·새로고침·로그아웃·직접 주소 접근·잘못된 로그인, 375px 가로 넘침 확인.
- [가린 HTTP 요청·응답](verification/auth-local.json), [브라우저 검사 기록](verification/auth-browser.json), [로그인 화면](verification/login-desktop.png), [모바일 화면](verification/login-mobile.png), [합성 로그인 화면](verification/authenticated-synthetic.png).

이 검사는 합성 자료이며 실제 5일 사용이나 공개 운영 검증을 증명하지 않습니다. 소스 검사는 지정 패턴과 문법 검사이며 모든 종류의 비밀값 부재를 보증하지 않습니다.

## T06 연속성과 보관

실제 최종 T06 제출 커밋은 `b9de0298cd200961eac56286c6a6a55299947a96`이며 T07 Git 이력의 조상으로 유지했습니다. 출발 HEAD는 후속 문서 커밋 `db3de5dcc8a0d5d99da7a0f7e5908c7fd0ddad93`입니다. T07에 원격 GitHub 저장소·고정 공개 소스 URL은 아직 없습니다.

상속한 `records/`, `contracts/pds-schema-v2.json`, 기존 `docs/`와 `verification/`의 T06 자료는 역사적 기준 자료입니다. **T07 사용·검사 결과로 재분류하지 않습니다.** 원래 안내는 [T06 README](docs/T06-README.md), [T06 인수인계](docs/T06-HANDOFF.md), [T06 제출 기록](docs/T06-SUBMISSION.md)에 보존했습니다. T06 원본 저장소는 이 작업에서 변경하지 않았습니다.
