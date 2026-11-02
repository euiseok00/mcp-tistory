# MCP-Tistory: 일회용 링크 아키텍처

## 1. 확정 사항

| 항목 | 결정 |
|---|---|
| GitHub | `euiseok00/mcp-tistory` 기존 저장소 유지 |
| AI 클라이언트 | Claude 웹 |
| 아키텍처 | 인증 없는 원격 MCP 서버 + 일회용 링크 + Chrome Extension |
| 사용자 설정 | MCP 커넥터 추가 + 확장 프로그램 설치. 계정·페어링 없음 |
| 티스토리 인증 | 사용자 브라우저의 카카오 로그인 상태 활용 |
| ID/PW 및 쿠키 | 확장 프로그램이 읽지 않고 서버에 저장·전송하지 않음 |
| 핵심 기능 | 현재 채팅 내용 → 블로그 글 변환 → 링크 확인 → 티스토리 임시저장 |
| 사용자 동작 | 채팅의 링크 클릭 → 미리보기 확인 → `임시저장` 버튼 클릭 |
| 글 발행 | 사용자가 티스토리에서 직접 진행 |
| 세션 만료 | 티스토리 재로그인 후 같은 링크에서 재시도 |
| 대상 환경 | PC Chrome 우선 |

## 2. 동작 흐름

1. Claude가 `tistory_write_post`를 제목과 마크다운 본문으로 호출한다.
2. 서버가 입력을 검증하고 HTML로 변환한 뒤 작업을 메모리에 저장한다.
3. 도구가 `{ok, url, expiresAt}`를 반환한다. 이 시점에는 아직 저장되지 않았으므로, Claude는 저장 완료라고 말하지 않고 링크를 안내한다.
4. 사용자가 링크를 열면 서버가 제목과 미리보기를 보여 준다.
5. 확장 프로그램의 content script가 페이지에 `임시저장` 버튼을 활성화한다. 확장 프로그램이 없으면 페이지가 설치 안내를 보여 준다.
6. 버튼을 누르면 background가 서버에서 작업을 claim 하고, 브라우저 세션으로 `POST /manage/drafts`를 호출한다.
7. 결과를 페이지에 표시한다. 성공하면 서버의 작업을 삭제하고, 실패하면 lease를 풀어 재시도할 수 있게 한다.

## 3. 구성 요소

### MCP 서버

- `POST /mcp`: 인증 없음. 도구는 `tistory_write_post` 1개.
- `GET /d/:token`: 미리보기 페이지. 읽기만 하며 작업을 소비하지 않는다. 링크 미리보기 봇이 작업을 없애지 않게 하기 위해서다.
- `POST /api/jobs/:token/claim`: 제목과 HTML을 반환하고 60초 lease를 건다.
- `POST /api/jobs/:token/complete`: 작업을 삭제한다.
- `POST /api/jobs/:token/release`: lease를 풀어 재시도를 허용한다.

### Chrome Extension (MV3)

- `host_permissions`: `https://*.tistory.com/*`와 서버 origin.
- content script는 서버의 `/d/*`에서만 실행한다.
- background는 고정된 서버 origin과 `/manage/drafts`만 호출한다. 서버가 준 URL이나 임의 경로는 호출하지 않는다.
- `redirect: 'manual'`의 `opaqueredirect`를 `SESSION_EXPIRED`로 분류한다. 응답 분류는 `extension/classify.js`에 있다.
- 서버 주소는 `manifest.json`에만 둔다. 고정 주소가 바뀌면 이 파일만 고친다.

### 작업 저장소

| 항목 | 값 (초기값) |
|---|---|
| 저장 위치 | 메모리만. 재시작하면 사라지고 Claude에서 링크를 다시 만든다 |
| 토큰 | CSPRNG 256비트 |
| TTL | 30분 |
| 본문 상한 | 기존 `CONTENT_MAX` 50,000자 |
| 전체 상한 | 작업 500개. 초과하면 새 요청을 거부한다 |

### 오류 코드

| 코드 | 표시 위치 | 의미 |
|---|---|---|
| `INVALID_INPUT` | Claude | 제목·본문 검증 실패 |
| `SERVER_BUSY` | Claude | 전체 작업 상한 초과 |
| `LINK_EXPIRED` | 링크 페이지 | 만료, 사용 완료 또는 서버 재시작 |
| `SESSION_EXPIRED` | 링크 페이지 | 티스토리 재로그인 필요 |
| `TISTORY_REJECTED` | 링크 페이지 | 티스토리가 요청을 거부함 |
| `UNKNOWN` | 링크 페이지 | 그 외 오류 |

