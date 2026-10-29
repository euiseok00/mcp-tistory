import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { markdownToTistoryHtml } from './markdown.js';
import { TistoryError, type ErrorCode, type TistoryClient } from './tistory.js';

export const TITLE_MAX = 50;
export const CONTENT_MAX = 50_000;

const DESCRIPTION = `현재 대화(또는 사용자가 지정한 구간)를 정리해 티스토리 블로그에 임시저장한다. 발행하지 않는다.

작성 지침:
- 대화에 없는 내용을 추가하지 않는다.
- 본문은 마크다운으로 작성한다. 제목, 목록, 표, 언어를 지정한 코드블록, 인용, 링크, 굵게/기울임을 쓸 수 있다. 이미지와 다이어그램은 지원하지 않는다.
- 제목은 한 줄(${TITLE_MAX}자 이내)로 쓴다.
- 호출 후 어느 대화 범위를 사용했는지 사용자에게 한 줄로 알린다.`;

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
