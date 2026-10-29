import { readFile } from 'node:fs/promises';

export type ErrorCode = 'INVALID_INPUT' | 'SESSION_EXPIRED' | 'TISTORY_REJECTED' | 'UNKNOWN';

export class TistoryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** 티스토리 호출부. 내부 API가 바뀌거나 막히면 구현체만 교체한다. */
export interface TistoryClient {
  saveDraft(title: string, html: string): Promise<{ draftId: number }>;
}

/** 로그인 쿠키로 비공식 `POST /manage/drafts`를 호출한다. */
export class CookieTistoryClient implements TistoryClient {
  constructor(
    private readonly blogName: string,
    private readonly getCookie: () => Promise<string>,
  ) {}

  async saveDraft(title: string, html: string): Promise<{ draftId: number }> {
    const origin = `https://${this.blogName}.tistory.com`;
    let res: Response;
    try {
      res = await fetch(`${origin}/manage/drafts`, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Cookie: await this.getCookie(),
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
          // 브라우저 요청과 같게 맞춤. 서버 쪽 Origin/Referer 검사 여부는 미확인
          Origin: origin,
          Referer: `${origin}/manage/newpost/`,
        },
        body: JSON.stringify({ title, content: html, tags: '', categoryId: 0, totalWritingTimeMs: 0 }),
      });
    } catch (e) {
      throw new TistoryError('UNKNOWN', `티스토리 연결 실패: ${(e as Error).message}`);
    }
    return parseDraftResponse(res.status, await res.text());
  }
}

export function parseDraftResponse(status: number, body: string): { draftId: number } {
  // 로그인 페이지로 redirect 되거나 인증 오류면 세션 만료로 본다
  if ((status >= 300 && status < 400) || status === 401 || status === 403) {
    throw new TistoryError('SESSION_EXPIRED', '티스토리 로그인 세션이 만료되었습니다. 쿠키를 갱신하세요.');
  }
  let json: { success?: boolean; draft?: { sequence?: number } } | undefined;
  try {
    json = JSON.parse(body);
  } catch {
    // 200인데 JSON이 아니면 로그인 HTML 페이지일 가능성이 높다
    if (status === 200) throw new TistoryError('SESSION_EXPIRED', '티스토리가 로그인 페이지를 반환했습니다. 쿠키를 갱신하세요.');
  }
  if (status >= 400 && status < 500) throw new TistoryError('TISTORY_REJECTED', `티스토리가 요청을 거부했습니다 (HTTP ${status}).`);
  if (status !== 200) throw new TistoryError('UNKNOWN', `티스토리 응답 오류 (HTTP ${status}).`);
  if (json?.success !== true || typeof json.draft?.sequence !== 'number') {
    throw new TistoryError('TISTORY_REJECTED', '티스토리가 임시저장을 거부했습니다.');
  }
  return { draftId: json.draft.sequence };
}

/** 쿠키는 매 호출마다 읽는다. 파일만 바꾸면 재시작 없이 세션을 갱신할 수 있다. */
export function cookieSource(env: NodeJS.ProcessEnv): () => Promise<string> {
  const file = env.TISTORY_COOKIE_FILE;
  if (file) return async () => (await readFile(file, 'utf8')).trim();
  const cookie = env.TISTORY_COOKIE;
  if (!cookie) throw new Error('TISTORY_COOKIE_FILE 또는 TISTORY_COOKIE 환경변수가 필요합니다.');
  return async () => cookie;
}
