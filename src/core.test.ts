import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { markdownToTistoryHtml } from './markdown.js';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mergeSetCookies, parseDraftResponse, TistoryError } from './tistory.js';
import { writePost } from './tool.js';
import { JOB_MAX, JOB_TTL_MS, JobStore, LEASE_MS, jobRouter, previewPage } from './jobs.js';
import { classifyDraft, parseBlogs } from '../extension/classify.js';
import { OwnerAuthProvider, passphraseMatches } from './auth.js';

test('markdown: 티스토리 구조 유지, 위험 HTML 제거', () => {
  const html = markdownToTistoryHtml(
    '## 제목\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```javascript\nconst a = 1;\n```\n\n> 인용\n\n' +
      '[링크](https://example.com) [나쁜](javascript:alert(1)) <script>alert(1)</script><img src=x onerror=alert(1)>',
  );
  assert.match(html, /<h2 id="section-1" style="[^"]*font-weight:700[^"]*">제목<\/h2>/);
  assert.match(html, /<table style="[^"]*">[\s\S]*<th style="[^"]*background:#f3f4f6[^"]*;text-align:left">A<\/th>/);
  // 목록 앞 이모지는 불릿과 겹쳐서 뺀다, 정렬 지정한 헤더는 그대로
  const list = markdownToTistoryHtml('- ✔️ 가\n- 🔹 나 ✅\n\n| A |\n|:-:|\n| 1 |');
  assert.match(list, /<li>가<\/li>\n<li>나 <span style="font-size:1.25em">✅<\/span><\/li>/);
  assert.match(list, /<th align="center" style="[^"]*font-weight:700">A/);
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
  assert.match(html, /^<details>\n<summary><strong><span style="font-size:1.25em">📑<\/span> 목차 \(3\)<\/strong> 펼치기<\/summary>/);
  assert.match(html, /<\/details>\n<p><br \/><\/p>\n<h2 id="section-1"/);
  assert.match(html, /<p style="font-size:1.15em;margin:0.9em 0 0.3em"><a href="#section-1" style="color:#000000;text-decoration:none"><strong>1. 가<\/strong><\/a><\/p>/);
  assert.match(html, /<p style="font-size:0.95em;padding-left:1.5em;margin:0.3em 0"><a href="#section-2" style="color:#000000;text-decoration:none">1.1 나<\/a><\/p>/);
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

test('writePost: 입력 검증, 링크 생성, 상한', () => {
  const base = new URL('https://mcp.example');
  const jobs = new JobStore();
  const errorCode = (title: string, content: string, store = jobs) => (writePost(store, base, title, content) as { errorCode: string }).errorCode;

  const ok = writePost(jobs, base, ' 제목 ', '본문');
  assert.ok(ok.ok);
  assert.equal(ok.title, '제목');
  const token = /^https:\/\/mcp\.example\/d\/([\w-]{43})$/.exec(ok.url)![1];
  assert.match(jobs.get(token)!.html, /본문/);

  assert.equal(errorCode('', '본문'), 'INVALID_INPUT');
  assert.equal(errorCode('a'.repeat(51), '본문'), 'INVALID_INPUT');
  assert.equal(errorCode('두\n줄', '본문'), 'INVALID_INPUT');
  assert.equal(errorCode('제목', '  '), 'INVALID_INPUT');

  const full = new JobStore();
  for (let i = 0; i < JOB_MAX; i++) full.create('t', 'h');
  assert.equal(errorCode('제목', '본문', full), 'SERVER_BUSY');
});

test('JobStore: TTL, lease, 재시도, 완료', () => {
  let now = 1000;
  const store = new JobStore(() => now);
  const { token } = store.create('t', 'h')!;

  assert.equal((store.claim(token) as { title: string }).title, 't');
  assert.equal(store.claim(token), 'busy'); // 중복 저장 방지
  store.release(token);
  assert.notEqual(store.claim(token), 'busy'); // 실패 후 재시도
  now += LEASE_MS;
  assert.notEqual(store.claim(token), 'busy'); // 저장 중 죽어도 lease가 풀림
  store.complete(token);
  assert.equal(store.claim(token), undefined);

  const expiring = store.create('t', 'h')!.token;
  now += JOB_TTL_MS;
  assert.equal(store.get(expiring), undefined);
  // 만료 작업은 상한을 차지하지 않는다
  const full = new JobStore(() => now);
  for (let i = 0; i < JOB_MAX; i++) full.create('t', 'h');
  now += JOB_TTL_MS;
  assert.ok(full.create('t', 'h'));
});

test('jobRouter: 조회는 소비하지 않고, 제목을 이스케이프한다', async () => {
  const store = new JobStore();
  const { token } = store.create('<script>x</script>', '<p>본문</p>')!;
  const server = express().use(jobRouter(store)).listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (action: string) => fetch(`${base}/api/jobs/${token}/${action}`, { method: 'POST' });

    const view = await fetch(`${base}/d/${token}`);
    assert.equal(view.status, 200);
    assert.match(view.headers.get('content-security-policy')!, /default-src 'none'/);
    assert.equal(view.headers.get('referrer-policy'), 'no-referrer');
    const html = await view.text();
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /id="save-slot"/);

    assert.deepEqual(await (await post('claim')).json(), { title: '<script>x</script>', html: '<p>본문</p>' });
    assert.equal((await post('claim')).status, 409);
    assert.equal((await post('release')).status, 204);
    assert.equal((await post('claim')).status, 200);
    assert.equal((await post('complete')).status, 204);
    assert.equal((await post('claim')).status, 404);
    assert.equal((await fetch(`${base}/d/${token}`)).status, 404);
  } finally {
    server.close();
  }
  assert.match(previewPage({ title: '"a"', html: '' }), /&quot;a&quot;/);
});

