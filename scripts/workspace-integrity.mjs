import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import Dexie from 'dexie';
import ts from 'typescript';

const db = new Dexie('workspace-integrity-' + crypto.randomUUID());
db.version(1).stores({
  workspaceSpaces: 'id,order',
  tabCollections: 'id,order,spaceId',
});
globalThis.workspaceTestDb = db;
after(() => db.delete());

async function moduleUrl(name, imports = {}) {
  const source = await readFile(`src/features/workspace/${name}.ts`, 'utf8');
  let js = ts.transpileModule(source, {
    compilerOptions: { target: 99, module: 99 },
  }).outputText;
  js = js.replace(
    /import \{ database,? \} from '..\/..\/shared\/storage\/database';/,
    'const database = globalThis.workspaceTestDb;',
  );
  for (const [path, url] of Object.entries(imports))
    js = js.replace(`'${path}'`, JSON.stringify(url));
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
}
const spacesUrl = await moduleUrl('spaces');
const spaces = await import(spacesUrl);
const groups = await import(
  await moduleUrl('collections', { './spaces': spacesUrl })
);
const row = (id, spaceId, order) => ({
  id,
  name: id,
  spaceId,
  order,
  tabs: [],
  updatedAt: 1,
});
async function reset() {
  await db.tabCollections.clear();
  await db.workspaceSpaces.clear();
}
test('empty signed-in space supports first collection but rejects a deleted target', async () => {
  await reset();
  await assert.rejects(groups.createCollection('', [], 'removed'));
  const id = await groups.createCollection('', [], '');
  assert.equal((await db.tabCollections.get(id)).spaceId, 'default');
  assert.ok(await db.workspaceSpaces.get('default'));
});
test('deleting a populated custom space leaves a navigable destination', async () => {
  await reset();
  await db.workspaceSpaces.put({ id: 'custom', name: 'Custom', order: 1 });
  await db.tabCollections.put(row('group', 'custom', 1));
  await spaces.deleteSpace('custom');
  assert.equal((await db.tabCollections.get('group')).spaceId, 'default');
  assert.ok(await db.workspaceSpaces.get('default'));
  assert.equal(await db.workspaceSpaces.get('custom'), undefined);
});
test('opening an old signed-in database repairs stranded default collections and preserves empty accounts', async () => {
  for (const spaceId of ['default', undefined]) {
    await reset();
    await spaces.ensureDefaultSpace();
    assert.equal(await db.workspaceSpaces.count(), 0);
    const original = row('old-group', spaceId, 3);
    await db.tabCollections.add(original);
    await spaces.ensureDefaultSpace();
    await spaces.ensureDefaultSpace();
    assert.equal(await db.workspaceSpaces.count(), 1);
    assert.ok(await db.workspaceSpaces.get('default'));
    assert.deepEqual(await db.tabCollections.get('old-group'), original);
  }
});
test('space reorder rejects stale and duplicate lists atomically', async () => {
  await reset();
  await db.workspaceSpaces.bulkPut([
    { id: 'a', order: 1 },
    { id: 'b', order: 0 },
  ]);
  await assert.rejects(spaces.orderSpaces(['a']));
  await assert.rejects(spaces.orderSpaces(['a', 'a']));
  assert.equal((await db.workspaceSpaces.get('a')).order, 1);
  await spaces.orderSpaces(['a', 'b']);
  assert.equal((await db.workspaceSpaces.get('b')).order, 1);
});
test('group reorder preserves other spaces, legacy default rows and stale destinations', async () => {
  await reset();
  await db.tabCollections.bulkPut([
    row('a', undefined, 2),
    row('b', 'other', 5),
    row('c', 'default', 7),
  ]);
  await groups.reorderCollection('c', 'a', 'default');
  assert.equal((await db.tabCollections.get('b')).order, 5);
  assert.deepEqual(
    (await db.tabCollections.orderBy('order').toArray()).map((g) => g.id),
    ['c', 'b', 'a'],
  );
  await assert.rejects(groups.reorderCollection('b', undefined, 'default'));
  await assert.rejects(groups.reorderCollection('c', 'b', 'default'));
});
test('stale tab moves and renames fail without changing surviving rows', async () => {
  await reset();
  const from = {
    ...row('a', 'x', 0),
    tabs: [{ id: 'one', url: 'https://example.org/' }],
  };
  const to = row('b', 'x', 1);
  await db.tabCollections.bulkPut([from, to]);
  await assert.rejects(groups.moveSavedTab('a', 'removed', 'b'));
  await assert.rejects(groups.moveSavedTab('a', 'one', 'b', 'removed'));
  await assert.rejects(groups.renameCollection('removed', 'changed'));
  assert.deepEqual(await db.tabCollections.bulkGet(['a', 'b']), [from, to]);
});
test('undo recovers deleted content when the original space also disappeared', async () => {
  await reset();
  const original = row('a', 'custom', 4);
  await db.tabCollections.put(original);
  const saved = await groups.removeCollection('a');
  assert.equal(await db.tabCollections.get('a'), undefined);
  await groups.restoreCollection(saved);
  assert.deepEqual(await db.tabCollections.get('a'), {
    ...original,
    spaceId: 'default',
  });
  assert.ok(await db.workspaceSpaces.get('default'));
  await assert.rejects(groups.restoreCollection(saved));
});
test('a concurrent edit committed before deletion is included in the undo snapshot', async () => {
  await reset();
  await db.tabCollections.put(row('a', 'default', 0));
  const peer = new Dexie(db.name);
  await peer.open();
  try {
    let read;
    const locked = new Promise((resolve) => {
      read = resolve;
    });
    const saving = peer.transaction(
      'rw',
      peer.table('tabCollections'),
      async () => {
        const table = peer.table('tabCollections');
        const group = await table.get('a');
        read();
        group.tabs.push({ id: 'peer-tab', url: 'https://example.org/' });
        await table.put(group);
      },
    );
    await locked;
    const [snapshot] = await Promise.all([
      groups.removeCollection('a'),
      saving,
    ]);
    await groups.restoreCollection(snapshot);
    assert.equal((await db.tabCollections.get('a')).tabs[0].id, 'peer-tab');
  } finally {
    peer.close();
  }
});
