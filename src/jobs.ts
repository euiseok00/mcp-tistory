import { randomBytes } from 'node:crypto';
import { BlockList } from 'node:net';
import { Router, type RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import sanitizeHtml from 'sanitize-html';

export const JOB_TTL_MS = 30 * 60_000;
export const LEASE_MS = 60_000;
export const JOB_MAX = 500;
// 분당 10개면 IP 하나가 TTL 30분 동안 만들 수 있는 작업은 300개다. JOB_MAX를 혼자 채우지 못한다.
export const TOOL_CALLS_PER_MIN = 10;
export const PAGE_REQUESTS_PER_MIN = 60;
// Claude 커넥터 요청은 모든 사용자가 Anthropic 공용 IP에서 온다(2026-11-05 실측 160.79.106.129). IP별로 세면 전원이 10회를 나눠 쓴다.
// shortcut: Claude 사용자 전체가 이 한도 하나를 공유한다. 한 사람이 다 써 버릴 수 있으니, 사용자가 늘면 사용자 식별(인증)을 붙인다.
const CLAUDE_TOOL_CALLS_PER_MIN = 30;

// https://platform.claude.com/docs/en/api/ip-addresses 의 아웃바운드 대역. 바뀌면 공지된다
const claudeOutbound = new BlockList();
claudeOutbound.addSubnet('160.79.104.0', 21, 'ipv4');
claudeOutbound.addSubnet('153.61.208.0', 20, 'ipv4');
export const isClaudeIp = (ip = '') => {
  const v4 = ip.replace(/^::ffff:/, '');
  return /^\d+\.\d+\.\d+\.\d+$/.test(v4) && claudeOutbound.check(v4, 'ipv4');
};

export interface Job {
  title: string;
  html: string;
  tags: string[];
  expiresAt: number;
  leaseUntil: number;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 저장 대기 글. 본문을 디스크에 남기지 않으려고 메모리에만 둔다. */
export class JobStore {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 전체 상한을 넘으면 undefined */
  create(title: string, html: string, tags: string[] = []): { token: string; expiresAt: number } | undefined {
    for (const [token, job] of this.jobs) if (job.expiresAt <= this.now()) this.jobs.delete(token);
    if (this.jobs.size >= JOB_MAX) return undefined;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + JOB_TTL_MS;
    this.jobs.set(token, { title, html, tags, expiresAt, leaseUntil: 0 });
    return { token, expiresAt };
  }

  get(token: string): Job | undefined {
    const job = this.jobs.get(token);
    if (job && job.expiresAt <= this.now()) {
      this.jobs.delete(token);
      return undefined;
    }
    return job;
  }

  /** 다른 탭이 저장 중이면(lease 유효) 'busy'. 중복 저장을 막는다. */
  claim(token: string): Job | 'busy' | undefined {
    const job = this.get(token);
    if (!job) return undefined;
    if (job.leaseUntil > this.now()) return 'busy';
    job.leaseUntil = this.now() + LEASE_MS;
    return job;
  }

  complete(token: string): void {
    this.jobs.delete(token);
  }

  release(token: string): void {
    const job = this.jobs.get(token);
    if (job) job.leaseUntil = 0;
  }
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{max-width:760px;margin:2rem auto;padding:0 1rem;font-family:sans-serif;line-height:1.6}
#save-slot{position:sticky;top:0;padding:1rem;margin-bottom:1.5rem;background:#f3f4f6;border-radius:8px}
pre{overflow-x:auto;padding:1rem;background:#f8f8f8}
table{border-collapse:collapse}
img{max-width:100%;height:auto}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** 우리 도메인이 피싱에 쓰이지 않게 미리보기에서만 외부 링크를 끈다. 저장되는 글의 링크는 그대로다. */
export function disableExternalLinks(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: false,
    allowedAttributes: false,
    // 다이어그램 <img data-mcp-svg>의 data: URL을 지우면 PNG 변환이 실패한다. 이미지는 CSP img-src data:로만 로드된다
    allowedSchemesByTag: { img: ['data'] },
    transformTags: {
      a: (_tag, attribs) => {
        const href = attribs.href;
        return href?.startsWith('#') ? { tagName: 'a', attribs: { href } } : { tagName: 'span', attribs: {} as Record<string, string> };
      },
    },
  });
}

export function previewPage(job: Pick<Job, 'title' | 'html'> & { tags?: string[] }): string {
  return page(job.title, `<div id="save-slot" role="status" aria-live="polite">임시저장하려면 Chrome 확장 프로그램을 설치하고 이 페이지를 새로고침하세요.</div>
<p role="note">이 글은 Claude 대화에서 만들어진 사용자 생성 콘텐츠이며, 서비스 운영자가 작성하거나 검토하지 않았습니다. 이 페이지는 비밀번호나 결제 정보를 요구하지 않습니다. 미리보기에서는 외부 링크가 동작하지 않습니다.</p>
<p role="note" style="padding:.75rem 1rem;border-left:4px solid #006dd7;background:#eef5fc"><strong>개발자 메시지</strong><br>이 미리보기는 실제 티스토리 블로그와 일부 다르게 보일 수 있습니다. 임시저장한 뒤 티스토리에서 확인해 주세요.</p>
<h1>${escapeHtml(job.title)}</h1>
${job.tags?.length ? `<p>태그: ${job.tags.map((t) => `#${escapeHtml(t)}`).join(' ')}</p>
` : ''}<article>${disableExternalLinks(job.html)}</article>`);
}

/** POST /mcp 앞에 둔다. 작업을 만드는 tools/call만 제한한다. Claude 대역은 공용 한도 하나, 그 밖은 IP별. */
export function toolCallGuard(): RequestHandler[] {
  const reject = (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], status: number, message: string) =>
    res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: req.body?.id ?? null });
  return [
    // 배치 한 건으로 여러 작업을 만들면 횟수 제한을 우회하므로 막는다
    (req, res, next) => {
      if (Array.isArray(req.body) && req.body.some((m) => m?.method === 'tools/call')) {
        return void reject(req, res, 400, 'tools/call은 배치로 보낼 수 없습니다.');
      }
      next();
    },
    rateLimit({
      windowMs: 60_000,
      limit: (req) => (isClaudeIp(req.ip) ? CLAUDE_TOOL_CALLS_PER_MIN : TOOL_CALLS_PER_MIN),
      keyGenerator: (req) => (isClaudeIp(req.ip) ? 'claude' : ipKeyGenerator(req.ip ?? '')),
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.body?.method !== 'tools/call',
      handler: (req, res) => void reject(req, res, 429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'),
    }),
  ];
}

