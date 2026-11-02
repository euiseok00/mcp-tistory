// .env의 PUBLIC_URL로 manifest.json을 만든다. tailnet 이름을 저장소에 남기지 않기 위해 생성 파일은 git에서 제외한다.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('./', import.meta.url);
if (!process.env.PUBLIC_URL) throw new Error('.env에 PUBLIC_URL이 필요합니다.');
const { origin, protocol } = new URL(process.env.PUBLIC_URL);
if (protocol !== 'https:') throw new Error('PUBLIC_URL은 https여야 합니다.');
const template = readFileSync(new URL('manifest.template.json', dir), 'utf8');
writeFileSync(new URL('manifest.json', dir), template.replaceAll('__SERVER_ORIGIN__', origin));
console.log(`extension/manifest.json 생성: ${origin}`);
