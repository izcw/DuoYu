import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

async function load(relative) {
  const file = new URL(relative, import.meta.url);
  let source = await readFile(file, 'utf8');
  if (source.includes('from "vue"')) {
    const vue = pathToFileURL(createRequire(file).resolve('vue')).href;
    source = source.replace('from "vue"', `from ${JSON.stringify(vue)}`);
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: 99, module: 99 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
const backend = await load('../../DuoYu-Backend/admin/src/api.ts');
const identity = await load('../../DuoYu-ID/admin/src/api/duoyu.ts');
const previousFetch = globalThis.fetch;
const previousWindow = globalThis.window;
let redirects = 0;
globalThis.window = { location: { assign(path) {
  assert.equal(path, '/login');
  redirects++;
} } };
try {
  for (const body of ['<html>Unauthorized</html>', '', 'null', '{"error":"expired","msg":"expired"}']) {
    globalThis.fetch = async () => new Response(body, { status: 401 });
    Object.assign(backend.session, { authenticated: true, csrf: 'old', profile: { name: 'old', picture: 'old' } });
    await assert.rejects(backend.api('me'), /expired|HTTP 401/);
    assert.equal(backend.session.authenticated, false);
    assert.equal(backend.session.csrf, '');
    assert.equal(backend.session.profile.name, '');
    const before = redirects;
    await assert.rejects(identity.api('/api/me'), /expired|HTTP 401/);
    assert.equal(redirects, before + 1);
  }
  globalThis.fetch = async () => new Response('gateway failed', {
    status: 502, headers: { 'X-Request-ID': 'test-request' },
  });
  await assert.rejects(identity.api('/api/me'), /HTTP 502.*test-request/);
  assert.equal(redirects, 4);
  globalThis.fetch = async () => new Response('<html>wrong upstream</html>');
  await assert.rejects(backend.api('me'), /无效响应/);
  await assert.rejects(identity.api('/api/me'), /无效响应/);
  globalThis.fetch = async () => Response.json({ data: { id: 7 }, csrf: 'new' });
  assert.equal((await backend.api('me')).csrf, 'new');
  assert.deepEqual(await identity.api('/api/me'), { id: 7 });
  console.log('PASS both admin APIs: HTML/empty/null/JSON 401, session invalidation, request ID, invalid success and valid JSON');
} finally {
  globalThis.fetch = previousFetch;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
}
