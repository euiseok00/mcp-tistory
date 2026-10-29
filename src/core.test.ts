import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToTistoryHtml } from './markdown.js';
import { parseDraftResponse, TistoryError, type TistoryClient } from './tistory.js';
import { writePost } from './tool.js';
import { OwnerAuthProvider, passphraseMatches } from './auth.js';

test('markdown: 티스토리 구조 유지, 위험 HTML 제거', () => {
  const html = markdownToTistoryHtml(
    '## 제목\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```javascript\nconst a = 1;\n```\n\n> 인용\n\n' +
      '[링크](https://example.com) [나쁜](javascript:alert(1)) <script>alert(1)</script><img src=x onerror=alert(1)>',
  );
  assert.match(html, /<h2>제목<\/h2>/);
  assert.match(html, /<table>[\s\S]*<th>A<\/th>/);
  assert.match(html, /<pre><code class="language-javascript">const a = 1;/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<a href="https:\/\/example.com">링크<\/a>/);
  assert.doesNotMatch(html, /<script|javascript:|<img|onerror/);
});

test('parseDraftResponse: 응답 분류', () => {
  assert.deepEqual(parseDraftResponse(200, '{"success":true,"total":3,"draft":{"sequence":13}}'), { draftId: 13 });
  const code = (status: number, body: string) => {
    try {
      parseDraftResponse(status, body);
    } catch (e) {
      return (e as TistoryError).code;
    }
  };
  assert.equal(code(302, ''), 'SESSION_EXPIRED');
  assert.equal(code(401, ''), 'SESSION_EXPIRED');
  assert.equal(code(200, '<html>login</html>'), 'SESSION_EXPIRED');
  assert.equal(code(400, '{"success":false}'), 'TISTORY_REJECTED');
  assert.equal(code(200, '{"success":false}'), 'TISTORY_REJECTED');
  assert.equal(code(500, 'oops'), 'UNKNOWN');
});

test('writePost: 입력 검증과 오류 변환', async () => {
  const ok: TistoryClient = { saveDraft: async () => ({ draftId: 7 }) };
  const expired: TistoryClient = { saveDraft: async () => { throw new TistoryError('SESSION_EXPIRED', 'x'); } };

  assert.deepEqual(await writePost(ok, ' 제목 ', '본문'), { ok: true, draftId: 7, title: '제목' });
  assert.equal((await writePost(ok, '', '본문') as { errorCode: string }).errorCode, 'INVALID_INPUT');
  assert.equal((await writePost(ok, 'a'.repeat(51), '본문') as { errorCode: string }).errorCode, 'INVALID_INPUT');
  assert.equal((await writePost(ok, '두\n줄', '본문') as { errorCode: string }).errorCode, 'INVALID_INPUT');
  assert.equal((await writePost(ok, '제목', '  ') as { errorCode: string }).errorCode, 'INVALID_INPUT');
  assert.equal((await writePost(expired, '제목', '본문') as { errorCode: string }).errorCode, 'SESSION_EXPIRED');
});

test('auth: 패스프레이즈 확인, 실패 잠금, 코드 1회 사용, 토큰 검증', async () => {
  assert.ok(passphraseMatches('correct horse battery', 'correct horse battery'));
  assert.ok(!passphraseMatches('wrong', 'correct horse battery'));

  const resource = new URL('https://example.trycloudflare.com/mcp');
  const p = new OwnerAuthProvider('correct horse battery', resource);
  const client = { client_id: 'c1', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };
  const startAuth = async () => {
    let html = '';
    await p.authorize(client, { codeChallenge: 'ch', redirectUri: client.redirect_uris[0], state: 's1' },
      { type: () => ({ send: (h: string) => { html = h; } }) } as never);
    return /name="request_id" value="([0-9a-f]+)"/.exec(html)![1];
  };

  const req = await startAuth();
  assert.ok('error' in p.consent(req, 'wrong'));
  const ok = p.consent(req, 'correct horse battery');
  assert.ok('redirect' in ok);
  const url = new URL(ok.redirect);
  assert.equal(url.searchParams.get('state'), 's1');
  const code = url.searchParams.get('code')!;

  assert.equal(await p.challengeForAuthorizationCode(client, code), 'ch');
  const tokens = await p.exchangeAuthorizationCode(client, code);
  await assert.rejects(p.exchangeAuthorizationCode(client, code)); // 재사용 불가
  assert.equal((await p.verifyAccessToken(tokens.access_token)).resource?.href, resource.href);
  await assert.rejects(p.verifyAccessToken('nope'));

  const refreshed = await p.exchangeRefreshToken(client, tokens.refresh_token!);
  assert.ok(refreshed.access_token);
  await assert.rejects(p.exchangeRefreshToken(client, tokens.refresh_token!)); // 회전됨

  // 5회 실패 시 정답도 잠김
  const req2 = await startAuth();
  for (let i = 0; i < 5; i++) p.consent(req2, 'wrong');
  assert.ok('error' in p.consent(req2, 'correct horse battery'));
});
