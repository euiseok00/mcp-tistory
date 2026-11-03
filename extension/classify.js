// 응답 분류. 브라우저 API를 쓰지 않아 src/core.test.ts에서 바로 테스트한다.

export const BLOG_NAME = /^[a-z0-9-]+$/i;

/** POST /manage/drafts 응답 분류. redirect: 'manual'이면 로그인 redirect는 status 0의 opaqueredirect로 온다. */
export function classifyDraft(type, status, body) {
  if (type === 'opaqueredirect' || status === 401 || status === 403) return { ok: false, errorCode: 'SESSION_EXPIRED' };
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    // 200인데 JSON이 아니면 로그인 HTML 페이지일 가능성이 높다
    if (status === 200) return { ok: false, errorCode: 'SESSION_EXPIRED' };
  }
  if (status >= 400 && status < 500) return { ok: false, errorCode: 'TISTORY_REJECTED' };
  if (status !== 200) return { ok: false, errorCode: 'UNKNOWN' };
  if (json?.success !== true || typeof json.draft?.sequence !== 'number') return { ok: false, errorCode: 'TISTORY_REJECTED' };
  return { ok: true, draftId: json.draft.sequence };
}

/** GET /legacy/member/blog/api/myBlogs 응답 분류. 호스트에 쓸 수 없는 이름은 버린다. */
export function parseBlogs(type, status, body) {
  if (type === 'opaqueredirect' || status === 401 || status === 403) return { ok: false, errorCode: 'SESSION_EXPIRED' };
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, errorCode: status === 200 ? 'SESSION_EXPIRED' : 'UNKNOWN' };
  }
  if (status !== 200 || !Array.isArray(json?.data)) return { ok: false, errorCode: 'UNKNOWN' };
  const blogs = json.data
    .filter((b) => typeof b?.name === 'string' && BLOG_NAME.test(b.name))
    .map((b) => ({ name: b.name, title: String(b.title ?? b.name), defaultBlog: b.defaultBlog === true }));
  return { ok: true, blogs };
}

/** POST /manage/post/attach.json 응답 분류. key·filename은 치환자에 그대로 들어가므로 구분자(|, _##])가 없는지 확인한다. */
export function classifyUpload(type, status, body) {
  if (type === 'opaqueredirect' || status === 401 || status === 403) return { ok: false, errorCode: 'SESSION_EXPIRED' };
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    if (status === 200) return { ok: false, errorCode: 'SESSION_EXPIRED' };
  }
  if (status >= 400 && status < 500) return { ok: false, errorCode: 'TISTORY_REJECTED' };
  if (status !== 200) return { ok: false, errorCode: 'UNKNOWN' };
  if (typeof json?.key !== 'string' || !/^[\w-]+(\/[\w-]+)*$/.test(json.key) ||
      typeof json.filename !== 'string' || !/^[\w-]+\.\w+$/.test(json.filename)) {
    return { ok: false, errorCode: 'TISTORY_REJECTED' };
  }
  return { ok: true, key: json.key, filename: json.filename };
}

// 서버가 만든 다이어그램 자리. src/markdown.ts의 diagramImg와 형식이 같아야 한다
export const DIAGRAM_IMG = /<img data-mcp-svg [^>]*>/g;

/** 티스토리 에디터가 저장하는 이미지 치환자. 서명 쿼리는 티스토리가 열 때 붙인다 (실측 2026-11-03). */
export function imagePlaceholder({ key, filename }, width, height, name) {
  const meta = JSON.stringify({ originWidth: width, originHeight: height, style: 'alignCenter', filename: name });
  return `<p>[##_Image|kage@${key}/${filename}|CDM|1.3|${meta}_##]</p>`;
}
