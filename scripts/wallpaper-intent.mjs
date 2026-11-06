import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
const db = new Dexie('wallpaper-intent-' + Date.now());
db.version(1).stores({
  preferences: 'id',
  wallpapers: 'id',
  syncAssets: 'id',
  syncShadow: 'id',
  syncConflicts: 'id',
});
const values = new Map([['duoyu-wallpaper-intent-migrated', '1']]);
const storage = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, v),
  removeItem: (k) => values.delete(k),
};
const code = ts
  .transpileModule(
    await readFile('src/features/wallpaper/wallpaper-intent.ts', 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  )
  .outputText.replace(/^import[^;]+;\s*/gm, '')
  .replace(/\bexport /g, '');
const api = new Function(
  'database',
  'accountStorage',
  code +
    ';return {rememberWallpaperChoice,restoreWallpaperChoice,settleWallpaperChoice};',
)(db, storage);
const old = {
  selection: 'cloud:old',
  contentHash: 'a'.repeat(64),
  asset: 'duoyu-asset:' + 'a'.repeat(64),
};
const newer = {
  selection: 'cloud:new',
  contentHash: 'b'.repeat(64),
  asset: 'duoyu-asset:' + 'b'.repeat(64),
};
try {
  await db.syncAssets.put({ id: old.contentHash, blob: new Blob(['image']) });
  api.rememberWallpaperChoice(old);
  await api.restoreWallpaperChoice();
  assert.equal((await db.wallpapers.get('daily')).contentHash, old.contentHash);
  assert.equal(
    (await db.preferences.get('wallpaperSelection')).value,
    old.selection,
  );
  await db.syncShadow.put({
    id: 'preferences:wallpaperSelection',
    payload: { value: old.selection },
  });
  await db.syncShadow.put({ id: 'wallpapers:daily', payload: { ...old } });
  const original = db.syncShadow.get.bind(db.syncShadow);
  db.syncShadow.get = async (id) => {
    const result = await original(id);
    if (id === 'wallpapers:daily') api.rememberWallpaperChoice(newer);
    return result;
  };
  await api.settleWallpaperChoice();
  assert.equal(
    JSON.parse(storage.getItem('duoyu-wallpaper-intent')).selection,
    newer.selection,
  );
  db.syncShadow.get = original;
  api.rememberWallpaperChoice(old);
  await api.settleWallpaperChoice();
  assert.equal(storage.getItem('duoyu-wallpaper-intent'), null);
  api.rememberWallpaperChoice(old);
  const getCached = db.syncAssets.get.bind(db.syncAssets);
  db.syncAssets.get = async (id) => {
    const asset = await getCached(id);
    api.rememberWallpaperChoice(newer);
    await db.wallpapers.put({
      id: 'daily',
      contentHash: newer.contentHash,
      selection: newer.selection,
    });
    return asset;
  };
  await api.restoreWallpaperChoice();
  assert.equal(
    (await db.wallpapers.get('daily')).contentHash,
    newer.contentHash,
    'stale asset read must not restore the prior choice',
  );
  db.syncAssets.get = getCached;
  api.rememberWallpaperChoice({ selection: 'daily' });
  await api.restoreWallpaperChoice();
  let writes = 0;
  db.preferences.hook('updating', () => {
    writes++;
  });
  await api.restoreWallpaperChoice();
  assert.equal(writes, 0, 'daily retry must not enqueue redundant writes');
  await db.syncShadow.put({
    id: 'preferences:wallpaperSelection',
    deleted: true,
    payload: { value: 'daily' },
  });
  await api.settleWallpaperChoice();
  assert.ok(
    storage.getItem('duoyu-wallpaper-intent'),
    'deleted shadow is not acknowledgment',
  );
  api.rememberWallpaperChoice(old);
  await db.wallpapers.put({ id: 'daily', ...newer });
  await db.syncConflicts.put({
    id: 'waiting',
    operation: { changes: [{ table: 'wallpapers', id: 'daily', value: old }] },
  });
  await api.restoreWallpaperChoice();
  assert.equal(
    (await db.wallpapers.get('daily')).contentHash,
    newer.contentHash,
    'unresolved version decisions must not reapply the saved intent',
  );
  await db.syncConflicts.update('waiting', { resolvedAt: Date.now() });
  await api.restoreWallpaperChoice();
  assert.equal((await db.wallpapers.get('daily')).contentHash, old.contentHash);
  console.log(
    'PASS: original restoration, newer choice survives delayed acknowledgment, successful settlement, daily idempotence, deleted shadow guard',
  );
} finally {
  await db.delete();
}
