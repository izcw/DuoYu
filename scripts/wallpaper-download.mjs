import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = ts.transpileModule(await readFile('src/features/wallpaper/download-wallpaper.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { downloadWallpaper } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const originalFetch = globalThis.fetch;
try {
  for (const known of [true, false]) {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3, 4])); c.close(); } }), { headers: { 'content-type': 'image/png', ...(known ? { 'content-length': '4' } : {}) } });
    const updates = [];
    const blob = await downloadWallpaper('https://example.test/image', p => updates.push(p));
    assert.equal(blob.size, 4);
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(updates.map(p => p.loaded), [0, 2, 4, 4]);
    assert.equal(updates[1].total, known ? 4 : undefined);
    assert.equal(updates.at(-1).complete, true);
  }
  globalThis.fetch = async () => new Response('', { status: 500 });
  await assert.rejects(downloadWallpaper('https://example.test/image', () => {}));
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(21 * 1024 * 1024)); }, cancel() { cancelled = true; } }));
  await assert.rejects(downloadWallpaper('https://example.test/image', () => {}), /20MB/);
  assert.equal(cancelled, true);
  globalThis.fetch = async () => new Response(new ReadableStream({ start(c) { c.error(new Error('network interrupted')); } }));
  await assert.rejects(downloadWallpaper('https://example.test/image', () => {}), /network interrupted/);
  console.log('PASS streamed progress, unknown total, HTTP/network failures and streaming size limit');
} finally { globalThis.fetch = originalFetch; }
