import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { consentPage, OwnerAuthProvider } from './auth.js';
import { CookieTistoryClient, cookieSource } from './tistory.js';
import { registerWritePost } from './tool.js';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name}가 필요합니다.`);
  return v;
}

const PORT = Number(process.env.PORT ?? 3000);
// 외부에서 보이는 주소 (quick tunnel URL). 바뀌면 재시작 후 커넥터 재등록
if (process.env.PUBLIC_URL === '') throw new Error('PUBLIC_URL이 비어 있습니다. npm run up으로 실행하세요.');
const PUBLIC_URL = new URL(process.env.PUBLIC_URL ?? `http://localhost:${PORT}`);
const MCP_URL = new URL('/mcp', PUBLIC_URL);
const passphrase = required('OWNER_PASSPHRASE');
if (passphrase.length < 16) throw new Error('OWNER_PASSPHRASE는 16자 이상이어야 합니다.');

const tistory = new CookieTistoryClient(required('TISTORY_BLOG_NAME'), cookieSource(process.env));
const auth = new OwnerAuthProvider(passphrase, MCP_URL);

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: [...new Set([PUBLIC_URL.hostname, 'localhost', '127.0.0.1'])],
});
app.set('trust proxy', 1); // cloudflared 1단계 뒤에 있음. rate limit이 실제 IP를 보게 한다

app.use(mcpAuthRouter({ provider: auth, issuerUrl: PUBLIC_URL, resourceServerUrl: MCP_URL, resourceName: 'Tistory MCP' }));

app.post('/consent', express.urlencoded({ extended: false }), (req, res) => {
  const requestId = String(req.body?.request_id ?? '');
  const result = auth.consent(requestId, String(req.body?.passphrase ?? ''));
  if ('redirect' in result) return res.redirect(302, result.redirect);
  res.status(400).type('html').send(consentPage(requestId, undefined, result.error));
});

const bearer = requireBearerAuth({ verifier: auth, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(MCP_URL) });

// stateless + JSON 응답: quick tunnel이 SSE를 지원하지 않는다
app.post('/mcp', bearer, async (req, res) => {
  const server = new McpServer({ name: 'tistory-mcp', version: '1.0.0' });
  registerWritePost(server, tistory);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('MCP 요청 처리 실패:', (e as Error).message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

// stateless 모드는 GET(SSE 스트림)·DELETE(세션 종료)를 쓰지 않는다
app.all('/mcp', bearer, (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});

app.listen(PORT, () => console.log(`tistory-mcp listening on :${PORT}, MCP endpoint ${MCP_URL.href}`));
