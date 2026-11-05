import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAM_MAX, diagramSvg, isWellFormedXml, markdownToTistoryHtml } from './markdown.js';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { writePost } from './tool.js';
import { JOB_MAX, JOB_TTL_MS, JobStore, LEASE_MS, PAGE_REQUESTS_PER_MIN, TOOL_CALLS_PER_MIN, disableExternalLinks, isClaudeIp, jobRouter, previewPage, toolCallGuard } from './jobs.js';
import { DIAGRAM_IMG, classifyDraft, classifyUpload, imagePlaceholder, parseBlogs } from '../extension/classify.js';

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
  // 목차: 접지 않음, 위아래 구분선, 파란 두 자리 번호, 회색 소주제
  assert.match(html, /^<p style="font-size:1.3em;letter-spacing:0.05em;color:#222222;border-bottom:2px solid #222222;line-height:2.6"><strong>목차<\/strong><\/p>\n/);
  assert.doesNotMatch(html, /<details>|펼치기/);
  assert.match(html, /<p style="border-bottom:1px solid #e5e7eb"><br \/><\/p>\n<p><br \/><\/p>\n<h2 id="section-1"/);
  assert.match(html, /<p style="font-size:1.1em;line-height:2.6"><a href="#section-1" style="color:#000000;text-decoration:none"><span style="color:#006dd7"><strong>01<\/strong><\/span>  <strong>가<\/strong><\/a><\/p>/);
  assert.match(html, /<p style="font-size:0.95em;line-height:1.8;padding-left:2.2em"><a href="#section-2" style="color:#555555;text-decoration:none">1.1 나<\/a><\/p>/);
  assert.match(html, /<a href="#section-3"[^>]*><span style="color:#006dd7"><strong>02<\/strong><\/span>  <strong>다<\/strong>/);
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
  // 도입은 박스·머리말 없이 큰 글씨만
  assert.match(intro, /^<p style="font-size:1.25em;line-height:1.8;color:#222222">도입 문장<\/p>\n?<p><br \/><\/p>/);
  assert.doesNotMatch(intro, /mcp-lead-|^<blockquote|분 읽기/);
  assert.ok(intro.indexOf('목차') < intro.indexOf('id="section-1"'));
  assert.match(intro, /<blockquote [^>]*border-left:4px solid #ee2323;background:#fdecec[^>]*>\s*<p><span style="font-size:1.25em">⚠️/);
  assert.match(intro, /border-left:4px solid #f5b400/);
  // marked가 놓친 굵게 보정, 코드 안은 그대로
  const bold = markdownToTistoryHtml('핵심은 **"방법"**라는 점\n\n`**a**`');
  assert.match(bold, /핵심은 <strong>"방법"<\/strong>라는 점/);
  assert.match(bold, /<code>\*\*a\*\*<\/code>/);
});

