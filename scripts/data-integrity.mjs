import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import ts from 'typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('work/data-audit', { recursive: true });
for (const name of ['library', 'grid-layout', 'grid-config', 'link-title']) {
  let source = await readFile(`src/features/library/${name}.ts`, 'utf8');
  source = source.replace(
    "import { database, type LibraryItem } from '../../shared/storage/database';",
    'const database = globalThis.__auditDb;',
  );
  source = source.replace(
    "import { webUrl } from '../workspace/collections';",
    `const webUrl = value => { try {const url=new URL(value);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;} };`,
  );
  source = source
    .replaceAll("'./grid-layout'", "'./grid-layout.mjs'")
    .replaceAll("'./grid-config'", "'./grid-config.mjs'")
    .replaceAll("'./link-title'", "'./link-title.mjs'");
  await writeFile(
    `work/data-audit/${name}.mjs`,
    ts.transpileModule(source, { compilerOptions: { target: 99, module: 99 } })
      .outputText,
  );
}
const db = new Dexie('data-audit-' + crypto.randomUUID());
db.version(1).stores({
  libraryItems: 'id,parent,pageId',
  libraryPages: 'id',
  widgetLayouts: 'id',
});
globalThis.__auditDb = db;
const api = await import('../work/data-audit/library.mjs');
const layout = await import('../work/data-audit/grid-layout.mjs');
try {
  const draft = {
    kind: 'link',
    name: '测试网址',
    url: 'https://example.com/',
    icon:
      'duoyu-icon:' +
      JSON.stringify({
        mode: 'upload',
        image: 'data:image/png;base64,AAAA',
        pictureFilter: '#ffffff',
        padding: 4,
      }),
    parent: '',
    pageId: 'p',
    width: 1,
    height: 1,
    gridX: 2,
    gridY: 3,
  };
  await api.saveLibraryItem(draft);
  let row = (await db.libraryItems.toArray())[0];
  const id = row.id;
  await api.saveLibraryItem({ ...draft, name: '已修改' }, id);
  assert.equal((await db.libraryItems.get(id)).name, '已修改');
  assert.equal((await db.libraryItems.get(id)).icon, draft.icon);
  await assert.rejects(
    api.saveLibraryItem({ ...draft, url: 'javascript:alert(1)' }, id),
  );
  assert.equal((await db.libraryItems.get(id)).url, draft.url);
  await api.saveLibraryItem({
    ...draft,
    kind: 'folder',
    name: '文件夹',
    url: '',
    icon: '',
  });
  const folder = (await db.libraryItems.toArray()).find(
    (x) => x.kind === 'folder',
  );
  await api.moveLibraryItem(id, folder.id);
  assert.equal((await db.libraryItems.get(id)).parent, folder.id);
  await api.deleteLibraryItem(folder.id);
  assert.equal((await db.libraryItems.get(id)).parent, '');
  assert.equal((await db.libraryItems.get(id)).icon, draft.icon);
  await api.resizeLibraryItem(id, 3, 2);
  row = await db.libraryItems.get(id);
  assert.equal(row.width, 3);
  assert.equal(row.height, 2);
  db.close();
  await db.open();
  assert.equal((await db.libraryItems.get(id)).name, '已修改');
  await api.deleteLibraryItem(id);
  await assert.rejects(api.saveLibraryItem(draft, id));
  assert.equal(await db.libraryItems.count(), 0);
  for (const value of [NaN, Infinity, -Infinity, 0, -2, 100]) {
    const size = layout.normalizeSize(value, value, 'folder');
    assert(
      Number.isFinite(size.width) && Number.isFinite(size.height),
      'non-finite layout dimensions',
    );
  }
  const malformed = layout.layoutLibraryItems(
    [
      { ...draft, id: 'fractional', gridX: 0.5, gridY: 0.5 },
      { ...draft, id: 'normal', gridX: 0, gridY: 0 },
    ],
    5,
  );
  assert.equal(malformed.items.length, 2);
  const slots = new Set();
  for (const entry of malformed.items) {
    assert(
      Number.isInteger(entry.x) && Number.isInteger(entry.y),
      'fractional grid coordinates',
    );
    const key = `${entry.x},${entry.y}`;
    assert(!slots.has(key));
    slots.add(key);
  }
  console.log(
    'PASS CRUD, validation rollback, upload metadata, folder deletion retaining children, resize, database reopen, deleted-item protection, malformed dimensions',
  );
} finally {
  await db.delete();
}
