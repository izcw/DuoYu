import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';
import { reactive, isProxy } from 'vue';
await mkdir('work/conflict-preview-test', { recursive: true });
for (const [name, source] of [
  ['grid-config', 'src/features/library/grid-config.ts'],
  ['grid-layout', 'src/features/library/grid-layout.ts'],
  ['model', 'src/features/sync/model.ts'],
  ['preview', 'src/features/sync/conflict-preview.ts'],
]) {
  let code = ts.transpileModule(await readFile(source, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  code = code.replace(
    /(['"])(?:\.\/|\.\.\/library\/)(grid-config|grid-layout)\1/g,
    (_, q, file) => q + './' + file + '.mjs' + q,
  );
  await writeFile('work/conflict-preview-test/' + name + '.mjs', code);
}
const {
  prepareLocalPreview,
  previewResolutionChanges,
  previewVersion,
  previewItems,
  previewPages,
} = await import('../work/conflict-preview-test/preview.mjs');
const { snapshotValue } =
  await import('../work/conflict-preview-test/model.mjs');
const item = (id, x) => ({
  table: 'libraryItems',
  id,
  payload: {
    id,
    kind: 'link',
    name: id,
    url: 'https://example.com',
    icon: '',
    parent: '',
    pageId: 'home',
    width: 1,
    height: 1,
    gridX: x,
    gridY: 0,
  },
  deleted: false,
  revision: '1',
});
const shadow = [item('local', 0), item('cloud', 1)],
  original = structuredClone(shadow),
  change = {
    table: 'libraryItems',
    id: 'local',
    base: shadow[0].payload,
    value: { ...shadow[0].payload, gridX: 1, name: '本机' },
    revision: '1',
  };
const prepared = prepareLocalPreview(shadow, [change]);
assert.equal(prepared.overflow, 0);
assert.equal(prepared.entities.find((e) => e.id === 'local').payload.gridX, 1);
assert.equal(prepared.entities.find((e) => e.id === 'cloud').payload.gridX, 0);
assert.deepEqual(shadow, original, 'preview must never mutate cloud state');
const changes = previewResolutionChanges(shadow, [change], prepared.entities);
assert.equal(
  changes.length,
  2,
  'displaced cloud items must be included in the chosen version',
);
assert.equal(changes.find((e) => e.id === 'cloud').revision, '1');
const deleted = previewVersion(shadow, [{ ...change, value: null }], true);
assert.equal(deleted.length, 1);
assert.equal(previewVersion(shadow, [change], false)[0].payload.name, 'local');
const full = Array.from({ length: 80 }, (_, i) => {
  const e = item(String(i), i % 16);
  e.payload.gridY = Math.floor(i / 16);
  return e;
});
const extra = item('extra', 0);
assert.equal(
  prepareLocalPreview(full, [
    { ...change, id: 'extra', base: null, value: extra.payload },
  ]).overflow,
  1,
);
const folder = {
  ...item('folder', 2),
  payload: { ...item('folder', 2).payload, kind: 'folder', name: '文件夹' },
};
const child = {
  ...item('child', 0),
  payload: { ...item('child', 0).payload, parent: 'folder' },
};
assert(previewPages([[folder, child]]).some((p) => p.id === 'folder:folder'));
assert.equal(
  previewItems([folder, child], 'folder:folder').items[0].parent,
  '',
);
const blob = new Blob(['image'], { type: 'image/png' }),
  safe = snapshotValue(reactive({ nested: { name: 'name' }, blob }));
assert(!isProxy(safe.nested));
assert.equal(safe.blob, blob);
structuredClone(safe);
console.log(
  'PASS shared desktop placement, preferred local layout and displaced-item resolution, cloud immutability, deletion, overflow, folder browsing and IndexedDB-safe preview snapshots',
);
