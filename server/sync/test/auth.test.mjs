import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { createAuthenticator } from '../src/http.mjs';
await test('cloud server authenticates identity and online access as a pair', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const key = await exportJWK(publicKey);
  key.kid = 'test';
  let subject = 'user',
    online = true;
  const auth = await createAuthenticator(
    { issuer: 'https://issuer.test', clientId: 'extension-client' },
    {
      keyResolver: createLocalJWKSet({ keys: [key] }),
      transport: async (url) =>
        url.endsWith('openid-configuration')
          ? Response.json({
              issuer: 'https://issuer.test',
              jwks_uri: 'https://issuer.test/keys',
              userinfo_endpoint: 'https://issuer.test/userinfo',
            })
          : Response.json({ sub: subject }, { status: online ? 200 : 401 }),
    },
  );
  const token = async (
    aud = 'extension-client',
    iss = 'https://issuer.test',
    exp = '5m',
  ) =>
    new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  const request = (identity) => ({
    headers: {
      authorization: 'Bearer opaque-access',
      'x-duoyu-identity': identity,
    },
  });
  assert.equal((await auth(request(await token()))).sub, 'user');
  await assert.rejects(auth({ headers: {} }), (e) => e.status === 401);
  for (const args of [
    ['other-client'],
    ['extension-client', 'https://other.test'],
    ['extension-client', 'https://issuer.test', '-1s'],
  ])
    await assert.rejects(
      auth(request(await token(...args))),
      (e) => e.status === 401,
    );
  subject = 'different-user';
  await assert.rejects(
    auth(request(await token())),
    (e) => e.code === 'subject_mismatch',
  );
  subject = 'user';
  online = false;
  await assert.rejects(auth(request(await token())), (e) => e.status === 401);
});
