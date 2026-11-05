# CLAUDE.md

Claude 웹 채팅 내용을 일회용 링크와 Chrome 확장 프로그램으로 티스토리 **임시저장** 글로 보내는 원격 MCP 서버.
아키텍처: `NEW.md`, 남은 작업: `NEXT.md`.

## 명령어

```bash
npm run dev     # .env 읽어 로컬 실행 (http://localhost:3000)
npm test        # 단위 테스트 (tsx --test src/*.test.ts)
npx tsc --noEmit
npm run ext:config # .env의 PUBLIC_URL로 extension/manifest.json 생성
```

CI(`.github/workflows/ci.yml`)는 push마다 `tsc --noEmit` + `npm test`.

배포: Railway가 GitHub 저장소의 `Dockerfile`로 빌드한다. 환경변수(`PUBLIC_URL`, `PORT=3000`)는 Railway 서비스의 Variables 탭에서 관리하고, `.env`는 로컬 실행과 `ext:config`에만 쓴다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/index.ts` | Express 앱. `POST /mcp`(인증 없음, `toolCallGuard`), `/privacy`. GET/DELETE `/mcp`는 405 |
| `src/privacy.ts` | 개인정보처리방침 HTML. 보관 기간·호스팅·수집 항목이 바뀌면 함께 고친다 |
| `src/tool.ts` | `tistory_write_post` 등록, 입력 검증(`INVALID_INPUT`), 링크 반환, 작성 지침이 담긴 도구 설명 |
| `src/jobs.ts` | 메모리 작업 저장소(TTL 30분, lease 60초, 최대 500개), `/d/:token` 미리보기, `/api/jobs/:token/{claim,complete,release}` |
| `src/markdown.ts` | `marked` → `sanitize-html` 허용 목록. h2/h3에 `section-N` id 부여 + 목차 자동 삽입, span color는 2색만. ```` ```svg ```` 블록은 sanitize 뒤 `<img data-mcp-svg>`(data URL)로 |
| `extension/` | MV3 확장 프로그램. `content.js` 저장 버튼 + SVG→PNG(canvas, 2배), `background.js` 업로드·치환자 교체·저장, `classify.js` 응답 분류·치환자. `manifest.json`은 `manifest.template.json`에서 생성, git 제외 |
| `Dockerfile` | Railway 배포 이미지. `USER node` |

## 핵심 결정과 이유 (바꾸기 전에 확인)

- **stateless + `enableJsonResponse: true`**: 세션과 SSE 스트림 없이 요청마다 서버를 만든다. 단순해서 유지.
- **`PUBLIC_URL`**: Railway 도메인(`https://<서비스>.up.railway.app`). Railway Variables와 로컬 `.env`(확장 프로그램 생성용)에 같은 값을 둔다. `allowedHosts`가 이 호스트명만 허용한다. 바꾸면 확장 프로그램도 다시 생성·심사해야 한다. 빈 값이면 서버가 시작을 거부한다.
- **인스턴스 1개, 슬립 끔**: 작업과 요청 제한 카운터가 메모리에 있다. 레플리카를 늘리거나 App Sleeping을 켜면 링크가 깨진다.
- **도구는 1개만**: `tistory_write_post`. 대화 구간 선택은 Claude가 하고, 서버는 대화를 볼 수 없다.
- **INVALID_INPUT은 핸들러에서 검사**: zod 스키마에 길이 제한을 넣으면 SDK가 프로토콜 오류로 바꿔 버려 `{ok:false, errorCode}` 형식이 깨진다.
- **쿠키를 다루지 않음**: 저장은 확장 프로그램이 브라우저 세션으로 한다. `cookies` 권한도 없다.
- **저장은 버튼 클릭으로만**: `/mcp`가 인증 없이 열려 있어 누구나 링크를 만들 수 있다. 링크를 여는 것만으로 저장하면 안 된다.
- **인증 없음**: 공개 서비스라 사용자 계정이 없다. 남용 방지는 `tools/call` 제한(Anthropic 대역은 공용 `CLAUDE_TOOL_CALLS_PER_MIN`, 그 밖은 IP별 `TOOL_CALLS_PER_MIN`), `tools/call` 배치 거부, 전체 작업 상한(`JOB_MAX`)뿐이다.
- `trust proxy = 2`: Railway는 `X-Forwarded-For`를 `클라이언트, 엣지 IP`로 새로 쓰고(위조 값 버림) 내부 홉(`100.64.0.x`)을 거친다. 1이면 매번 바뀌는 엣지 IP를 클라이언트로 보아 요청 제한이 깨진다 (2026-11-05 실측).

