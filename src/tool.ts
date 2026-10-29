import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { COLOR_IMPORTANT, COLOR_WARNING, markdownToTistoryHtml } from './markdown.js';
import { TistoryError, type ErrorCode, type TistoryClient } from './tistory.js';

export const TITLE_MAX = 50;
export const CONTENT_MAX = 50_000;

const DESCRIPTION = `현재 대화(또는 사용자가 지정한 구간)를 정리해 티스토리 블로그에 임시저장한다. 발행하지 않는다.

작성 지침:
- 대화에 없는 내용을 추가하지 않는다.
- 본문은 마크다운으로 작성한다. 제목, 목록, 표, 언어를 지정한 코드블록, 인용, 링크, 굵게/기울임을 쓸 수 있다. 이미지와 mermaid 같은 다이어그램 문법은 지원하지 않는다.
- 제목은 한 줄(${TITLE_MAX}자 이내)로 쓰고, 다루는 대주제 전체 범위를 반영한다.
- 호출 후 어느 대화 범위를 사용했는지 사용자에게 한 줄로 알린다.
- 사용자가 다른 구조나 템플릿을 지정하면 그것을 따른다. 지정이 없으면 아래 기본 템플릿을 쓴다.

기본 템플릿:
- 구성 순서: 짧은 도입(무엇을 왜 정리하는지 1~2문장, 맨 처음에 쓴다) → 본문 대주제들 → "## N. ✅ 정리" → 대화에 출처 링크가 있으면 "## N+1. 🔗 출처". 목차는 서버가 ##/### 제목으로 만들어 도입 뒤에 넣는다. 본문에 목차를 직접 쓰지 않는다.
- 구조:
  - 대주제는 3~6개. 더 많으면 관련 주제끼리 묶고, 그래도 많으면 글을 나누자고 사용자에게 제안한다.
  - 제목 단계는 두 가지만: 대주제 "## 1. 🧩 주제", 소주제 "### 1.1 세부". "1.1.1" 같은 3단계 번호, #, #### 이하는 쓰지 않는다. 대주제 제목에만 내용에 맞는 이모지를 하나 붙인다. 글 제목을 본문에 반복하지 않는다.
  - 소주제는 없거나 2개 이상. 하나뿐이면 대주제 본문에 합친다.
  - 소주제에는 그 대주제에 속하는 내용만 둔다. 주제가 바뀌면 새 대주제로 뺀다. 관련 내용(예: 같은 개념의 메서드)은 한곳에 모은다.
  - 같은 설명을 두 곳에 쓰지 않는다. 대주제 간 분량을 비슷하게 맞춘다.
- 가독성:
  - 텍스트만 길게 나열하지 않는다. 문단은 2문장 이내, 한 문장은 80자 안팎.
  - 제목 바로 뒤에 코드블록이나 표를 두지 않는다. 무엇을 보여주는지 한 문장을 먼저 쓴다.
  - 비교·특징·장단점·단계·명령어 모음은 표로 정리한다. 대주제마다 표나 목록이 하나 이상 있게 한다. 표가 연달아 나오면 사이에 한 문장을 넣는다.
  - 나열은 글머리 목록, 순서가 있으면 번호 목록. 목록 항목 앞에 이모지를 붙이지 않는다(불릿과 겹침).
  - 코드·출력은 언어를 지정한 코드블록. 흐름·트리·메모리 구조 같은 설명용 그림은 \`\`\`text 블록에 ASCII로 그린다. 간단한 흐름은 "A → B → C" 한 줄.
  - 구분선(---)과 ". . ." 같은 점 구분은 쓰지 않는다.
- 강조 박스는 인용으로, 줄 맨 앞에 이모지와 굵은 라벨을 쓴다: "> 💡 <strong>참고</strong>: …". 서버가 첫 이모지에 따라 색 박스로 바꾼다. 종류: 💡 참고/팁, 📌 핵심 개념, ⚠️ 주의, ✅ 결론, 🔍 예시, 🤔 왜?, 🚀 실습. 모든 대주제에 1~2개.
- 핵심 용어와 결론은 굵게 쓴다. 굵게 부분이 따옴표·괄호로 끝나거나 바로 뒤에 한글 조사가 붙으면 ** 대신 <strong>…</strong>을 쓴다(마크다운이 인식하지 못함).
- 색상은 대화에서 사용자가 특히 중요하다고 한 부분에만 쓴다. 나머지 텍스트는 기본(검은색)으로 둔다. 허용되는 색은 두 가지뿐이다:
  - 중요: <span style="color:${COLOR_IMPORTANT}">내용</span>
  - 주의가 필요한 중요: <span style="color:${COLOR_WARNING}">내용</span>
- "정리"는 표로, 본문 대주제마다 한 행씩 빠짐없이 핵심을 요약한다. 복습 방법 같은 주제 밖 행은 넣지 않는다.`;

export type WritePostResult =
  | { ok: true; draftId: number; title: string }
  | { ok: false; errorCode: ErrorCode; message: string };

export function validateInput(title: string, content: string): string | undefined {
  const t = title.trim();
  if (t.length < 1 || t.length > TITLE_MAX) return `title은 1~${TITLE_MAX}자여야 합니다 (현재 ${t.length}자).`;
  if (/[\r\n]/.test(t)) return 'title은 한 줄이어야 합니다.';
  if (content.trim().length < 1 || content.length > CONTENT_MAX) {
    return `content_markdown은 1~${CONTENT_MAX}자여야 합니다 (현재 ${content.length}자).`;
  }
}

export async function writePost(client: TistoryClient, title: string, content: string): Promise<WritePostResult> {
  const invalid = validateInput(title, content);
  if (invalid) return { ok: false, errorCode: 'INVALID_INPUT', message: invalid };
  const cleanTitle = title.trim();
  try {
    const { draftId } = await client.saveDraft(cleanTitle, markdownToTistoryHtml(content));
    return { ok: true, draftId, title: cleanTitle };
  } catch (e) {
    if (e instanceof TistoryError) return { ok: false, errorCode: e.code, message: e.message };
    return { ok: false, errorCode: 'UNKNOWN', message: (e as Error).message };
  }
}

export function registerWritePost(server: McpServer, client: TistoryClient) {
  server.registerTool(
    'tistory_write_post',
    {
      description: DESCRIPTION,
      // 길이 검사는 핸들러에서 해서 INVALID_INPUT 형식으로 돌려준다
      inputSchema: {
        title: z.string().describe(`글 제목. 한 줄, 1~${TITLE_MAX}자`),
        content_markdown: z.string().describe(`마크다운 본문. 1~${CONTENT_MAX}자`),
      },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ title, content_markdown }) => {
      const result = await writePost(client, title, content_markdown);
      // 본문은 로그에 남기지 않는다
      console.log(`[tistory_write_post] ok=${result.ok} titleLen=${title.length} contentLen=${content_markdown.length}` +
        (result.ok ? ` draftId=${result.draftId}` : ` errorCode=${result.errorCode}`));
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
    },
  );
}
