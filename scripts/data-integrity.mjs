import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import ts from 'typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
await mkdir('work/data-audit', { recursive: true });
for (const name of [
  'library',
  'pages',
  'grid-layout',
  'grid-config',
  'link-title',
  'home-grid',
  'widget-links',
  'account',
]) {
  const folder =
    name === 'account'
      ? 'src/shared/storage'
      : ['home-grid', 'widget-links'].includes(name)
        ? 'src/features/desktop'
        : 'src/features/library';
  let source = await readFile(`${folder}/${name}.ts`, 'utf8');
  source = source.replace(
    "import { database } from '../../shared/storage/database';",
    'const database = globalThis.__auditDb;',
  );
  source = source.replace(
    "import { database, type LibraryItem } from '../../shared/storage/database';",
    'const database = globalThis.__auditDb;',
  );
  source = source.replace(
    "import { webUrl } from '../workspace/collections';",
    `const webUrl = value => { try {const url=new URL(value);return /^https?:$/.test(url.protocol)?url.href:null;}catch{return null;} };`,
  );
  source = source
    .replace("'../../shared/storage/account'", "'./account.mjs'")
    .replace("'./widget-links'", "'./widget-links.mjs'")
    .replace("'../library/grid-config'", "'./grid-config.mjs'")
    .replace("'./pages'", "'./pages.mjs'")
    .replace("'../../shared/response-body'", "'./response-body.mjs'")
    .replaceAll("'./grid-layout'", "'./grid-layout.mjs'")
    .replaceAll("'./grid-config'", "'./grid-config.mjs'")
    .replaceAll("'./link-title'", "'./link-title.mjs'");
  await writeFile(
    `work/data-audit/${name}.mjs`,
    ts.transpileModule(source, { compilerOptions: { target: 99, module: 99 } })
      .outputText,
  );
}
await writeFile(
  'work/data-audit/response-body.mjs',
  ts.transpileModule(await readFile('src/shared/response-body.ts', 'utf8'), {
    compilerOptions: { target: 99, module: 99 },
  }).outputText,
);
const db = new Dexie('data-audit-' + crypto.randomUUID());
db.version(1).stores({
  libraryItems: 'id,parent,pageId',
  libraryPages: 'id',
  widgetLayouts: 'id',
});
globalThis.__auditDb = db;
let account = '';
globalThis.localStorage = { getItem: () => account };
const { guardAccountWrites } = await import('../work/data-audit/account.mjs');
guardAccountWrites(db);
const api = await import('../work/data-audit/library.mjs');
const { ensureHomeGrid } = await import('../work/data-audit/home-grid.mjs');
const { orderLibraryPages } = await import('../work/data-audit/pages.mjs');
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
  await db.libraryPages.put({ id: 'p', name: '测试页', order: 0 });
  await ensureHomeGrid();
  assert.equal(
    await db.widgetLayouts.get('home-grid-v1'),
    undefined,
    'guest defaults entered a non-guest database',
  );
  account = 'another-account';
  await assert.rejects(api.saveLibraryItem(draft), /账号已切换/);
  account = '';
  await assert.rejects(
    db.transaction('rw', db.libraryPages, async () => {
      await db.libraryPages.add({ id: 'first' });
      account = 'another-account';
      await db.libraryPages.add({ id: 'second' });
    }),
  );
  account = '';
  assert.equal(await db.libraryPages.get('first'), undefined);
  await assert.rejects(
    api.saveLibraryItem({ ...draft, pageId: 'deleted' }),
    /收藏页/,
  );
  await api.saveLibraryItem({ ...draft, pageId: 'home' });
  await db.libraryItems.where('pageId').equals('home').delete();
  await api.saveLibraryItem(draft);
  let row = (await db.libraryItems.toArray())[0];
  const id = row.id;
  await db.libraryPages.add({ id: 'elsewhere', order: 1 });
  await assert.rejects(orderLibraryPages(['p']), /重新排序/);
  await assert.rejects(orderLibraryPages(['p', 'p']), /重新排序/);
  await orderLibraryPages(['elsewhere', 'p']);
  assert.equal((await db.libraryPages.get('p')).order, 1);
  await db.libraryItems.update(id, { pageId: 'elsewhere' });
  await assert.rejects(api.saveLibraryItem(draft, id), /移至其他收藏页/);
  assert.equal((await db.libraryItems.get(id)).pageId, 'elsewhere');
  await db.libraryItems.update(id, { pageId: 'p' });
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
  const malformedBounds = {
    minWidth: 1,
    maxWidth: 1e8,
    minHeight: 0,
    maxHeight: 0,
  };
  assert.deepEqual(layout.normalizeSize(12, 0, 'widget', malformedBounds), {
    width: 9,
    height: 1,
  });
  assert.deepEqual(
    layout.normalizeSize(1, 1, 'widget', {
      minWidth: 2,
      maxWidth: 6,
      minHeight: 2,
      maxHeight: 4,
    }),
    { width: 2, height: 2 },
  );
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
