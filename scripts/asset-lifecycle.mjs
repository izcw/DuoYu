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
);
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
assets.connectAssetTransport(async (path, method) => {
  assert.equal(method, 'POST');
  uploads++;
  return {};
});
try {
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF7sAAAAASUVORK5CYII=';
  const icon = 'duoyu-icon:' + JSON.stringify({ mode: 'upload', image });
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