## 티스토리 내부 API (비공식)

- `POST https://{blog}.tistory.com/manage/drafts`, JSON `{title, content(HTML), tags:"", categoryId:0, totalWritingTimeMs:0}`
- 응답 `{"success":true,"total":N,"draft":{"sequence":13}}` → `sequence`가 `draftId`
- CSRF 없음, 쿠키만. 비로그인은 로그인 페이지로 redirect → 확장 프로그램에선 `status 0`, `opaqueredirect` → `SESSION_EXPIRED`
- 확장 프로그램의 `Origin`을 바꾸지 않아도 성공한다 (실측).
- 블로그 목록: `GET https://www.tistory.com/legacy/member/blog/api/myBlogs` → `data[].name`, `defaultBlog`
- 이미지 업로드 (2026-11-03 캡처): `POST https://{blog}.tistory.com/manage/post/attach.json`, XHR `multipart/form-data`, 필드 `file` 하나
  - 응답 `{name, url, key, filename:"img.png", size}`. `url`은 `blog.kakaocdn.net/dna/{key}/img.png?credential=…&expires=…&signature=…` 서명 URL (약 4주 만료)
  - 에디터가 저장하는 본문은 `<img>`가 아니라 치환자: `<p>[##_Image|kage@{key}/img.png?{서명 쿼리}|CDM|1.3|{"originWidth":W,"originHeight":H,"style":"alignCenter","filename":"…"}_##]</p>`
  - 에디터 파일 input `accept`에 `image/svg+xml`도 있다 (SVG 직접 업로드 가능성, 미검증)
  - `drafts` API에 치환자를 넣으면 그대로 저장되고 에디터에서 이미지로 렌더된다 (2026-11-03, draft 34)
  - 서명 쿼리는 빼도 된다: `kage@{key}/img.png`만 넣어도 티스토리가 열 때 새로 서명한다. 따라서 치환자는 서명 없이 만든다
  - 미확인: 발행 글 렌더, SVG 직접 업로드
  - 에디터는 `p`의 `margin`과 위아래 `padding`을 0으로 덮어쓴다. `line-height`, `padding-left`, `border-bottom`, `color`, `letter-spacing`은 남는다 (2026-11-03). 간격은 `line-height`로 준다
  - 관찰: 에디터에서 임시저장 글을 불러온 뒤 저장 없이 나가면 그 글이 목록에서 사라졌다 (draft 34). 원인 미확인

## 규칙

- 로그에 본문, 쿠키, 토큰을 남기지 않는다. 길이와 결과 코드만.
- `.env`는 git·Docker 이미지에 넣지 않는다 (`.gitignore`, `.dockerignore`).
- Railway 설정 변경은 사용자가 직접 한다. `main` push는 곧 공개 배포다.
- 문서·주석은 한국어.

## 진행 상황 (2026-11-05)

- [x] Claude 웹 커스텀 커넥터 → 일회용 링크 → 확장 프로그램 → 임시저장 E2E (Railway에서 확인)
- [x] 태그 5개, SVG 다이어그램 자동 첨부, 목차·도입 디자인
- [x] 약관 검토(사용자 판단), 개인정보처리방침(`/privacy`), OAuth 제거, Claude 대역 공용 요청 제한
- [ ] 공개: 배포 확인, 웹 스토어, README (`NEXT.md`)
- [ ] 2단계: 카테고리 (`categoryId`) → 일반 이미지 → 발행·수정·삭제

## 고려사항 / 미해결

- **실행 절차**: Railway 도메인 고정, 커넥터 1회 등록(인증 없음). 코드 수정 후 `main`에 push하면 Railway가 재배포한다.
- **API 변경 위험**: 비공식 API. `TISTORY_REJECTED`/`UNKNOWN`이 늘면 에디터 요청을 개발자 도구로 다시 캡처해 위 API 절을 고친다.
- **약관 회색지대**: 이용약관 제12조 제1항 14호(리버스 엔지니어링)·13호(영리 활동). 공개는 사용자가 판단했다 (2026-11-05).
- **미확인**: `express.json()` 기본 100kb 상한으로 긴 한글 본문이 막힐 가능성, 본문 실제 길이 상한(50,000자는 가정값), 임시저장 개수 상한, 티스토리 측 `<script>` 필터링 여부(우리는 자체 제거).
- 블로그 임시저장함에 테스트 글(`[MCP 테스트] …`, `[MCP PoC] …`)이 남아 있을 수 있다.
