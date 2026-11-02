# CLAUDE.md

Claude 웹 채팅 내용을 일회용 링크와 Chrome 확장 프로그램으로 티스토리 **임시저장** 글로 보내는 원격 MCP 서버.
아키텍처와 진행 단계: `NEW.md`, 티스토리 내부 API 조사: `userMD/2.티스토리API조사.md`.

## 명령어

```bash
npm run dev     # .env 읽어 로컬 실행 (http://localhost:3000)
npm test        # 단위 테스트 (tsx --test src/*.test.ts)
npx tsc --noEmit
npm run up      # docker compose up -d --build (Tailscale Funnel + 서버)
npm run down    # docker compose down
```

CI(`.github/workflows/ci.yml`)는 push마다 `tsc --noEmit` + `npm test`.

## 구조

| 파일 | 역할 |
|---|---|
| `src/index.ts` | Express 앱. `mcpAuthRouter`, `/consent`, `POST /mcp`(Bearer 필수). GET/DELETE `/mcp`는 405 |
| `src/auth.ts` | 내장 OAuth 인가 서버 `OwnerAuthProvider`. 클라이언트·토큰 해시는 상태 파일, 패스프레이즈 폼, 5회 실패 시 15분 잠금 |
| `src/tool.ts` | `tistory_write_post` 등록, 입력 검증(`INVALID_INPUT`), 링크 반환, 작성 지침이 담긴 도구 설명 |
| `src/jobs.ts` | 메모리 작업 저장소(TTL 30분, lease 60초, 최대 500개), `/d/:token` 미리보기, `/api/jobs/:token/{claim,complete,release}` |
| `src/markdown.ts` | `marked` → `sanitize-html` 허용 목록. h2/h3에 `section-N` id 부여 + 목차 자동 삽입, span color는 2색만 |
| `extension/` | MV3 확장 프로그램. `content.js` 저장 버튼, `background.js` 호출, `classify.js` 응답 분류. 서버 주소는 `manifest.json`에만 있음 |
| `docker-compose.yml`, `tailscale/serve.json` | tailscale 사이드카(userspace) + Funnel → `127.0.0.1:3000`. mcp는 `network_mode: service:tailscale` |

## 핵심 결정과 이유 (바꾸기 전에 확인)

- **stateless + `enableJsonResponse: true`**: 원래 Cloudflare quick tunnel이 SSE를 지원하지 않아 택했다. Funnel에선 제약이 없지만 단순해서 유지.
- **OAuth 상태 파일 저장**: `OAUTH_STATE_FILE`(Docker는 `mcp-state` 볼륨의 `/app/data/oauth.json`)에 클라이언트와 토큰 SHA-256 해시를 저장. 재빌드해도 재인가 불필요. `PUBLIC_URL`이 바뀌면 토큰 폐기. 인가 대기·코드·실패 잠금은 메모리.
- **`PUBLIC_URL`**: `.env`에 Funnel 고정 주소(`https://tistory-mcp.<tailnet>.ts.net`). 빈 값이면 서버가 시작을 거부한다.
- **도구는 1개만**: `tistory_write_post`. 대화 구간 선택은 Claude가 하고, 서버는 대화를 볼 수 없다.
- **INVALID_INPUT은 핸들러에서 검사**: zod 스키마에 길이 제한을 넣으면 SDK가 프로토콜 오류로 바꿔 버려 `{ok:false, errorCode}` 형식이 깨진다.
- **쿠키를 다루지 않음**: 저장은 확장 프로그램이 브라우저 세션으로 한다. `cookies` 권한도 없다.
- **저장은 버튼 클릭으로만**: OAuth를 빼고 공개하면 공격자가 만든 링크를 받을 수 있어, 링크를 여는 것만으로 저장하면 안 된다.
- **OAuth는 공개 배포 때 제거**: 그 전까지 `/mcp`를 인증 없이 열지 않는다.
- `trust proxy = 1`: Funnel 프록시 뒤에서 SDK rate limit이 실제 IP를 보게 한다.

## 티스토리 내부 API (비공식)

- `POST https://{blog}.tistory.com/manage/drafts`, JSON `{title, content(HTML), tags:"", categoryId:0, totalWritingTimeMs:0}`
- 응답 `{"success":true,"total":N,"draft":{"sequence":13}}` → `sequence`가 `draftId`
- CSRF 없음, 쿠키만. 비로그인은 로그인 페이지로 redirect → 확장 프로그램에선 `status 0`, `opaqueredirect` → `SESSION_EXPIRED`
- 확장 프로그램의 `Origin`을 바꾸지 않아도 성공한다 (실측).
- 블로그 목록: `GET https://www.tistory.com/legacy/member/blog/api/myBlogs` → `data[].name`, `defaultBlog`

## 규칙

- 로그에 본문, 쿠키, 패스프레이즈, 토큰을 남기지 않는다. 길이와 결과 코드만.
- `.env`, `secrets/`는 git·Docker 이미지에 넣지 않는다 (`.gitignore`, `.dockerignore`).
- 패스프레이즈 입력, 공개 터널 실행(`npm run up`)은 사용자가 직접 한다.
- 문서·주석은 한국어.

## 진행 상황 (2026-11-02)

- [x] MVP: Claude 웹 커스텀 커넥터 → OAuth → 임시저장 E2E 성공 (검증 순서 1~4 통과)
- [x] Docker + quick tunnel 실행 스크립트 → Tailscale Funnel 고정 URL로 교체
- [x] CI, README, `.gitattributes` (eol=lf)
- [x] 쿠키 방식을 일회용 링크 + 확장 프로그램으로 교체, 실제 흐름 검증 완료
- [ ] 공개 배포: OAuth 제거, 호스팅, 웹 스토어, 약관 검토
- [ ] 2단계: 태그·카테고리 (`tags`, `categoryId` 필드만 채우면 됨) → 이미지 → 발행·수정·삭제

## 고려사항 / 미해결

- **실행 절차**: Funnel로 URL 고정, 커넥터 1회 등록·인가. 코드 수정 후 `npm run up`만.
  - 대안: Claude 데스크톱 + stdio → 터널·OAuth·Docker 불필요, 단 웹 사용 불가.
- **잠금 DoS**: 패스프레이즈 실패 잠금이 전역이라 제3자가 일부러 틀리면 소유자도 15분 잠긴다. 개인용이라 감수.
- **API 변경 위험**: 비공식 API. `TISTORY_REJECTED`/`UNKNOWN`이 늘면 `userMD/2.티스토리API조사.md` 방식으로 재캡처.
- **약관 회색지대**: 저장소 공개 여부 주의 (조사 문서에 블로그명·내부 API 기록).
- **미확인**: `express.json()` 기본 100kb 상한으로 긴 한글 본문이 막힐 가능성, 본문 실제 길이 상한(50,000자는 가정값), 임시저장 개수 상한, 티스토리 측 `<script>` 필터링 여부(우리는 자체 제거).
- 블로그 임시저장함에 테스트 글(`[MCP 테스트] …`, `[MCP PoC] …`)이 남아 있을 수 있다.
