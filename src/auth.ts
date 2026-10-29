import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Response } from 'express';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

const ACCESS_TTL_S = 3600;
const CODE_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

type Pending = { client: OAuthClientInformationFull; params: AuthorizationParams; expiresAt: number };
type Code = Pending;
type Token = { clientId: string; scopes: string[]; resource: URL; expiresAt?: number };

const newSecret = () => randomBytes(32).toString('hex');
const sha256 = (s: string) => createHash('sha256').update(s).digest();
// 토큰은 해시로만 보관한다. 상태 파일이 새어도 토큰 원문은 나오지 않는다
const tokenKey = (t: string) => sha256(t).toString('hex');

type StoredToken = Omit<Token, 'resource'>;
type State = {
  resource: string;
  clients: OAuthClientInformationFull[];
  accessTokens: [string, StoredToken][];
  refreshTokens: [string, StoredToken][];
};

// 길이가 달라도 비교 시간이 같도록 해시끼리 비교
export function passphraseMatches(input: string, expected: string): boolean {
  return timingSafeEqual(sha256(input), sha256(expected));
}

class MemoryClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly onChange: () => void) {}
  readonly clients = new Map<string, OAuthClientInformationFull>();
  getClient(clientId: string) {
    return this.clients.get(clientId);
  }
  registerClient(client: OAuthClientInformationFull) {
    this.clients.set(client.client_id, client);
    this.onChange();
    return client;
  }
}

/**
 * 소유자 1명용 내장 인가 서버.
 * stateFile을 주면 클라이언트와 토큰을 파일에 저장해 재시작해도 재인가가 필요 없다.
 * 인가 대기·코드·실패 횟수는 수명이 짧아 메모리에만 둔다.
 */
export class OwnerAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new MemoryClientsStore(() => this.save());
  private pending = new Map<string, Pending>();
  private codes = new Map<string, Code>();
  private accessTokens = new Map<string, Token>();
  private refreshTokens = new Map<string, Token>();
  private failures = 0;
  private lockedUntil = 0;

  constructor(
    private readonly passphrase: string,
    private readonly resource: URL,
    private readonly stateFile?: string,
  ) {
    this.load();
  }

  // 주소(PUBLIC_URL)가 바뀌었으면 기존 토큰은 버린다
  private load() {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    const state = JSON.parse(readFileSync(this.stateFile, 'utf8')) as State;
    if (state.resource !== this.resource.href) return;
    for (const c of state.clients) this.clientsStore.clients.set(c.client_id, c);
    const revive = (entries: [string, StoredToken][]) =>
      new Map(entries.map(([k, t]) => [k, { ...t, resource: this.resource }] as const));
    this.accessTokens = revive(state.accessTokens);
    this.refreshTokens = revive(state.refreshTokens);
  }

  private save() {
    if (!this.stateFile) return;
    const now = Date.now() / 1000;
    const strip = (m: Map<string, Token>) =>
      [...m].filter(([, t]) => !t.expiresAt || t.expiresAt > now).map(([k, { resource: _, ...t }]) => [k, t]);
    const state = {
      resource: this.resource.href,
      clients: [...this.clientsStore.clients.values()],
      accessTokens: strip(this.accessTokens),
      refreshTokens: strip(this.refreshTokens),
    };
    // 쓰다 죽어도 기존 파일이 깨지지 않게 임시 파일 후 교체
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, this.stateFile);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.resource && params.resource.href !== this.resource.href) {
      throw new InvalidTargetError(`Unknown resource: ${params.resource.href}`);
    }
    const requestId = newSecret();
    this.pending.set(requestId, { client, params, expiresAt: Date.now() + PENDING_TTL_MS });
    res.type('html').send(consentPage(requestId, client.client_name));
  }

  /** `/consent` 폼 처리. 성공 시 redirect URL, 실패 시 사용자에게 보여줄 메시지를 돌려준다. */
  consent(requestId: string, passphrase: string): { redirect: string } | { error: string } {
    const now = Date.now();
    if (now < this.lockedUntil) return { error: '시도 횟수 초과. 잠시 후 다시 시도하세요.' };

    const req = this.pending.get(requestId);
    if (!req || req.expiresAt < now) {
      this.pending.delete(requestId);
      return { error: '인가 요청이 만료되었습니다. Claude에서 다시 연결하세요.' };
    }
    if (!passphraseMatches(passphrase, this.passphrase)) {
      if (++this.failures >= MAX_FAILURES) {
        this.failures = 0;
        this.lockedUntil = now + LOCK_MS;
      }
      return { error: '패스프레이즈가 틀렸습니다.' };
    }
    this.failures = 0;
    this.pending.delete(requestId);

    const code = newSecret();
    this.codes.set(code, { ...req, expiresAt: now + CODE_TTL_MS });
    const target = new URL(req.params.redirectUri);
    target.searchParams.set('code', code);
    if (req.params.state !== undefined) target.searchParams.set('state', req.params.state);
    return { redirect: target.href };
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.validCode(client, code).params.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<OAuthTokens> {
    const data = this.validCode(client, code);
    this.codes.delete(code);
    return this.issueTokens(client.client_id, data.params.scopes ?? []);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const key = tokenKey(refreshToken);
    const data = this.refreshTokens.get(key);
    if (!data || data.clientId !== client.client_id) throw new InvalidGrantError('Invalid refresh token');
    this.refreshTokens.delete(key); // 회전: 한 번 쓴 refresh token은 폐기
    return this.issueTokens(client.client_id, data.scopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = this.accessTokens.get(tokenKey(token));
    if (!data || !data.expiresAt || data.expiresAt < Date.now() / 1000) {
      this.accessTokens.delete(tokenKey(token));
      throw new InvalidTokenError('Invalid or expired token');
    }
    return { token, ...data };
  }

  private validCode(client: OAuthClientInformationFull, code: string): Code {
    const data = this.codes.get(code);
    if (!data || data.expiresAt < Date.now() || data.client.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return data;
  }

  private issueTokens(clientId: string, scopes: string[]): OAuthTokens {
    const access = newSecret();
    const refresh = newSecret();
    const base = { clientId, scopes, resource: this.resource };
    this.accessTokens.set(tokenKey(access), { ...base, expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TTL_S });
    this.refreshTokens.set(tokenKey(refresh), base);
    this.save();
    return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' ') };
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function consentPage(requestId: string, clientName = '알 수 없는 클라이언트', error?: string): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tistory MCP 인가</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.3rem">Tistory MCP 접근 허용</h1>
<p><strong>${escapeHtml(clientName)}</strong>이(가) 블로그 임시저장 권한을 요청합니다.</p>
${error ? `<p role="alert" style="color:#c00">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/consent">
<input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
<label for="pp">패스프레이즈</label><br>
<input id="pp" name="passphrase" type="password" autocomplete="current-password" required autofocus style="width:100%;padding:.5rem;margin:.5rem 0">
<button type="submit" style="padding:.5rem 1rem">허용</button>
</form></body></html>`;
}
