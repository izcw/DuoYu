import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('work/asset-test', { recursive: true });
const db = new Dexie('assets-test-' + crypto.randomUUID());
db.version(1).stores({
  syncAssets: 'id',
  syncMeta: 'id',
  syncOutbox: 'id',
  syncConflicts: 'id',
  syncShadow: 'id',
});
globalThis.__assetTest = db;
const source = (await readFile('src/features/sync/assets.ts', 'utf8')).replace(
  "import { database } from '../../shared/storage/database';",
  'const database=globalThis.__assetTest;',
).replace("import { guestMode } from '../../shared/storage/account';", 'const guestMode = false;');
await writeFile(
  'work/asset-test/assets.mjs',
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText,
);
const assets = await import('../work/asset-test/assets.mjs');
let uploads = 0;
let failUpload = false;
assets.connectAssetTransport(async (path, method) => {
  assert.equal(method, 'POST');
  uploads++;
  if (failUpload) throw Object.assign(Error('offline fixture'), { status: 503 });
  return {};
});
try {
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF7sAAAAASUVORK5CYII=';
  const icon = 'duoyu-icon:' + JSON.stringify({ mode: 'upload', image });
  const note = { table: 'memos', id: 'a', base: null, value: { id: 'a', body: image }, revision: '0' };
  assert.deepEqual(await assets.encodeChanges([note], 'epoch'), [note]);
  assert.equal(uploads, 0);
  const encoded = await assets.encodeAssets(
    { base: { icon }, value: { icon } },
    'epoch',
  );
  assert.equal(uploads, 1, 'historical base was uploaded');
  await assets.encodeAssets({ base: encoded.base, value: { icon } }, 'epoch');
  assert.equal(uploads, 2, 'explicit re-upload must renew an old cached image');
  const hidden = 'duoyu-icon:' + JSON.stringify({ mode: 'auto', image });
  const clean = await assets.encodeAssets(
    { base: { icon: hidden }, value: { icon: hidden } },
    'epoch',
  );
  assert.equal(uploads, 2);
  assert(!clean.value.icon.includes(image));
  assert(clean.base.icon.includes('duoyu-asset:'), 'base changed before merge');
  const svg = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E';
  const tab = { id: 'tab', collectionId: 'g', url: 'https://example.test', title: svg, icon: svg };
  const tabChange = { table: 'savedTabs', id: tab.id, base: tab, value: { ...tab, position: 2 }, revision: '0' };
  const [saved] = await assets.encodeChanges([tabChange], 'epoch');
  assert.deepEqual(saved.base, { ...tab, icon: '' });
  assert.deepEqual(saved.value, { ...tabChange.value, icon: '' });
  assert.equal(tab.icon, svg, 'conflict preview and original operation must stay intact');
  assert.equal(uploads, 2);
  const [png] = await assets.encodeChanges([{ ...tabChange, base: null, value: { ...tab, icon: image } }], 'epoch');
  assert.match(png.value.icon, /^duoyu-asset:[a-f0-9]{64}$/);
  assert.equal(png.value.title, svg);
  const batch = Array.from({ length: 64 }, (_, index) => ({
    ...tabChange, id: 'shared-' + index, base: null,
    value: { ...tab, id: 'shared-' + index, icon: image, position: index },
  }));
  const beforeBatch = uploads;
  const batchResult = await assets.encodeChanges(batch, 'fresh-epoch');
  console.log('Uploads for 64 links sharing one PNG:', uploads - beforeBatch);
  assert.equal(uploads - beforeBatch, 1);
  assert.ok(batchResult.every(c => c.value.icon === png.value.icon));
  const aliases = batch.map((c, i) => i % 2 === 0 ? c : {
    ...c, value: { ...c.value, icon: image.replace('image/png;', 'image/png;charset=utf-8;') },
  });
  failUpload = true;
  await assert.rejects(assets.encodeChanges(aliases, 'after-reconnect'), { status: 503 });
  failUpload = false;
  const beforeRetry = uploads;
  const retried = await assets.encodeChanges(aliases, 'after-reconnect');
  assert.equal(uploads - beforeRetry, 1);
  assert.deepEqual(retried, batchResult);
  const wrongType = { ...tab, icon: 'data:image/png;base64,AAABAA==' };
  const [malformed] = await assets.encodeChanges([{ ...tabChange, base: wrongType, value: wrongType }], 'epoch');
  assert.equal(malformed.base.icon, '');
  assert.equal(malformed.value.icon, '');
  await assert.rejects(assets.encodeChanges([{ ...tabChange, value: { ...tab,
    icon: 'duoyu-icon:' + JSON.stringify({ mode: 'upload', image: svg }) } }], 'epoch'), { status: 415 });
  assert.deepEqual(
    assets.collectAssets(
      'duoyu-icon:' +
        JSON.stringify({
          mode: 'auto',
          image: JSON.parse(encoded.value.icon.slice(11)).image,
        }),
    ),
    [],
  );
  const stored = (await db.syncAssets.toArray())[0];
  await db.syncAssets.update(stored.id, {
    createdAt: Date.now() - 2 * 86400000,
  });
  await db.syncOutbox.put({ id: 'pending' });
  await assets.pruneAssetCache();
  assert.equal(await db.syncAssets.count(), 1);
  await db.syncOutbox.clear();
  await db.syncShadow.put({
    id: 'live',
    deleted: false,
    payload: encoded.value,
  });
  await assets.pruneAssetCache();
  assert.equal(await db.syncAssets.count(), 1);
  await db.syncShadow.clear();
  await db.syncConflicts.put({ id: 'conflict', resolvedAt: 0 });
  await assets.pruneAssetCache();
  assert.equal(await db.syncAssets.count(), 1);
  await db.syncConflicts.clear();
  await assets.pruneAssetCache();
  assert.equal(await db.syncAssets.count(), 0);
  console.log(
    'PASS base-only images never upload, explicit re-upload renews cached assets, hidden images excluded and cache collection preserves pending/live/conflict references',
  );
} finally {
  await db.delete();
  delete globalThis.__assetTest;
}
