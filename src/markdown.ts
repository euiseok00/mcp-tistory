import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// 강조 색상: 중요 = 파랑, 주의 = 빨강 (티스토리 에디터 기본 팔레트 값)
export const COLOR_IMPORTANT = '#006dd7';
export const COLOR_WARNING = '#ee2323';

// 티스토리 에디터 마크다운 모드 출력과 같은 구조만 허용 (userMD/2.티스토리API조사.md)
// + 목차 앵커용 h2/h3 id, 강조용 span color(두 색만), 목차 스타일
// hr은 블로그 스킨에서 ". . ."으로 보여 뺀다. 섹션은 제목과 표로 나눈다
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'strong', 'em', 'del', 's', 'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'style'],
    p: ['style'],
    code: ['class'],
    th: ['align'],
    td: ['align'],
    ol: ['start'],
    h2: ['id'],
    h3: ['id'],
    span: ['style'],
  },
  allowedClasses: { code: ['language-*'] },
  allowedStyles: {
    span: { color: [new RegExp(`^(${COLOR_IMPORTANT}|${COLOR_WARNING})$`, 'i')] },
    a: { color: [/^#000000$/], 'text-decoration': [/^none$/] },
    p: { 'font-size': [/^(1\.15em|0\.95em)$/], 'padding-left': [/^1\.5em$/] },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // 이모지를 살짝 키운다. textFilter 출력은 다시 검사되지 않으므로 고정 문자열만 넣는다
  textFilter: (text, tag) => (tag === 'code' || tag === 'pre' ? text : text.replace(EMOJI, EMOJI_SPAN)),
};

// marked가 놓친 굵게(닫는 ** 앞이 따옴표·괄호이고 뒤에 한글이 붙은 경우)를 직접 바꾼다. 코드는 건너뛴다
const LEFTOVER_BOLD = /(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)|\*\*(?=\S)([^<]+?)(?<=\S)\*\*/g;
const fixBold = (html: string) => html.replace(LEFTOVER_BOLD, (m, code, inner) => code ?? `<strong>${inner}</strong>`);

const EMOJI = /\p{Extended_Pictographic}️?(‍\p{Extended_Pictographic}️?)*/gu;
const EMOJI_SPAN = '<span style="font-size:1.25em">$&</span>';

// 스킨 기본 스타일이 약해서 제목·표·인용 박스에 인라인 스타일을 붙인다 (userMD/feedback01.md V1~V3)
const H_STYLE = {
  '2': 'font-size:1.6em;font-weight:700;border-bottom:2px solid #222222;padding-bottom:0.3em;margin-top:2em',
  '3': 'font-size:1.25em;font-weight:700;margin-top:1.5em',
};
const CELL = 'border:1px solid #d0d7de;padding:8px 10px';
// 박스 종류는 첫 이모지로 고른다: [테두리, 배경]
const BOX: Record<string, [string, string]> = {
  '💡': ['#f5b400', '#fff8e1'],
  '📌': [COLOR_IMPORTANT, '#e8f1fb'],
  '⚠️': [COLOR_WARNING, '#fdecec'],
  '✅': ['#2e9e5b', '#e9f7ef'],
};
const BOX_DEFAULT: [string, string] = ['#999999', '#f5f5f5'];
const BOX_HEAD = /<blockquote>(\s*<p>(?:<span style="font-size:1\.25em">)?(\p{Extended_Pictographic}️?))?/gu;

// sanitize 뒤에 고정 문자열만 붙이므로 사용자 입력이 스타일을 바꾸지 못한다
function decorate(html: string): string {
  return html
    .replace(/<h([23])( id="[^"]*")?>/g, (_, d: '2' | '3', id = '') => `<h${d}${id} style="${H_STYLE[d]}">`)
    .replace(/<table>/g, '<table style="border-collapse:collapse;width:100%;margin:1em 0 1.5em">')
    .replace(/<th( align="\w+")?>/g, `<th$1 style="${CELL};background:#f3f4f6;font-weight:700">`)
    .replace(/<td( align="\w+")?>/g, `<td$1 style="${CELL}">`)
    .replace(BOX_HEAD, (m, rest = '', emoji?: string) => {
      const [border, bg] = (emoji && BOX[emoji]) || BOX_DEFAULT;
      return `<blockquote data-ke-style="style3" style="border-left:4px solid ${border};background:${bg};` +
        `padding:12px 16px;margin:1em 0;text-align:left;font-style:normal;font-family:inherit;color:#222222">${rest}`;
    });
}

type TocItem = { depth: 2 | 3; id: string; text: string };

const TOC_LINK = 'color:#000000;text-decoration:none';

// h2(대주제)·h3(소주제)로 목차를 만든다. 검은색, 글자 크기와 들여쓰기로 단계 구분
function renderToc(items: TocItem[]): string {
  const lines = items.map(({ depth, id, text }) => depth === 2
    ? `<p style="font-size:1.15em"><a href="#${id}" style="${TOC_LINK}"><strong>${text}</strong></a></p>`
    : `<p style="font-size:0.95em;padding-left:1.5em"><a href="#${id}" style="${TOC_LINK}">${text}</a></p>`);
  return `<h2>📑 목차</h2>\n${lines.join('\n')}\n<p>👉 제목을 클릭하면 해당 부분으로 이동합니다.</p>\n<p><br></p>\n`;
}

export function markdownToTistoryHtml(markdown: string): string {
  const toc: TocItem[] = [];
  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (depth !== 2 && depth !== 3) return `<h${depth}>${inner}</h${depth}>\n`;
        const id = `section-${toc.length + 1}`;
        // 제목 안의 링크가 목차 링크와 겹치지 않게 태그를 뺀다
        toc.push({ depth, id, text: inner.replace(/<[^>]*>/g, '') });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
    },
  });
  const body = fixBold(md.parse(markdown, { async: false }));
  // 목차는 도입 문단 뒤, 첫 제목 앞에 넣는다. 미리보기가 도입 문장으로 시작하게 (S9, V11)
  const at = toc.length ? body.search(/<h[23] id="section-1"/) : -1;
  const html = at < 0 ? body : body.slice(0, at) + renderToc(toc) + body.slice(at);
  return decorate(sanitizeHtml(html, SANITIZE));
}
