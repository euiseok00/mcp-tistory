import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { COLOR_IMPORTANT, COLOR_WARNING, DIAGRAM_MAX, markdownToTistoryHtml } from './markdown.js';
import type { JobStore } from './jobs.js';

export const TITLE_MAX = 50;
export const CONTENT_MAX = 50_000;

const DESCRIPTION = `현재 대화(또는 사용자가 지정한 구간)를 정리해 티스토리 임시저장용 일회용 링크를 만든다. 발행하지 않는다.
이 도구만으로는 저장되지 않는다. 사용자가 링크를 열어 미리보기를 확인하고 임시저장 버튼을 눌러야 저장된다. 호출 후 반환된 url을 클릭 가능한 링크로 안내하고, 저장 완료라고 말하지 않는다. 링크는 expiresAt까지 유효하다.

작성 지침:
- 대화에 없는 내용을 추가하지 않는다.
- 본문은 마크다운으로 작성한다. 제목, 목록, 표, 언어를 지정한 코드블록, 인용, 링크, 굵게/기울임을 쓸 수 있다. 이미지 URL과 mermaid는 지원하지 않는다. 그림은 아래 SVG 다이어그램으로만 넣는다.
- 제목은 한 줄(${TITLE_MAX}자 이내)로 쓰고, 다루는 대주제 전체 범위와 본문 형식을 반영한다. 본문이 개념 정리면 "~ 개념 정리"처럼 쓰고, 질문·답 형식이 아니면 "질문 정리"라고 하지 않는다.
- 호출 후 어느 대화 범위를 사용했는지 사용자에게 한 줄로 알린다.
- 사용자가 다른 구조나 템플릿을 지정하면 그것을 따른다. 지정이 없으면 아래 기본 템플릿을 쓴다.

기본 템플릿:
- 구성 순서: 짧은 도입(1~2문장, 맨 처음에 쓴다. 서버가 큰 글씨로 강조한다. 무엇을 다루는지와 읽고 나면 무엇을 알게 되는지를 쓰고, 뒤 문장은 굵게. 도입에는 이모지·목록·표를 쓰지 않는다) → 본문 대주제들 → "## N. 정리" → 대화에 출처 링크가 있으면 "## N+1. 출처". 목차는 서버가 ##/### 제목으로 만들어 도입 뒤에 넣는다. 본문에 목차를 직접 쓰지 않는다.
- 구조:
  - 대주제는 3~7개. 대주제 하나는 한 개념 묶음이다. 스레드·메모리·입출력처럼 서로 다른 영역을 한 대주제에 섞지 않는다. 묶을 수 없을 만큼 많으면 글을 나누자고 사용자에게 제안한다.
  - 제목 단계는 두 가지만: 대주제 "## 1. 주제", 소주제 "### 1.1 세부". "1.1.1" 같은 3단계 번호, #, #### 이하는 쓰지 않는다. 제목에는 이모지를 쓰지 않는다(서버가 지운다). 대주제 제목은 번호 뒤에 그 부분의 핵심 개념을 짧은 명사구로 써서 목차만 봐도 구분되게 한다. 글 제목을 본문에 반복하지 않는다.
  - 소주제는 없거나 2개 이상. 하나뿐이면 대주제 본문에 합친다.
  - 소주제에는 그 대주제에 속하는 내용만 둔다. 주제가 바뀌면 새 대주제로 뺀다. 관련 내용(예: 같은 개념의 메서드)은 한곳에 모은다.
  - 같은 설명을 두 곳에 쓰지 않는다. 대주제 간 분량을 비슷하게 맞춘다.
- 가독성:
  - 텍스트만 길게 나열하지 않는다. 문단은 2문장 이내, 한 문장은 80자 안팎.
  - 모든 ##·### 제목 바로 다음에는 일반 문장 한 줄을 먼저 쓴다. 목록·표·코드블록·박스로 바로 시작하지 않는다.
  - 한 목록의 항목은 같은 종류·같은 층위여야 한다. 서로 다른 개념(예: join, 스레드 이름, run() 예외)은 소주제나 표의 행으로 나누고 각각 설명을 붙인다.
  - 비교·특징·장단점·단계·명령어 모음은 표로 정리한다. 대주제마다 표나 목록이 하나 이상 있게 한다. 표가 연달아 나오면 사이에 한 문장을 넣는다.
  - 나열은 글머리 목록, 순서가 있으면 번호 목록. 목록 항목 앞에 이모지(✔️ 🔹 등)를 붙이지 않는다. 불릿과 겹쳐서 서버가 지운다.
  - 코드·출력은 언어를 지정한 코드블록. 예제 코드는 입력(데이터·호출)과 실행 결과를 함께 보여준다. 결과는 주석이나 바로 뒤 \`\`\`text 블록으로. 간단한 흐름은 "A → B → C" 한 줄.
- 다이어그램: 핵심 흐름·구조·관계·비교처럼 그림이 글보다 이해가 쉬운 곳에 \`\`\`svg 코드블록으로 SVG를 직접 그린다. 사용자가 이미지를 첨부하지 않아도 저장할 때 PNG로 바뀌어 글에 첨부된다. 글당 최대 ${DIAGRAM_MAX}개이고 넘으면 INVALID_INPUT으로 거부된다. 다이어그램은 적극적으로 쓴다: 대주제마다 그림으로 보여줄 흐름·구조·관계·비교가 있는지 먼저 찾고, 있으면 그린다. 그림으로 보여줄 내용이 정말 없을 때만 생략한다. 흐름·트리·메모리 구조 같은 그림을 \`\`\`text 블록에 ASCII(┌ │ → 등)로 그리지 않는다. 그림은 SVG로만 그린다.
  - 루트 <svg>에 xmlns="http://www.w3.org/2000/svg", width·height(가로 800 이하), 같은 크기의 viewBox를 쓴다. 첫 요소로 흰 배경 rect를 깐다.
  - 글자는 font-family="sans-serif", 14px 이상. 상자·화살표·라벨로 단순하게, 글자가 상자 밖으로 넘치지 않게 크기를 잡는다. 색은 회색 계열과 강조색 ${COLOR_IMPORTANT}, ${COLOR_WARNING}만.
  - 올바른 XML로 쓴다: 모든 태그를 닫고, 속성값은 따옴표로 감싼다. 글자 안의 < >는 &lt; &gt;로 쓴다(예: List&lt;String&gt;). 틀리면 브라우저가 이미지로 그리지 못한다.
  - foreignObject, 외부 이미지·글꼴, 스크립트는 쓰지 않는다. 규칙을 어긴 SVG가 있으면 INVALID_INPUT으로 거부된다.
  - 다이어그램 바로 앞에 무엇을 보여주는지 한 문장을 쓴다.
  - 구분선(---)과 ". . ." 같은 점 구분은 쓰지 않는다.
- 강조 박스는 인용으로, 줄 맨 앞에 이모지와 굵은 라벨을 쓴다: "> 💡 <strong>참고</strong>: …". 서버가 첫 이모지에 따라 색 박스로 바꾼다. 종류: 💡 참고/팁, 📌 핵심 개념, ⚠️ 주의, ✅ 결론, 🔍 예시, 🤔 왜?, 🚀 실습. 대주제마다 최소 1개를 기준으로, 그 대주제에서 가장 짚어야 할 곳(핵심 개념, 흔한 실수 등)에 둔다. 소주제마다 기계적으로 넣지 않는다. 박스가 연달아 나오거나 한 화면에 여러 개면 가독성이 떨어지므로 정말 필요한 곳에만 추가한다.
- 핵심 용어와 결론은 굵게 쓴다. 굵게 부분이 따옴표·괄호로 끝나거나 바로 뒤에 한글 조사가 붙으면 ** 대신 <strong>…</strong>을 쓴다(마크다운이 인식하지 못함).
- 색상은 대화에서 사용자가 특히 중요하다고 한 부분에만 쓴다. 나머지 텍스트는 기본(검은색)으로 둔다. 허용되는 색은 두 가지뿐이다:
  - 중요: <span style="color:${COLOR_IMPORTANT}">내용</span>
  - 주의가 필요한 중요: <span style="color:${COLOR_WARNING}">내용</span>
- "정리"는 표로, 본문 대주제마다 한 행씩 빠짐없이 핵심을 요약한다. 복습 방법 같은 주제 밖 행은 넣지 않는다.`;

