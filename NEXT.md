# 남은 작업 (2026-11-05 기준)

서비스 공개까지 남은 일을 순서대로 적는다. 아키텍처와 결정 이유는 `NEW.md`를 본다.

## 현재 상태

- 저장소는 공개 상태이고 MIT 라이선스다.
- 서버는 Railway(US West)에서 돈다. 임시저장까지 Claude 웹에서 확인했다.
- 약관은 사용자가 확인하고 공개하기로 판단했다 (2026-11-05).
- OAuth 제거, 개인정보처리방침, Claude 대역 공용 요청 제한이 작업 트리에 있다. push 전까지 배포된 서버는 이전 버전(OAuth 보호)이다.

## 1. 배포

- [ ] 커밋하고 `main`에 push한다. push하는 즉시 `/mcp`가 인증 없이 공개된다.
- [ ] Railway에서 OAuth용 볼륨(`/app/data`)과 Variables(`OWNER_PASSPHRASE`, `OAUTH_STATE_FILE`, `RAILWAY_RUN_UID`)를 지운다. 남길 Variables는 `PUBLIC_URL`, `PORT=3000`이다.
- [ ] Claude 커넥터를 삭제하고 같은 URL(`/mcp`)로 다시 추가한다. 인증 설정은 비운다.
- [ ] 저장 흐름을 다시 확인하고, `/privacy`가 열리는지 확인한다.
- [ ] `trust proxy = 1`이 맞는지 확인한다. 틀리면 Claude 요청이 공용 한도(분당 30)가 아니라 IP별 한도(분당 10)로 묶인다.

## 2. Railway 운영

- 인스턴스 1개, App Sleeping 끔. 작업(`src/jobs.ts`)과 요청 제한 카운터가 메모리에 있다.
- [ ] 요금제와 월 비용을 확인한다.
- [ ] 공용 한도 `CLAUDE_TOOL_CALLS_PER_MIN`(분당 30)을 사용량을 보며 조정한다. Claude 사용자 전체가 나눠 쓰므로, 사용자가 늘면 사용자 식별이 필요하다.

## 3. Chrome 웹 스토어 등록

- [ ] `manifest.template.json`에서 `localhost` 권한을 제거한다.
- [ ] Railway 주소로 `manifest.json`을 생성해 제출한다. 주소가 바뀌면 다시 심사받아야 한다.
- [ ] 개인정보처리방침 URL(`/privacy`)을 등록한다. 심사 기간은 예측할 수 없다.
- 보관 기간, 호스팅, 수집 항목이 바뀌면 `src/privacy.ts`도 함께 고친다.

## 4. 문서

- [ ] 웹 스토어 등록 뒤 `README.md`의 설치 안내를 스토어 링크로 바꾼다.

## 5. 나중에 판단할 일

- `express.json()` 기본 상한 100kb: 한글 약 3만 자 이상에서 막힐 수 있다. 실측 전이다. 필요해지면 `256kb`로 올린다.
- 클릭 없는 자동 저장: 클릭이 실제로 불편하면 검토한다. 사용자 식별이 다시 필요하다.
- 기능 추가: 카테고리(목록 조회 API 미조사), 일반 이미지, 발행·수정·삭제.
- 커밋 작성자 이메일이 공개 기록에 남아 있다. 가리려면 기록을 다시 써서 force push해야 한다.

## 6. 직접 정리할 것

- [ ] 블로그 임시저장함의 테스트 글(`[MCP 테스트] …`, `[MCP PoC] …`)을 지운다.
- [ ] 로컬 `.env`에서 `OWNER_PASSPHRASE`, `TS_AUTHKEY`, 옛 주석을 지우고 `PUBLIC_URL`, `PORT`만 남긴다.
- [ ] Tailscale 관리 콘솔(**Settings → Keys**)에서 `TS_AUTHKEY`를 폐기한다. 작업 중 값이 노출됐다 (2026-11-05).
