import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = ts.transpileModule(await readFile('src/features/library/page-drag.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport /g, '');
const ids = ['duoyu-home', 'duoyu-workspace', 'a', 'b'];
const dock = { querySelectorAll: () => ids.map(id => ({ dataset: { dockId: id } })) };
const rows = new Map([['folder', { id: 'folder', kind: 'folder', pageId: 'home', width: 3 }], ['child', { id: 'child', parent: 'folder', pageId: 'home' }]]);
let order;
const database = {
  transaction: async (...args) => args.at(-1)(),
  preferences: { put: async row => { order = row.value; } },
  libraryItems: {
    get: async id => rows.get(id),
    update: async (id, changes) => Object.assign(rows.get(id), changes),
    where: () => ({ equals: parent => ({ modify: async changes => { for (const row of rows.values()) if (row.parent === parent) Object.assign(row, changes); } }) }),
  },
};
const api = new Function('ref', 'database', 'document', 'accountStorage', 'window', source + `
return { finish, dockIncomingItemId, dockInsertBeforeId, prepare() {
 session = { id: 'folder', source: 'home', dockEligible: true, ghost: { remove() {} }, original: { style: {} }, originalVisibility: '' };
 dockIncomingItemId.value = 'folder'; dockInsertBeforeId.value = 'b';
}};`)(value => ({ value }), database, { elementFromPoint: () => ({ closest: () => dock }) }, { setItem() {} }, { dispatchEvent() {} });
api.prepare();
await api.finish({ isTrusted: true, clientX: 1, clientY: 1 });
assert.deepEqual(order, ['duoyu-home', 'duoyu-workspace', 'a', 'folder', 'b']);
assert.equal(rows.get('folder').pageId, '__dock');
assert.equal(rows.get('folder').width, 3, 'desktop dimensions remain intact');
assert.equal(rows.get('child').pageId, '__dock');
assert.equal(rows.get('child').parent, 'folder');
assert.equal(api.dockIncomingItemId.value, '');
console.log('PASS folder and children transfer, insertion order, dimension preservation, placeholder cleanup');