export type ErrorCode = 'INVALID_INPUT' | 'SERVER_BUSY' | 'UNKNOWN';

export type WritePostResult =
  | { ok: true; url: string; expiresAt: string; title: string }
  | { ok: false; errorCode: ErrorCode; message: string };

export function validateInput(title: string, content: string): string | undefined {
  const t = title.trim();
  if (t.length < 1 || t.length > TITLE_MAX) return `title은 1~${TITLE_MAX}자여야 합니다 (현재 ${t.length}자).`;
  if (/[\r\n]/.test(t)) return 'title은 한 줄이어야 합니다.';
  if (content.trim().length < 1 || content.length > CONTENT_MAX) {
    return `content_markdown은 1~${CONTENT_MAX}자여야 합니다 (현재 ${content.length}자).`;
  }
}

/** 변환된 HTML의 다이어그램 개수와 규칙 위반을 검사한다. 위반 SVG는 코드블록(language-svg)으로 남는다. */
export function validateDiagrams(html: string): string | undefined {
  const broken = html.match(/<code class="language-svg">/g)?.length ?? 0;
  if (broken) return `svg 코드블록 ${broken}개가 다이어그램 규칙에 맞지 않습니다. <svg>로 시작해 </svg>로 끝나는 하나의 올바른 XML이어야 합니다: 모든 태그를 닫고(<rect/> 또는 </text>), 속성값은 따옴표로 감싸고, 글자 안의 < >는 &lt; &gt;로 쓰고(예: List&lt;String&gt;), foreignObject는 쓰지 않습니다. 고쳐서 다시 호출하세요.`;
  const count = html.match(/<img data-mcp-svg /g)?.length ?? 0;
  if (count > DIAGRAM_MAX) {
    return `다이어그램(\`\`\`svg 코드블록)은 최대 ${DIAGRAM_MAX}개입니다 (현재 ${count}개). 덜 중요한 것을 빼고 다시 호출하세요.`;
  }
}

