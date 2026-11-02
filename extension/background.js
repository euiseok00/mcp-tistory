import { BLOG_NAME, classifyDraft, parseBlogs } from './classify.js';

const TIMEOUT_MS = 15_000;

async function myBlogs() {
  const res = await fetch('https://www.tistory.com/legacy/member/blog/api/myBlogs', {
    credentials: 'include',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json, text/plain, */*' },
  });
  return parseBlogs(res.type, res.status, await res.text());
}

async function saveDraft(blog, { title, html }) {
  const res = await fetch(`https://${blog}.tistory.com/manage/drafts`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
    body: JSON.stringify({ title, content: html, tags: '', categoryId: 0, totalWritingTimeMs: 0 }),
  });
  return classifyDraft(res.type, res.status, await res.text());
}

async function save(serverOrigin, token, blog) {
  if (!BLOG_NAME.test(blog)) return { ok: false, errorCode: 'UNKNOWN' };
  const job = (action) => fetch(`${serverOrigin}/api/jobs/${encodeURIComponent(token)}/${action}`, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const claimed = await job('claim');
  if (claimed.status === 404) return { ok: false, errorCode: 'LINK_EXPIRED' };
  if (claimed.status === 409) return { ok: false, errorCode: 'IN_PROGRESS' };
  if (!claimed.ok) return { ok: false, errorCode: 'UNKNOWN' };

  let result;
  try {
    result = await saveDraft(blog, await claimed.json());
  } catch {
    result = { ok: false, errorCode: 'UNKNOWN' };
  }
  // 정리 호출이 실패해도 결과는 그대로 알린다. 작업은 lease와 TTL로 풀린다.
  await job(result.ok ? 'complete' : 'release').catch(() => {});
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 서버 주소는 content script의 manifest matches가 보장하므로 sender.origin만 쓴다
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.origin) return;
  const work = msg.kind === 'blogs' ? myBlogs()
    : msg.kind === 'save' ? save(sender.origin, msg.token, msg.blog)
    : Promise.resolve({ ok: false, errorCode: 'UNKNOWN' });
  work.then(sendResponse, () => sendResponse({ ok: false, errorCode: 'UNKNOWN' }));
  return true; // 비동기 응답
});
