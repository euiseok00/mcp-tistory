import { randomBytes } from 'node:crypto';
import { Router } from 'express';

export const JOB_TTL_MS = 30 * 60_000;
export const LEASE_MS = 60_000;
export const JOB_MAX = 500;

export interface Job {
  title: string;
  html: string;
  expiresAt: number;
  leaseUntil: number;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 저장 대기 글. 본문을 디스크에 남기지 않으려고 메모리에만 둔다. */
export class JobStore {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly now: () => number = Date.now) {}

  /** 전체 상한을 넘으면 undefined */
  create(title: string, html: string): { token: string; expiresAt: number } | undefined {
    for (const [token, job] of this.jobs) if (job.expiresAt <= this.now()) this.jobs.delete(token);
    if (this.jobs.size >= JOB_MAX) return undefined;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + JOB_TTL_MS;
    this.jobs.set(token, { title, html, expiresAt, leaseUntil: 0 });
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
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function previewPage(job: Pick<Job, 'title' | 'html'>): string {
  return page(job.title, `<div id="save-slot" role="status" aria-live="polite">임시저장하려면 Chrome 확장 프로그램을 설치하고 이 페이지를 새로고침하세요.</div>
<h1>${escapeHtml(job.title)}</h1>
<article>${job.html}</article>`);
}

/** 링크 페이지와 확장 프로그램용 API. 256비트 토큰 자체가 권한이다. */
export function jobRouter(store: JobStore): Router {
  const router = Router();

  // GET은 작업을 소비하지 않는다. 링크 미리보기 봇이 작업을 없애면 안 된다.
  router.get('/d/:token', (req, res) => {
    res.set({
      // 확장 프로그램의 content script는 이 CSP의 영향을 받지 않는다
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    });
    const job = store.get(req.params.token);
    if (job) return res.type('html').send(previewPage(job));
    res.status(404).type('html').send(page('링크 만료', '<p role="alert">링크가 만료되었거나 이미 저장되었습니다. Claude에서 다시 요청하세요.</p>'));
  });

  router.post('/api/jobs/:token/claim', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const job = store.claim(req.params.token);
    if (!job) return res.status(404).json({ errorCode: 'LINK_EXPIRED' });
    if (job === 'busy') return res.status(409).json({ errorCode: 'IN_PROGRESS' });
    res.json({ title: job.title, html: job.html });
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