test('writePost: 입력 검증, 링크 생성, 상한', () => {
  const base = new URL('https://mcp.example');
  const jobs = new JobStore();
  const tags = ['자바', 'JVM'];
  const errorCode = (title: string, content: string, store = jobs, t = tags) => (writePost(store, base, title, content, t) as { errorCode: string }).errorCode;
  const svg = '```svg\n<svg width="10" height="10"></svg>\n```';
  const body = `본문\n\n${svg}`;

  const ok = writePost(jobs, base, ' 제목 ', body, [' 자바 ', '#JVM', '자바']);
  assert.ok(ok.ok);
  assert.equal(ok.title, '제목');
  assert.deepEqual(ok.tags, ['자바', 'JVM']);
  const token = /^https:\/\/mcp\.example\/d\/([\w-]{43})$/.exec(ok.url)![1];
  assert.match(jobs.get(token)!.html, /본문/);

  assert.equal(errorCode('', body), 'INVALID_INPUT');
  assert.equal(errorCode('a'.repeat(51), body), 'INVALID_INPUT');
  assert.equal(errorCode('두\n줄', body), 'INVALID_INPUT');
  assert.equal(errorCode('제목', '  '), 'INVALID_INPUT');
  assert.equal(errorCode('제목', body, jobs, []), 'INVALID_INPUT');
  assert.equal(errorCode('제목', body, jobs, ['a', 'b', 'c', 'd', 'e', 'f']), 'INVALID_INPUT');
  assert.equal(errorCode('제목', body, jobs, ['a,b']), 'INVALID_INPUT');
  assert.equal(errorCode('제목', body, jobs, ['  ']), 'INVALID_INPUT');
  // 다이어그램 0~5개, 규칙 위반 SVG 거부
  assert.ok(writePost(jobs, base, '제목', '본문', tags).ok);
  assert.ok(writePost(jobs, base, '제목', Array(5).fill(svg).join('\n\n'), tags).ok);
  assert.equal(errorCode('제목', Array(6).fill(svg).join('\n\n')), 'INVALID_INPUT');
  assert.equal(errorCode('제목', body + '\n\n```svg\n<svg><foreignObject/></svg>\n```'), 'INVALID_INPUT');

  const full = new JobStore();
  for (let i = 0; i < JOB_MAX; i++) full.create('t', 'h');
  assert.equal(errorCode('제목', body, full), 'SERVER_BUSY');
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
  const { token } = store.create('<script>x</script>', '<p>본문</p>', ['태그'])!;
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

    assert.deepEqual(await (await post('claim')).json(), { title: '<script>x</script>', html: '<p>본문</p>', tags: ['태그'] });
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

test('미리보기: 외부 링크 비활성화, 사용자 생성 콘텐츠 안내', () => {
  const out = disableExternalLinks('<h2 id="section-1" style="color:red">제</h2><a href="#section-1" style="x">목차</a> <a href="https://evil.example/login">클릭</a> <a href="//evil.example">상대</a>');
  assert.doesNotMatch(out, /evil\.example/);
  assert.match(out, /<a href="#section-1">목차<\/a>/);
  assert.match(out, /<span>클릭<\/span>/);
  assert.match(out, /<h2 id="section-1" style="color:red">/); // 서식은 유지
  const html = previewPage({ title: 't', html: '<a href="https://evil.example">x</a>' });
  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /사용자 생성 콘텐츠/);

  // 저장되는 글의 링크는 그대로
  const store = new JobStore();
  const { token } = store.create('t', '<a href="https://ok.example">x</a>')!;
  assert.match((store.claim(token) as { html: string }).html, /https:\/\/ok\.example/);
});

test('요청 제한: tools/call만 제한, 배치 거부, 페이지 제한', async () => {
  const app = express();
  app.use(express.json());
  app.post('/mcp', toolCallGuard(), (_req, res) => void res.json({ ok: true }));
  app.use(jobRouter(new JobStore()));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const mcp = (body: unknown) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    assert.equal((await mcp([{ method: 'tools/call', id: 1 }])).status, 400);
    for (let i = 0; i < TOOL_CALLS_PER_MIN; i++) assert.equal((await mcp({ method: 'tools/call', id: i })).status, 200);
    const limited = await mcp({ method: 'tools/call', id: 99 });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json() as { id: number }).id, 99);
    assert.equal((await mcp({ method: 'initialize', id: 1 })).status, 200);

    for (let i = 0; i < PAGE_REQUESTS_PER_MIN; i++) assert.equal((await fetch(`${base}/d/none`)).status, 404);
    assert.equal((await fetch(`${base}/d/none`)).status, 429);
  } finally {
    server.close();
  }
});