/** 링크 페이지와 확장 프로그램용 API. 256비트 토큰 자체가 권한이다. */
export function jobRouter(store: JobStore): Router {
  const router = Router();
  router.use(['/d', '/api/jobs'], rateLimit({ windowMs: 60_000, limit: PAGE_REQUESTS_PER_MIN, standardHeaders: true, legacyHeaders: false }));

  // GET은 작업을 소비하지 않는다. 링크 미리보기 봇이 작업을 없애면 안 된다.
  router.get('/d/:token', (req, res) => {
    res.set({
      // 확장 프로그램의 content script는 이 CSP의 영향을 받지 않는다
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    });
    const job = store.get(req.params.token);
    if (job) return res.type('html').send(previewPage(job));
    res.status(404).type('html').send(page('링크 만료', '<p role="alert">링크가 만료되었거나 이미 저장되었습니다. 채팅에서 다시 요청하세요.</p>'));
  });

  router.post('/api/jobs/:token/claim', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const job = store.claim(req.params.token);
    if (!job) return res.status(404).json({ errorCode: 'LINK_EXPIRED' });
    if (job === 'busy') return res.status(409).json({ errorCode: 'IN_PROGRESS' });
    res.json({ title: job.title, html: job.html, tags: job.tags });
  });

  router.post('/api/jobs/:token/complete', (req, res) => {
    store.complete(req.params.token);
    res.status(204).end();
  });

  router.post('/api/jobs/:token/release', (req, res) => {
    store.release(req.params.token);
    res.status(204).end();
  });

  return router;
}
