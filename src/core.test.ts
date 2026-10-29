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
  assert.match(html, /<h2 id="section-1" style="[^"]*font-weight:700[^"]*">제목<\/h2>/);
  assert.match(html, /<table style="[^"]*">[\s\S]*<th style="[^"]*background:#f3f4f6[^"]*">A<\/th>/);
  assert.match(html, /<pre><code class="language-javascript">const a = 1;/);
  assert.match(html, /<blockquote data-ke-style="style3" style="border-left:4px solid #999999/);
  assert.match(html, /<a href="https:\/\/example.com">링크<\/a>/);
  assert.doesNotMatch(html, /<script|javascript:|<img|onerror/);
});

test('markdown: 목차 자동 생성, 색상은 두 가지만 허용', () => {
  const html = markdownToTistoryHtml(
    '## 1. 가\n\n### 1.1 나\n\n## 2. [다](https://x.com)\n\n' +
      '<span style="color:#006dd7">파랑</span> <span style="color:#ee2323">빨강</span> ' +
      '<span style="color:#00ff00;font-size:40px">초록</span>',
  );
  assert.match(html, /^<h2 style="[^"]*"><span style="font-size:1.25em">📑<\/span> 목차<\/h2>/);
  assert.match(html, /<p style="font-size:1.15em"><a href="#section-1" style="color:#000000;text-decoration:none"><strong>1. 가<\/strong><\/a><\/p>/);
  assert.match(html, /<p style="font-size:0.95em;padding-left:1.5em"><a href="#section-2" style="color:#000000;text-decoration:none">1.1 나<\/a><\/p>/);
  assert.match(html, /<a href="#section-3"[^>]*><strong>2. 다<\/strong>/);
  assert.match(html, /<h3 id="section-2" style="[^"]*">1.1 나<\/h3>/);
  assert.match(html, /<span style="color:#006dd7">파랑<\/span>/);
  assert.match(html, /<span style="color:#ee2323">빨강<\/span>/);
  assert.doesNotMatch(html, /00ff00|40px/);
  assert.equal(markdownToTistoryHtml('본문만').includes('목차'), false);
  // hr 제거, 이모지 확대(코드블록 안은 그대로)
  const more = markdownToTistoryHtml('가\n\n---\n\n⚠️ 주의\n\n```\n✅\n```');
  assert.doesNotMatch(more, /<hr/);
  assert.match(more, /<span style="font-size:1.25em">⚠️<\/span> 주의/);
  assert.match(more, /<code>✅/);
  // 목차는 도입 뒤에, 박스 색은 첫 이모지로
  const intro = markdownToTistoryHtml('도입 문장\n\n## 1. 가\n\n> ⚠️ 주의\n\n> 💡 팁');
  assert.ok(intro.startsWith('<p>도입 문장</p>'));
  assert.ok(intro.indexOf('목차') < intro.indexOf('id="section-1"'));
  assert.match(intro, /<blockquote [^>]*border-left:4px solid #ee2323;background:#fdecec[^>]*>\s*<p><span style="font-size:1.25em">⚠️/);
  assert.match(intro, /border-left:4px solid #f5b400/);
  // marked가 놓친 굵게 보정, 코드 안은 그대로
  const bold = markdownToTistoryHtml('핵심은 **"방법"**라는 점\n\n`**a**`');
  assert.match(bold, /핵심은 <strong>"방법"<\/strong>라는 점/);
  assert.match(bold, /<code>\*\*a\*\*<\/code>/);
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
