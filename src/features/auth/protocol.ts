import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';
import { authConfig } from './config';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly invalidSession = false,
  ) {
    super(message);
  }
}
type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  scopes_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
};
export interface Tokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
}
const request = (url: string, init?: RequestInit) =>
  fetch(url, {
    ...init,
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
let metadata: Discovery | undefined;
export async function discovery() {
  if (metadata) return metadata;
  const r = await request(
    `${authConfig.issuer}/.well-known/openid-configuration`,
  );
  if (!r.ok) throw new AuthError('账号服务暂时不可用，请稍后重试');
  const d = (await r.json()) as Discovery;
  if (d.issuer !== authConfig.issuer)
    throw new AuthError('账号服务 issuer 不匹配');
  if (
    !d.response_types_supported?.includes('code') ||
    !d.grant_types_supported?.includes('authorization_code') ||
    !d.grant_types_supported?.includes('refresh_token') ||
    !d.code_challenge_methods_supported?.includes('S256') ||
    !d.token_endpoint_auth_methods_supported?.includes('none') ||
    !authConfig.scope
      .split(' ')
      .every((scope) => d.scopes_supported?.includes(scope))
  )
    throw new AuthError(
      '账号服务未提供本扩展所需的 OIDC/PKCE 能力，请检查服务配置',
    );
  for (const key of [
    'authorization_endpoint',
    'token_endpoint',
    'userinfo_endpoint',
    'jwks_uri',
    'revocation_endpoint',
  ] as const) {
    const url = new URL(d[key]);
    if (
      url.origin !== authConfig.issuer ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new AuthError('账号服务端点不匹配');
  }
  return (metadata = d);
}
export const random = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
export async function challenge(verifier: string) {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(verifier),
        ),
      ),
    ),
  )
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export function callbackCode(raw: string, redirect: string, state: string) {
  const url = new URL(raw),
    expected = new URL(redirect);
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.hash ||
    url.searchParams.getAll('state').length !== 1 ||
    url.searchParams.get('state') !== state
  )
    throw new AuthError('登录回调校验失败，请重新登录');
  if (url.searchParams.has('error'))
    throw new AuthError('登录未获授权，请重试');
  if (
    url.searchParams.has('iss') &&
    url.searchParams.get('iss') !== authConfig.issuer
  )
    throw new AuthError('登录回调来源不匹配');
  const codes = url.searchParams.getAll('code');
  if (codes.length !== 1 || !codes[0])
    throw new AuthError('登录回调缺少授权码');
  return codes[0];
}
export async function exchange(body: Record<string, string>) {
  const d = await discovery();
  const r = await request(d.token_endpoint, {
    method: 'POST',
    body: new URLSearchParams({ ...body, client_id: authConfig.clientId }),
  });
  if (!r.ok) {
    const error = await r.json().catch(() => ({}));
    if (error.error === 'origin_not_allowed')
      throw new AuthError(
        '扩展请求来源未获允许，请在账号中心登记当前扩展的 allowed_origins',
      );
    throw new AuthError(
      r.status >= 500 ? '账号服务暂时不可用' : '登录已失效，请重新登录',
      error.error === 'invalid_grant' || error.error === 'invalid_client',
    );
  }
  const t = (await r.json()) as Tokens;
  if (
    !t.access_token ||
    t.token_type?.toLowerCase() !== 'bearer' ||
    !Number.isFinite(t.expires_in) ||
    t.expires_in <= 0
  )
    throw new AuthError('账号服务返回的令牌无效', true);
  return t;
}
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
export async function verifyID(
  token: string,
  nonce?: string,
  subject?: string,
) {
  const d = await discovery();
  jwks ??= createRemoteJWKSet(new URL(d.jwks_uri), {
    [customFetch]: (url, init) => request(String(url), init),
  });
  const { payload } = await jwtVerify(token, jwks, {
    issuer: authConfig.issuer,
    audience: authConfig.clientId,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'iat', 'exp'],
    clockTolerance: 5,
  });
  if (
    !payload.sub ||
    (nonce !== undefined && payload.nonce !== nonce) ||
    (subject !== undefined && payload.sub !== subject) ||
    (payload.azp !== undefined && payload.azp !== authConfig.clientId) ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== authConfig.clientId) ||
    (payload.iat ?? Infinity) > Date.now() / 1000 + 5
  )
    throw new AuthError('登录身份校验失败', true);
  return payload.sub;
}
export async function userInfo(accessToken: string, sub: string) {
  const d = await discovery();
  const r = await request(d.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && body.error === 'invalid_token')
      throw new AuthError('登录已失效，请重新登录', true);
    if (r.status === 403 && body.error === 'origin_not_allowed')
      throw new AuthError(
        '扩展请求来源未获允许，请在账号中心登记当前扩展的 allowed_origins',
      );
    if (r.status === 403 && body.error === 'insufficient_scope')
      throw new AuthError('账号授权范围不足，请退出登录后重新授权');
    throw new AuthError(
      r.status >= 500
        ? '账号服务暂时不可用，请稍后重试'
        : '账号资料验证失败，请检查接入配置',
    );
  }
  const u = await r.json();
  if (u.sub !== sub) throw new AuthError('账号资料与登录身份不一致', true);
  let picture = '';
  if (typeof u.picture === 'string' && u.picture) {
    try {
      const url = new URL(u.picture, authConfig.issuer);
      if (url.origin === authConfig.issuer && !url.username && !url.password)
        picture = url.href;
    } catch {
      /* A malformed optional avatar must not invalidate the account. */
    }
  }
  return {
    issuer: authConfig.issuer,
    sub,
    name: typeof u.name === 'string' ? u.name : '',
    email: typeof u.email === 'string' ? u.email : '',
    picture,
  };
}
export async function revoke(token: string, hint: string) {
  const d = await discovery();
  const r = await request(d.revocation_endpoint, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: authConfig.clientId,
      token,
      token_type_hint: hint,
    }),
  });
  if (!r.ok) throw new AuthError('账号服务未确认令牌撤销');
}
