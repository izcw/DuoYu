import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import ts from 'typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('work/sync-test', { recursive: true });
for (const name of ['capture', 'model'])
  await writeFile(
    `work/sync-test/${name}.mjs`,
    ts.transpileModule(await readFile(`src/features/sync/${name}.ts`, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
const { installSyncCapture } = await import('../work/sync-test/capture.mjs');
const { rowChanges, denormalized, overlay, preserveLocalConflict, pendingDesktopChanges } =
  await import('../work/sync-test/model.mjs');
const db = new Dexie('sync-capture-test-' + crypto.randomUUID());
db.version(1).stores({
  libraryItems: 'id',
  tabCollections: 'id',
  syncOutbox: 'id,createdAt',
  syncMeta: 'id',
});
installSyncCapture(db, true);
try {
  await db.transaction('rw', db.libraryItems, async () => {
    await db.libraryItems.put({ id: 'a', name: 'first' });
    await db.libraryItems.put({ id: 'b', name: 'second' });
    await db.libraryItems.update('a', { name: 'final' });
  });
  let ops = await db.syncOutbox.orderBy('createdAt').toArray();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].rows['libraryItems:a'].base, null);
  assert.equal(ops[0].rows['libraryItems:a'].value.name, 'final');
  await assert.rejects(
    db.transaction('rw', db.libraryItems, async () => {
      await db.libraryItems.update('a', { name: 'rollback' });
      throw Error('abort');
    }),
  );
  assert.equal(await db.syncOutbox.count(), 1);
  assert.equal((await db.libraryItems.get('a')).name, 'final');
  await db.transaction('rw', db.libraryItems, async () => {
    await Promise.all([
      db.libraryItems.update('a', { name: 'parallel' }),
      db.libraryItems.delete('b'),
    ]);
  });
  ops = await db.syncOutbox.orderBy('createdAt').toArray();
  assert.equal(ops.length, 2);
  const last = ops.find((o) => o.id !== ops[0].id);
  assert.equal(last.rows['libraryItems:b'].value, null);
  await db.transaction('rw', db.libraryItems, async () => {
    Dexie.currentTransaction.idbtrans.syncRemote = true;
    await db.libraryItems.put({ id: 'remote' });
  });
  assert.equal(await db.syncOutbox.count(), 2);
  await db.libraryItems.clear();
  assert.equal(
    (await db.syncOutbox.toArray()).find((o) => o.rows['libraryItems:remote'])
      .rows['libraryItems:remote'].value,
    null,
  );
  const base = {
      id: 'g',
      name: 'group',
      tabs: [{ id: 't', title: 'old', url: 'https://example.com', savedAt: 1 }],
    },
    value = { ...base, tabs: [{ ...base.tabs[0], title: 'new' }] };
  const changes = rowChanges({
    g: { table: 'tabCollections', id: 'g', base, value },
  });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].table, 'savedTabs');
  const view = new Map([
    [
      'libraryItems:x',
      {
        table: 'libraryItems',
        id: 'x',
        payload: { id: 'x', name: 'server', url: 'https://new.example' },
        deleted: false,
        revision: '2',
      },
    ],
  ]);
  overlay(view, [
    {
      table: 'libraryItems',
      id: 'x',
      base: { id: 'x', name: 'old', url: 'https://old.example' },
      value: { id: 'x', name: 'local', url: 'https://old.example' },
    },
  ]);
  const pendingBefore = await db.syncOutbox.count();
  await db.transaction('rw',db.libraryItems,async () => {
    await db.libraryItems.put({id:'temporary'});
    await db.libraryItems.delete('temporary');
  });
  assert.equal(await db.syncOutbox.count(),pendingBefore);
  const desktop = { id:'wallpaperDesktop:test', value:{id:'test',selection:'daily'} };
  const desktopChanges = rowChanges({desktop:{table:'preferences',id:desktop.id,base:null,value:desktop}});
  const rejected = {changes:desktopChanges};
  const rebuilt = new Map();
  overlay(rebuilt, pendingDesktopChanges([rejected]));
  assert.deepEqual(denormalized([...rebuilt.values()]).preferences,[desktop]);
  assert.deepEqual(pendingDesktopChanges([{...rejected,resolvedAt:1}]),[]);
  const local = new Map([['libraryItems:x', {id:'x',name:'mine',url:'old'}]]);
  const change = {table:'libraryItems',id:'x',base:{id:'x',name:'base',url:'old'},value:{id:'x',name:'mine',url:'old'}};
  const cloud = {table:'libraryItems',id:'x',revision:'3',payload:{id:'x',name:'cloud',url:'new'},deleted:false};
  const projected = new Map([['libraryItems:x',cloud]]);
  preserveLocalConflict(projected,[change],local);
  assert.deepEqual(projected.get('libraryItems:x').payload,{id:'x',name:'mine',url:'new'});
  assert.equal(cloud.payload.name,'cloud');
  local.get('libraryItems:x').name='later';
  projected.set('libraryItems:x',{...cloud,payload:{...cloud.payload,name:'later'}});
  preserveLocalConflict(projected,[change],local);
  assert.equal(projected.get('libraryItems:x').payload.name,'later');
  preserveLocalConflict(projected,[{...change,value:null}],new Map());
  assert.equal(projected.size,0);
  assert.equal(view.get('libraryItems:x').payload.url, 'https://new.example');
  console.log(
    'PASS atomic capture, rollback, concurrent mutations, remote suppression, clear deletes, tab-level changes and pending overlay',
  );
} finally {
  await db.delete();
}