## 4. 보안 원칙

- **자동 저장 금지:** MCP가 인증 없이 열려 있어, 공격자가 만든 링크를 피해자에게 보낼 수 있다. 링크를 여는 것만으로 저장되면 피해자의 임시저장함에 글이 들어가므로, 반드시 미리보기 후 버튼을 눌러야 저장한다.
- **버튼 신뢰 경계:** 저장 요청은 확장 프로그램이 삽입한 UI에서만 시작한다. 웹 페이지가 보낸 메시지로는 저장하지 않는다.
- **HTML 정화:** 서버의 `sanitize-html` 허용 목록을 유지한다. 미리보기 페이지에는 스크립트를 막는 CSP를 건다.
- **토큰 보호:** 토큰은 요청 로그에 남기지 않고, 페이지에 `Referrer-Policy: no-referrer`를 건다.
- **남용 방지:** 커넥터 요청은 Anthropic 측에서 오므로 IP별 제한은 효과가 작다. 본문 상한, 전체 작업 상한, TTL로 메모리 사용량을 제한한다.
- **로그:** 본문과 토큰을 남기지 않는다. 길이와 결과 코드만 남긴다.

## 5. 구현 전 검증 사항

| 우선순위 | 검증 항목 | 결과 |
|---|---|---|
| 1 | 확장 프로그램의 임시저장 호출 | 통과. 티스토리 탭 없이 service worker에서 `200`, `draft.sequence` 반환 |
| 2 | `Origin` 처리 | 통과. 헤더 변경 없이 성공하므로 `declarativeNetRequest` 불필요 |
| 3 | 쿠키 비접근 | 통과. `cookies` 권한 없이 저장 |
| 4 | 세션 만료 판별 | 통과. 로그아웃 시 `status 0`, `opaqueredirect`. 재로그인 후 저장 성공 |
| 5 | 블로그 식별 | 통과. `GET https://www.tistory.com/legacy/member/blog/api/myBlogs`의 `data[].name`, `defaultBlog` 사용 |
| 6 | Claude 웹의 링크 표시 | 통과 |
| 7 | 실제 흐름 전체 | 통과. Claude 웹에서 링크 생성, 미리보기, 버튼 클릭, 임시저장까지 |

## 6. 개발 진행 순서

1. **Extension 단독 PoC:** 완료 (검증 1~5).
2. **서버 전환:** 구현 완료. `src/jobs.ts`, `tool.ts`.
3. **Extension 연동:** 완료 (검증 6~7). `extension/`.
4. **쿠키 코드 제거:** 완료. 필요하면 커밋 `68c4e35`에서 복구한다.
5. **공개 배포:** `src/auth.ts` 제거(이때 `/mcp`가 인증 없이 열린다), 호스팅 선정, Chrome 웹 스토어 심사, 약관 검토, `manifest.json`에서 `localhost` 제거.

5단계 전까지 `/mcp`는 기존 커넥터의 OAuth로 보호된다.

## 7. 범위 밖

- 상시 연결(WebSocket)과 클릭 없는 자동 저장. 클릭이 실제로 불편하다고 확인되면 다시 검토한다.
- 사용자 계정, OAuth, 저장 이력 보관.
- 태그·카테고리, 이미지, 발행·수정·삭제.
- Chrome 외 브라우저, 모바일.

## 8. 남은 위험

- 비공식 API를 쓰는 공개 서비스라 약관 위반 위험이 있고, API가 바뀌면 확장 프로그램 업데이트가 필요하다.
- 공개 배포용 호스팅은 미정이다. PoC와 개인 테스트는 기존 Tailscale Funnel을 쓴다.
- `createMcpExpressApp`의 `express.json()`은 기본 상한이 100kb다. 한글 본문은 `CONTENT_MAX`인 50,000자보다 훨씬 짧은 약 3만 자 부근에서 도구 호출 전에 막힐 수 있다. 실측이 필요하다.
- lease 만료 후 재시도하면 드물게 글이 중복 저장될 수 있다. 임시저장이라 사용자가 지울 수 있으므로 감수한다.
