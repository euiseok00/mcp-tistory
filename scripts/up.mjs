// quick tunnel URL은 터널을 띄운 뒤에야 정해진다: 터널 → URL 확인 → 그 URL로 서버 시작
import { execSync } from 'node:child_process';

const sh = cmd => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

execSync('docker compose up -d tunnel', { stdio: 'inherit' });

let url;
for (let i = 0; i < 30 && !url; i++) {
  url = sh('docker compose logs tunnel 2>&1').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g)?.at(-1);
  if (!url) await new Promise(r => setTimeout(r, 1000));
}
if (!url) {
  console.error('터널 URL을 30초 안에 찾지 못했습니다. `docker compose logs tunnel`을 확인하세요.');
  process.exit(1);
}

execSync('docker compose up -d --build mcp', { stdio: 'inherit', env: { ...process.env, PUBLIC_URL: url } });
console.log(`\nMCP 커넥터 URL: ${url}/mcp`);
console.log('터널을 새로 띄우면 URL이 바뀝니다. 그때마다 커넥터를 재등록하세요. 종료: docker compose down');