test('extension classify: 실측 응답 분류', () => {
  assert.deepEqual(classifyDraft('basic', 200, '{"success":true,"total":6,"draft":{"sequence":28}}'), { ok: true, draftId: 28 });
  const code = (type: string, status: number, body: string) => (classifyDraft(type, status, body) as { errorCode: string }).errorCode;
  assert.equal(code('opaqueredirect', 0, ''), 'SESSION_EXPIRED');
  assert.equal(code('basic', 401, ''), 'SESSION_EXPIRED');
  assert.equal(code('basic', 200, '<html>login</html>'), 'SESSION_EXPIRED');
  assert.equal(code('basic', 400, '{"success":false}'), 'TISTORY_REJECTED');
  assert.equal(code('basic', 200, '{"success":false}'), 'TISTORY_REJECTED');
  assert.equal(code('basic', 500, 'oops'), 'UNKNOWN');

  const blogs = '{"status":200,"desc":"OK","data":[{"name":"a-1","title":"A","defaultBlog":false},{"name":"b","title":"B","defaultBlog":true},{"name":"x.evil.com/","title":"C","defaultBlog":false}]}';
  assert.deepEqual(parseBlogs('basic', 200, blogs), { ok: true, blogs: [{ name: 'a-1', title: 'A', defaultBlog: false }, { name: 'b', title: 'B', defaultBlog: true }] });
  assert.equal((parseBlogs('opaqueredirect', 0, '') as { errorCode: string }).errorCode, 'SESSION_EXPIRED');
  assert.equal((parseBlogs('basic', 200, '<html>') as { errorCode: string }).errorCode, 'SESSION_EXPIRED');
  assert.equal((parseBlogs('basic', 200, '{"status":500}') as { errorCode: string }).errorCode, 'UNKNOWN');
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

  // 상태 파일: 재시작해도 토큰 유지, 주소가 바뀌면 폐기
  const file = join(mkdtempSync(join(tmpdir(), 'oauth-')), 'state.json');
  const p1 = new OwnerAuthProvider('correct horse battery', resource, file);
  await p1.clientsStore.registerClient(client as never);
  const r1 = await p1.consent(await (async () => {
    let html = '';
    await p1.authorize(client, { codeChallenge: 'ch', redirectUri: client.redirect_uris[0] },
      { type: () => ({ send: (h: string) => { html = h; } }) } as never);
    return /name="request_id" value="([0-9a-f]+)"/.exec(html)![1];
  })(), 'correct horse battery') as { redirect: string };
  const t1 = await p1.exchangeAuthorizationCode(client, new URL(r1.redirect).searchParams.get('code')!);
  assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(t1.access_token));
  const p2 = new OwnerAuthProvider('correct horse battery', resource, file);
  assert.ok(p2.clientsStore.getClient('c1'));
  await p2.verifyAccessToken(t1.access_token);
  assert.ok((await p2.exchangeRefreshToken(client, t1.refresh_token!)).access_token);
  const p3 = new OwnerAuthProvider('correct horse battery', new URL('https://other.example/mcp'), file);
  await assert.rejects(p3.verifyAccessToken(t1.access_token));

  // 5회 실패 시 정답도 잠김
  const req2 = await startAuth();
  for (let i = 0; i < 5; i++) p.consent(req2, 'wrong');
  assert.ok('error' in p.consent(req2, 'correct horse battery'));
});

test('mergeSetCookies: 갱신·추가·삭제', () => {
  const merged = mergeSetCookies('a=1; b=2; c=3', ['a=9; Path=/', 'd=4; Max-Age=60', 'b=; Path=/', 'c=x; Max-Age=0']);
  assert.equal(merged, 'a=9; d=4');
});
