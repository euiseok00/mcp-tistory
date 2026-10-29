import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// 티스토리 에디터 마크다운 모드 출력과 같은 구조만 허용 (userMD/2.티스토리API조사.md)
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'strong', 'em', 'del', 's',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    code: ['class'],
    th: ['align'],
    td: ['align'],
    ol: ['start'],
  },
  allowedClasses: { code: ['language-*'] },
  allowedSchemes: ['http', 'https', 'mailto'],
};

export function markdownToTistoryHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false, gfm: true });
  return sanitizeHtml(html, SANITIZE);
}
