import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile('src/features/library/website-icon.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { target: 99, module: 99 },
}).outputText;
const { iconCandidates, websiteIcon } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
assert.deepEqual(
  iconCandidates(
    `<link rel="stylesheet" href="bad.css"><link href="../logo.png?a=1&amp;b=2" rel="shortcut icon"><link rel=icon href=javascript:bad>`,
    'https://example.com/en/',
  ),
  ['https://example.com/logo.png?a=1&b=2', 'https://example.com/favicon.ico'],
);
const originalFetch = globalThis.fetch;
try {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-cache');
    if (url === 'https://example.com/')
      return new Response(
        '<link rel="icon" href="https://cdn.example.com/logo.png">',
      );
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'Content-Type': 'image/png' },
    });
  };
  assert.equal(
    await websiteIcon('https://example.com/'),
    'data:image/png;base64,iVBORw==',
  );
  assert.deepEqual(requests, [
    'https://example.com/',
    'https://cdn.example.com/logo.png',
  ]);
  globalThis.fetch = async (url) =>
    url === 'https://example.com/'
      ? new Response('denied', { status: 403 })
      : new Response('icon', { headers: { 'Content-Type': 'image/x-icon' } });
  assert.match(
    await websiteIcon('https://example.com/'),
    /^data:image\/x-icon/,
  );
  globalThis.fetch = async () =>
    new Response('<html>not an image</html>', {
      headers: { 'Content-Type': 'text/html' },
    });
  assert.equal(await websiteIcon('https://example.com/'), '');
  await assert.rejects(websiteIcon('javascript:alert(1)'));
  await assert.rejects(websiteIcon('https://user:pass@example.com/'));
  console.log(
    'PASS icon declarations, relative/CDN URLs, refresh fetch, image validation, favicon fallback and invalid protocols',
  );
} finally {
  globalThis.fetch = originalFetch;
}
