import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
await mkdir('work/auth-protocol', { recursive: true });
for (const name of ['config', 'protocol']) {
  const src = await readFile(`src/features/auth/${name}.ts`, 'utf8');
  await writeFile(
    `work/auth-protocol/${name}.mjs`,
    ts.transpileModule(
      src
        .replace("'./config'", "'./config.mjs'")
        .replaceAll(
          'import.meta.env.VITE_AUTH_ISSUER',
          JSON.stringify('http://localhost:8080'),
        )
        .replaceAll(
          'import.meta.env.VITE_AUTH_CLIENT_ID',
          JSON.stringify('duoyu_extensions_local'),
        )
        .replaceAll(
          'import.meta.env.VITE_AUTH_SCOPE',
          JSON.stringify('openid profile email offline_access'),
        ),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      },
    ).outputText,
  );
}
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = {
  ...(await exportJWK(publicKey)),
  kid: 'test',
  alg: 'RS256',
  use: 'sig',
};
const issuer = 'http://localhost:8080';
let user = { sub: 'u1', name: '测试', picture: '/avatars/u1' },
  userStatus = 200;
let capabilities = {
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
};
globalThis.fetch = async (raw) => {
  const url = String(raw);
  if (url.endsWith('openid-configuration'))
    return Response.json({
      ...capabilities,
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/oauth/token',
      userinfo_endpoint: issuer + '/userinfo',
      jwks_uri: issuer + '/keys',
      revocation_endpoint: issuer + '/revoke',
    });
  if (url.endsWith('/keys')) return Response.json({ keys: [jwk] });
  if (url.endsWith('/userinfo'))
    return Response.json(user, { status: userStatus });
  throw Error('unexpected endpoint');
};
const p = await import('../work/auth-protocol/protocol.mjs');
const redirect =
  'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/oidc';
assert.equal(
  p.callbackCode(redirect + '?state=valid&code=code', redirect, 'valid'),
  'code',
);
for (const raw of [
  redirect + '?state=forged&code=code',
  redirect + '?state=valid&state=valid&code=code',
  redirect + '?state=valid&code=one&code=two',
  redirect + '?state=valid&code=one&iss=https://evil.invalid',
  redirect + '?state=valid&error=access_denied',
  redirect.replace('/oidc', '/wrong') + '?state=valid&code=code',
]) {
  assert.throws(() => p.callbackCode(raw, redirect, 'valid'));
}
console.log(
  'PASS callback state, duplicate parameters, issuer, path, denied authorization',
);
const mint = (changes = {}, key = privateKey) =>
  new SignJWT({
    sub: 'u1',
    iss: issuer,
    aud: 'duoyu_extensions_local',
    nonce: 'n1',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...changes,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .sign(key);
assert.equal(await p.verifyID(await mint(), 'n1'), 'u1');
for (const changes of [
  { nonce: 'wrong' },
  { iss: 'https://evil.invalid' },
  { aud: 'wrong' },
  { exp: 1 },
  { azp: 'wrong' },
  { iat: Math.floor(Date.now() / 1000) + 300 },
  { aud: ['duoyu_extensions_local', 'another'] },
]) {
  await assert.rejects(() => mint(changes).then((t) => p.verifyID(t, 'n1')));
}
const forgedKey = (await generateKeyPair('RS256')).privateKey;
await assert.rejects(() =>
  mint({}, forgedKey).then((t) => p.verifyID(t, 'n1')),
);
await assert.rejects(() =>
  mint().then((t) => p.verifyID(t, undefined, 'other-user')),
);
console.log(
  'PASS signature, nonce, issuer, audience, azp, expiry, future iat, refresh subject',
);
assert.equal((await p.userInfo('test', 'u1')).picture, issuer + '/avatars/u1');
user.picture = 'https://tracking.invalid/avatar';
assert.equal((await p.userInfo('test', 'u1')).picture, '');
await assert.rejects(() => p.userInfo('test', 'other-user'));
userStatus = 403;
user = { error: 'origin_not_allowed' };
await assert.rejects(
  () => p.userInfo('test', 'u1'),
  (e) => e.invalidSession === false && /allowed_origins/.test(e.message),
);
user = { error: 'insufficient_scope' };
await assert.rejects(
  () => p.userInfo('test', 'u1'),
  (e) => !e.invalidSession && /授权范围/.test(e.message),
);
userStatus = 401;
user = { error: 'invalid_token' };
await assert.rejects(
  () => p.userInfo('test', 'u1'),
  (e) => e.invalidSession,
);
userStatus = 503;
await assert.rejects(
  () => p.userInfo('test', 'u1'),
  (e) => e.invalidSession === false,
);
console.log(
  'PASS UserInfo subject, avatar origin, revoked session vs service failure',
);
userStatus = 200;
user = { sub: 'u1', picture: 'http://[' };
assert.equal((await p.userInfo('test', 'u1')).picture, '');
for (const field of Object.keys(capabilities)) {
  const valid = capabilities;
  capabilities = { ...capabilities, [field]: [] };
  const fresh = await import('../work/auth-protocol/protocol.mjs?' + field);
  await assert.rejects(() => fresh.discovery(), /OIDC\/PKCE/);
  capabilities = valid;
}
console.log(
  'PASS missing discovery capabilities and malformed optional avatar',
);
