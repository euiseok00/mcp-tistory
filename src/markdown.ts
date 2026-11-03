import { randomBytes } from 'node:crypto';
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
    'a', 'strong', 'em', 'del', 's', 'span', 'details', 'summary',
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
    a: { color: [/^#(000000|555555)$/], 'text-decoration': [/^none$/] },
    // 목차(renderToc)용 고정값만
    p: {
      'font-size': [/^(1\.3em|1\.1em|0\.95em)$/],
      'line-height': [/^(2\.6|1\.8)$/], 'padding-left': [/^2\.2em$/], 'letter-spacing': [/^0\.05em$/], color: [/^#222222$/],
      'border-bottom': [/^(1px solid #e5e7eb|2px solid #222222)$/],
    },
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
    // 헤더도 본문 셀처럼 왼쪽 정렬. 마크다운에서 정렬을 지정했으면 그대로 둔다 (feedback02 V3)
    .replace(/<th( align="\w+")?>/g, (_, align = '') =>
      `<th${align} style="${CELL};background:#f3f4f6;font-weight:700${align ? '' : ';text-align:left'}">`)
    .replace(/<td( align="\w+")?>/g, `<td$1 style="${CELL}">`)
    // 기본 불릿과 겹치는 목록 앞 이모지를 뺀다 (feedback02 V1)
    .replace(/<li>(\s*<p>)?<span style="font-size:1\.25em">[^<]*<\/span>\s*/g, '<li>$1')
    .replace(BOX_HEAD, (m, rest = '', emoji?: string) => {
      const [border, bg] = (emoji && BOX[emoji]) || BOX_DEFAULT;
      return `<blockquote data-ke-style="style3" style="border-left:4px solid ${border};background:${bg};` +
        `padding:12px 16px;margin:1em 0;text-align:left;font-style:normal;font-family:inherit;color:#222222">${rest}`;
    });
}

// 글 하나의 다이어그램 상한. 검사는 tool.ts writePost가 한다 (업로드 요청 수 제한)
export const DIAGRAM_MAX = 5;

// 따옴표로 감싼 속성만 있는 XML 태그
const XML_TAG = /<(\/?)([A-Za-z][\w:.-]*)(?:\s+[\w:.-]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*(\/?)>/g;

/** 브라우저는 XML 문법이 틀린 SVG 이미지를 그리지 못한다. 태그 짝이 맞고, 태그가 아닌 '<'가 없어야 한다 */
export function isWellFormedXml(svg: string): boolean {
  const stack: string[] = [];
  let balanced = true;
  const rest = svg.replace(/<!--[\s\S]*?-->/g, '').replace(XML_TAG, (_, close, name, self) => {
    if (close) balanced &&= stack.pop() === name;
    else if (!self) stack.push(name);
    return '';
  });
  return balanced && stack.length === 0 && !rest.includes('<');
}

/** 다이어그램으로 쓸 수 있는 SVG면 xmlns를 보장해 돌려준다. foreignObject는 canvas를 오염시켜 PNG 변환이 막힌다 */
export function diagramSvg(code: string): string | undefined {
  // XML에 없는 &nbsp;와 맨 &는 고쳐 준다 (A & B 같은 라벨이 흔하다)
  const svg = code.trim().replace(/^<\?xml[^>]*\?>\s*/, '').replace(/&nbsp;/g, '&#160;')
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
  if (!/^<svg[\s>][\s\S]*<\/svg>$/.test(svg) || /<foreignObject/i.test(svg) || !isWellFormedXml(svg)) return undefined;
  return /^<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

// <img>로만 쓰므로 SVG 안의 스크립트·외부 리소스는 실행·로드되지 않는다. 확장 프로그램이 PNG로 바꿔 업로드한다
const diagramImg = (svg: string) =>
  `<img data-mcp-svg src="data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}" alt="다이어그램">`;

type TocItem = { depth: 2 | 3; id: string; text: string };

// 글 첫머리 리드: 한 단계 큰 도입 글씨 (feedback04)
// 강조 박스와 헷갈리지 않게 blockquote·배경을 쓰지 않는다. "N개 주제 · 약 M분 읽기" 머리말은 빼기로 했다 (feedback05)
const LEAD_P = 'font-size:1.25em;line-height:1.8;color:#222222';

// 목차 스타일. 값은 SANITIZE allowedStyles와 맞아야 살아남는다
// 티스토리 에디터가 p의 margin과 위아래 padding을 0으로 덮어써서 간격은 line-height로 준다 (실측 2026-11-03)
const TOC_RULE = '1px solid #e5e7eb';
// 목차 라벨은 본문 대주제 제목(h2)처럼 굵은 검은 밑줄로 눈에 띄게 한다 (feedback04)
const TOC_HEAD = 'font-size:1.3em;letter-spacing:0.05em;color:#222222;border-bottom:2px solid #222222;line-height:2.6';
const TOC_MAJOR = 'font-size:1.1em;line-height:2.6';
const TOC_MINOR = 'font-size:0.95em;line-height:1.8;padding-left:2.2em';
const TOC_END = `border-bottom:${TOC_RULE}`;
const TOC_LINK = 'color:#000000;text-decoration:none';
const TOC_LINK_MINOR = 'color:#555555;text-decoration:none';

// h2(대주제)·h3(소주제)로 목차를 만든다. 이모지 없이 위아래 구분선, 파란 두 자리 번호, 굵은 대주제, 회색 들여쓴 소주제
// 접지 않고 펼쳐 둔다 (feedback03)
function renderToc(items: TocItem[]): string {
  const lines = items.map(({ depth, id, text }) => {
    if (depth === 3) return `<p style="${TOC_MINOR}"><a href="#${id}" style="${TOC_LINK_MINOR}">${text}</a></p>`;
    const m = /^(\d+)\.\s*(.*)$/.exec(text);
    const label = m
      ? `<span style="color:${COLOR_IMPORTANT}"><strong>${m[1].padStart(2, '0')}</strong></span>&nbsp;&nbsp;<strong>${m[2]}</strong>`
      : `<strong>${text}</strong>`;
    return `<p style="${TOC_MAJOR}"><a href="#${id}" style="${TOC_LINK}">${label}</a></p>`;
  });
  return `<p style="${TOC_HEAD}"><strong>목차</strong></p>\n${lines.join('\n')}\n<p style="${TOC_END}"><br></p>\n<p><br></p>\n`;
}

export function markdownToTistoryHtml(markdown: string): string {
  const toc: TocItem[] = [];
  // 다이어그램은 sanitize 뒤에 넣는다. 자리표시 문단은 호출마다 다른 값이라 본문 텍스트와 겹치지 않는다
  const diagrams: string[] = [];
  const nonce = randomBytes(8).toString('hex');
  const md = new Marked({
    gfm: true,
    renderer: {
      code({ text, lang }) {
        const svg = lang === 'svg' ? diagramSvg(text) : undefined;
        if (!svg) return false; // 기본 코드블록 렌더링
        diagrams.push(svg);
        return `<p>mcp-diagram-${nonce}-${diagrams.length - 1}</p>\n`;
      },
      heading({ tokens, depth }) {
        // 제목 이모지는 AI가 쓴 티가 나서 지운다 (feedback03)
        const inner = this.parser.parseInline(tokens).replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
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
  // 도입은 리드로 꾸며 목차에 묻히지 않게 한다 (feedback04). 스타일은 sanitize 뒤에 고정 문자열로 넣는다
  const intro = at > 0 ? body.slice(0, at).trim() : '';
  const lead = intro ? `<p>mcp-lead-${nonce}-open</p>\n${intro}\n<p>mcp-lead-${nonce}-close</p>\n` : '';
  const html = at < 0 ? body : lead + renderToc(toc) + body.slice(at);
  return decorate(sanitizeHtml(html, SANITIZE))
    .replace(new RegExp(`<p>mcp-lead-${nonce}-open</p>\\n?([\\s\\S]*?)<p>mcp-lead-${nonce}-close</p>`), (_, inner: string) =>
      `${inner.replace(/<p>/g, `<p style="${LEAD_P}">`)}<p><br /></p>`)
    .replace(new RegExp(`<p>mcp-diagram-${nonce}-(\\d+)</p>`, 'g'), (_, i) => diagramImg(diagrams[Number(i)]));
}