export function writePost(jobs: JobStore, publicUrl: URL, title: string, content: string): WritePostResult {
  const invalid = validateInput(title, content);
  if (invalid) return { ok: false, errorCode: 'INVALID_INPUT', message: invalid };
  const cleanTitle = title.trim();
  try {
    const html = markdownToTistoryHtml(content);
    const badDiagrams = validateDiagrams(html);
    if (badDiagrams) return { ok: false, errorCode: 'INVALID_INPUT', message: badDiagrams };
    const job = jobs.create(cleanTitle, html);
    if (!job) return { ok: false, errorCode: 'SERVER_BUSY', message: '대기 중인 글이 너무 많습니다. 잠시 후 다시 시도하세요.' };
    return { ok: true, url: new URL(`/d/${job.token}`, publicUrl).href, expiresAt: new Date(job.expiresAt).toISOString(), title: cleanTitle };
  } catch (e) {
    return { ok: false, errorCode: 'UNKNOWN', message: (e as Error).message };
  }
}

export function registerWritePost(server: McpServer, jobs: JobStore, publicUrl: URL) {
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
      const result = writePost(jobs, publicUrl, title, content_markdown);
      // 본문과 토큰이 든 url은 로그에 남기지 않는다
      console.log(`[tistory_write_post] ok=${result.ok} titleLen=${title.length} contentLen=${content_markdown.length}` +
        (result.ok ? '' : ` errorCode=${result.errorCode}`));
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
    },
  );
}
