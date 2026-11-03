import { BLOG_NAME, DIAGRAM_IMG, classifyDraft, classifyUpload, imagePlaceholder, parseBlogs } from './classify.js';

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

const PNG_DATA_URL = 'data:image/png;base64,';
const validSize = (n) => Number.isInteger(n) && n > 0 && n <= 10_000;

async function uploadImage(blog, dataUrl, name) {
  const form = new FormData();
  form.append('file', await (await fetch(dataUrl)).blob(), name);
  const res = await fetch(`https://${blog}.tistory.com/manage/post/attach.json`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json, text/plain, */*' },
    body: form,
  });
  return classifyUpload(res.type, res.status, await res.text());
}

/** 다이어그램을 순서대로 업로드해 서버가 만든 <img data-mcp-svg> 자리를 티스토리 치환자로 바꾼다. */
async function attachDiagrams(blog, html, diagrams) {
  const slots = html.match(DIAGRAM_IMG) ?? [];
  if (slots.length !== diagrams.length) return { ok: false, errorCode: 'UNKNOWN' };
  const parts = [];
  for (const [i, { dataUrl, width, height }] of diagrams.entries()) {
    const name = `diagram-${i + 1}.png`;
    const uploaded = await uploadImage(blog, dataUrl, name);
    if (!uploaded.ok) return uploaded;
    parts.push(imagePlaceholder(uploaded, width, height, name));
  }
  let i = 0;
  return { ok: true, html: html.replace(DIAGRAM_IMG, () => parts[i++]) };
}

async function save(serverOrigin, token, blog, diagrams) {
  if (!BLOG_NAME.test(blog)) return { ok: false, errorCode: 'UNKNOWN' };
  if (!Array.isArray(diagrams) || !diagrams.every((d) =>
    typeof d?.dataUrl === 'string' && d.dataUrl.startsWith(PNG_DATA_URL) && validSize(d.width) && validSize(d.height))) {
    return { ok: false, errorCode: 'UNKNOWN' };
  }
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
    const { title, html } = await claimed.json();
    const attached = await attachDiagrams(blog, html, diagrams);
    result = attached.ok ? await saveDraft(blog, { title, html: attached.html }) : attached;
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
    : msg.kind === 'save' ? save(sender.origin, msg.token, msg.blog, msg.diagrams)
    : Promise.resolve({ ok: false, errorCode: 'UNKNOWN' });
  work.then(sendResponse, () => sendResponse({ ok: false, errorCode: 'UNKNOWN' }));
  return true; // 비동기 응답
});