test('isClaudeIp: Anthropic 아웃바운드 대역만', () => {
  assert.ok(isClaudeIp('160.79.106.129'));
  assert.ok(isClaudeIp('::ffff:153.61.223.255'));
  assert.ok(!isClaudeIp('160.79.112.0'));
  assert.ok(!isClaudeIp('127.0.0.1'));
  assert.ok(!isClaudeIp('2607:6bc0::1'));
  assert.ok(!isClaudeIp(undefined));
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

test('markdown: svg 코드블록은 다이어그램 이미지, 규칙 위반은 코드블록', () => {
  const svg = '<svg width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#fff"/><text x="10" y="50">흐름</text></svg>';
  const html = markdownToTistoryHtml(`도입\n\n\`\`\`svg\n${svg}\n\`\`\`\n\n끝`);
  const imgs = html.match(DIAGRAM_IMG)!;
  assert.equal(imgs.length, 1);
  const b64 = imgs[0].match(/base64,([^"]+)"/)![1];
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  assert.match(decoded, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200"/);
  assert.match(decoded, /흐름/);
  assert.doesNotMatch(html, /mcp-diagram-/);

  // foreignObject, svg가 아닌 내용은 그대로 코드블록
  assert.equal(diagramSvg('<svg><foreignObject/></svg>'), undefined);
  assert.equal(diagramSvg('<script>x</script>'), undefined);
  const bad = markdownToTistoryHtml('```svg\n<svg><foreignObject><div>x</div></foreignObject></svg>\n```');
  assert.equal(bad.match(DIAGRAM_IMG), null);
  assert.match(bad, /<pre><code class="language-svg">/);

  // 본문 텍스트가 자리표시와 같아도 이미지가 되지 않는다
  assert.equal(markdownToTistoryHtml('mcp-diagram-0-0').match(DIAGRAM_IMG), null);

  const many = markdownToTistoryHtml(Array(DIAGRAM_MAX + 2).fill('```svg\n<svg></svg>\n```').join('\n\n'));
  assert.equal(many.match(DIAGRAM_IMG)!.length, DIAGRAM_MAX + 2); // 개수 검사는 writePost
});

test('extension classify: 업로드 응답 분류와 치환자', () => {
  const ok = '{"name":"d.png","url":"https://blog.kakaocdn.net/dna/a/b/c/img.png?x=1","key":"Bwn46/dJMca/AAAA_b-c","filename":"img.png","size":4330}';
  assert.deepEqual(classifyUpload('basic', 200, ok), { ok: true, key: 'Bwn46/dJMca/AAAA_b-c', filename: 'img.png' });
  const code = (type: string, status: number, body: string) => (classifyUpload(type, status, body) as { errorCode: string }).errorCode;
  assert.equal(code('opaqueredirect', 0, ''), 'SESSION_EXPIRED');
  assert.equal(code('basic', 200, '<html>'), 'SESSION_EXPIRED');
  assert.equal(code('basic', 413, '{}'), 'TISTORY_REJECTED');
  assert.equal(code('basic', 500, '{}'), 'UNKNOWN');
  // 치환자 구분자가 섞인 key는 거부
  assert.equal(code('basic', 200, '{"key":"a|b_##]","filename":"img.png"}'), 'TISTORY_REJECTED');
  assert.equal(code('basic', 200, '{"key":"a/b","filename":"x|y"}'), 'TISTORY_REJECTED');

  assert.equal(imagePlaceholder({ key: 'a/b', filename: 'img.png' }, 300, 120, 'diagram-1.png'),
    '<p>[##_Image|kage@a/b/img.png|CDM|1.3|{"originWidth":300,"originHeight":120,"style":"alignCenter","filename":"diagram-1.png"}_##]</p>');
});

test('markdown: 제목 이모지는 본문과 목차에서 지운다', () => {
  const html = markdownToTistoryHtml('## 1. 🧩 스레드 기초\n\n본문 💡\n\n### 1.1 🔹 생성');
  assert.match(html, /<strong>01<\/strong><\/span>  <strong>스레드 기초<\/strong>/);
  assert.match(html, /<h2 id="section-1"[^>]*>1\. 스레드 기초<\/h2>/);
  assert.match(html, /<h3 id="section-2"[^>]*>1\.1 생성<\/h3>/);
  assert.match(html, /본문 <span style="font-size:1.25em">💡<\/span>/); // 본문 이모지는 그대로
});

test('다이어그램: 브라우저가 못 그리는 XML 거부, 흔한 & 오류는 고침', () => {
  assert.equal(isWellFormedXml('<svg><rect x="1"/><g><text>a &lt; b</text></g><!-- <x --></svg>'), true);
  assert.equal(isWellFormedXml('<svg><text>List<String></text></svg>'), false);
  assert.equal(isWellFormedXml('<svg><text>a < b</text></svg>'), false);
  assert.equal(isWellFormedXml('<svg><g><rect></svg>'), false);
  assert.equal(isWellFormedXml('<svg><rect x=1/></svg>'), false); // 따옴표 없는 속성
  assert.match(diagramSvg('<svg><text>A & B&nbsp;&amp;</text></svg>')!, /A &amp; B&#160;&amp;</);
  assert.match(diagramSvg('<?xml version="1.0"?>\n<svg></svg>')!, /^<svg xmlns=/);
  assert.equal(diagramSvg('<svg><text>Map<K,V></text></svg>'), undefined);
});

test('미리보기: 다이어그램 data URL 유지', () => {
  const html = markdownToTistoryHtml('```svg\n<svg width="10" height="10"></svg>\n```');
  const preview = previewPage({ title: 't', html });
  assert.match(preview, /<img data-mcp-svg src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/);
  assert.doesNotMatch(disableExternalLinks('<img src="https://evil.example/x.png">'), /evil\.example/);
});
