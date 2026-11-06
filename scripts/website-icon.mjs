import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const bodySource = await readFile('src/shared/response-body.ts', 'utf8');
const bodyCode = ts.transpileModule(bodySource, {
  compilerOptions: { target: 99, module: 99 },
}).outputText;
const bodyURL =
  'data:text/javascript;base64,' + Buffer.from(bodyCode).toString('base64');
const { readResponseBytes, readMetadataHTML } = await import(bodyURL);
const source = (
  await readFile('src/features/library/website-icon.ts', 'utf8')
).replace("'../../shared/response-body'", JSON.stringify(bodyURL));
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
  let cancelled = false;
  const stream = () =>
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(8).fill(65));
      },
      cancel() {
        cancelled = true;
      },
    });
  const oversized = new Response(stream(), {
    headers: { 'Content-Length': '1' },
  });
  await assert.rejects(readResponseBytes(oversized, 10), /大小限制/);
  assert.equal(cancelled, true);
  assert.equal(oversized.body.locked, false);
  cancelled = false;
  assert.equal(
    (await readResponseBytes(new Response(stream()), 10, true)).length,
    10,
  );
  assert.equal(cancelled, true);
  assert.deepEqual(
    await readResponseBytes(new Response(new Uint8Array([1, 2])), 2),
    new Uint8Array([1, 2]),
  );
  assert.equal((await readResponseBytes(new Response(null), 2)).length, 0);
  assert.equal(await readMetadataHTML(new Response('中文标题')), '中文标题');
  const broken = new Response(
    new ReadableStream({
      start(c) {
        c.error(new Error('network failed'));
      },
    }),
  );
  await assert.rejects(readResponseBytes(broken, 10), /network failed/);
  assert.equal(broken.body.locked, false);
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
  let rejectedIconCancelled = false;
  globalThis.fetch = async (url) =>
    url === 'https://example.com/'
      ? new Response('<link rel="icon" href="/too-big.png">')
      : url.endsWith('too-big.png')
        ? new Response(
            new ReadableStream({
              pull(c) {
                c.enqueue(new Uint8Array(600000));
              },
              cancel() {
                rejectedIconCancelled = true;
              },
            }),
            { headers: { 'Content-Type': 'image/png' } },
          )
        : new Response('fallback', {
            headers: { 'Content-Type': 'image/png' },
          });
  assert.equal(
    await websiteIcon('https://example.com/'),
    'data:image/png;base64,ZmFsbGJhY2s=',
  );
  assert.equal(rejectedIconCancelled, true);
  console.log(
    'PASS bounded streams, untrusted lengths, prefix cancellation, exact limit, UTF-8, stream failure and oversized icon fallback',
  );
  console.log(
    'PASS icon declarations, relative/CDN URLs, refresh fetch, image validation, favicon fallback and invalid protocols',
  );
} finally {
  globalThis.fetch = originalFetch;
}
