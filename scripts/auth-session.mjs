import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = (await readFile('src/entrypoints/background.ts', 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '')
  .replace('export default defineBackground', 'defineBackground')
  .replaceAll('import.meta.env.VITE_SYNC_URL', "'https://sync.example.test'");
const js = ts
  .transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  })
  .outputText.replace(/export \{\};?/g, '');
class AuthError extends Error {
  constructor(message, invalidSession = false) {
    super(message);
    this.invalidSession = invalidSession;
  }
}
class AccessTokenRejected extends AuthError {}
const account = { issuer: 'https://id.example.test', sub: 'test' };
const initial = () => ({
  clientId: 'client',
  account,
  access: 'access',
  identity: 'identity',
  refresh: 'refresh',
  expires: Date.now() + 300000,
});
async function setup(seed, overrides = {}) {
  const local = { authRenewal: seed },
    cache = {},
    listeners = [];
  const storage = (data) => ({
    setAccessLevel: async () => {},
    get: async (k) => ({ [k]: data[k] }),
    set: async (v) => Object.assign(data, structuredClone(v)),
    remove: async (k) => {
      delete data[k];
    },
  });
  let exchanges = 0;
  const browser = {
    storage: { local: storage(local), session: storage(cache) },
    runtime: {
      id: 'ext',
      getURL: (p) => 'chrome-extension://ext' + p,
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
    identity: {
      getRedirectURL: () => 'https://ext.chromiumapp.org/oidc',
      launchWebAuthFlow: async () => {
        throw Error('No center cookie');
      },
    },
  };
  const scope = {
    browser,
    defineBackground: (fn) => fn(),
    AUTH_SESSION_KEY: 'auth',
    authConfig: { issuer: account.issuer, clientId: 'client', scope: 'openid' },
    AuthError,
    AccessTokenRejected,
    navigator: { onLine: true },
    discovery: async () => ({
      authorization_endpoint: account.issuer + '/authorize',
    }),
    exchange: async () => {
      exchanges++;
      return {
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        id_token: 'rotated-id',
        expires_in: 300,
      };
    },
    verifyID: async () => 'test',
    userInfo: async () => account,
    random: () => 'random',
    challenge: async () => 'challenge',
    ...overrides,
  };
  new Function(...Object.keys(scope), js)(...Object.values(scope));
  const status = () =>
    new Promise((resolve) =>
      listeners[1](
        { type: 'duoyu-auth', action: 'status' },
        { id: 'ext', url: 'chrome-extension://ext/newtab.html' },
        resolve,
      ),
    );
  return { status, local, cache, exchanges: () => exchanges };
}
let t = await setup(initial());
assert.deepEqual((await t.status()).view.account, account);
assert.equal(t.exchanges(), 0); // Empty session cache after browser restart.
t = await setup({ ...initial(), expires: 0 });
assert.deepEqual((await t.status()).view.account, account);
assert.equal(t.local.authRenewal.refresh, 'rotated-refresh');
assert.equal(t.local.authRenewal.identity, 'rotated-id');
t = await setup(
  { ...initial(), expires: 0 },
  {
    discovery: async () => {
      throw Error('offline');
    },
  },
);
assert.deepEqual((await t.status()).view.account, account);
assert.equal(t.local.authRenewal.refreshPending, undefined);
t = await setup(
  { ...initial(), expires: 0 },
  {
    exchange: async () => {
      throw Error('response lost');
    },
  },
);
assert.deepEqual((await t.status()).view.account, account);
assert.equal(t.local.authRenewal.refreshPending, true);
assert.deepEqual((await t.status()).view.account, account);
assert.equal(t.local.authRenewal.refresh, 'refresh');
t = await setup({ ...initial(), expires: 0 }, { navigator: { onLine: false } });
assert.deepEqual((await t.status()).view.account, account);
assert.equal(t.exchanges(), 0);
let infoCalls = 0;
t = await setup(initial(), {
  userInfo: async () => {
    if (++infoCalls === 1) throw new AccessTokenRejected('expired', true);
    return account;
  },
});
assert.deepEqual((await t.status()).view.account, account);
assert.equal(t.exchanges(), 1);
t = await setup(
  { ...initial(), expires: 0 },
  {
    exchange: async () => {
      throw new AuthError('revoked', true);
    },
  },
);
assert.equal((await t.status()).view.account, null);
assert.equal(t.local.authRenewal, undefined);
console.log(
  'PASS restart, durable rotation, discovery outage, lost response, interrupted worker, offline, access-token recovery, explicit revocation',
);
