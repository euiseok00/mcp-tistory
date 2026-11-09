import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { JobStore, jobRouter, toolCallGuard } from './jobs.js';
import { registerWritePost } from './tool.js';
import { PRIVACY_HTML } from './privacy.js';

const PORT = Number(process.env.PORT ?? 3000);
// 외부에서 보이는 주소 (Railway 도메인). 링크와 allowedHosts에 쓴다
if (process.env.PUBLIC_URL === '') throw new Error('PUBLIC_URL이 비어 있습니다. 서비스 주소를 넣으세요.');
const PUBLIC_URL = new URL(process.env.PUBLIC_URL ?? `http://localhost:${PORT}`);
const MCP_URL = new URL('/mcp', PUBLIC_URL);

const jobs = new JobStore();

const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: [...new Set([PUBLIC_URL.hostname, 'localhost', '127.0.0.1'])],
});
// Railway: X-Forwarded-For = "클라이언트, 엣지" + 내부 홉. 위조 값은 Railway가 버린다 (2026-11-05 실측). 2홉을 믿어야 req.ip가 클라이언트다
app.set('trust proxy', 2);

app.use(jobRouter(jobs));

app.get('/privacy', (_req, res) => void res.type('html').send(PRIVACY_HTML));

// 인증 없음: 누구나 작업을 만들 수 있다. 남용은 toolCallGuard(IP별 제한)와 JOB_MAX로 막고, 저장은 사용자의 버튼 클릭으로만 한다
// stateless + JSON 응답으로 단순하게 유지
app.post('/mcp', ...toolCallGuard(), async (req, res) => {
  const server = new McpServer({ name: 'tistory-mcp', version: '1.0.0' });
  registerWritePost(server, jobs, PUBLIC_URL);
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
app.all('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
});

app.listen(PORT, () => console.log(`tistory-mcp listening on :${PORT}, MCP endpoint ${MCP_URL.href}`));
