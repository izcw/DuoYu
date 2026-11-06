import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the production component's async handlers with controllable transport.
// No rendered outcome is fabricated: the assertions inspect its actual ref state.
const source = await readFile('src/features/desktop/CloudCatalog.vue', 'utf8');
const script = source
  .split('<script setup lang="ts">')[1]
  .split('</script>')[0];
const compiled = ts
  .transpileModule(script, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    transformers: {
      before: [
        () => (root) =>
          ts.factory.updateSourceFile(
            root,
            root.statements.filter(
              (statement) => !ts.isImportDeclaration(statement),
            ),
          ),
      ],
    },
  })
  .outputText.replace(/export\s*\{\s*\};?/g, '')
  .replaceAll(
    'import.meta.env.VITE_SYNC_URL',
    JSON.stringify('https://catalog.test'),
  );
const props = { kind: 'widgets' };
const requests = [];
const dispose = [];
const rpc = (path) =>
  new Promise((resolve, reject) => requests.push({ path, resolve, reject }));
const state = new Function(
  'ref',
  'watch',
  'onUnmounted',
  'defineProps',
  'defineEmits',
  'useWallpaperSelection',
  'rpc',
  'syncNow',
  'planJsonImport',
  'commitJsonImport',
  compiled + '\nreturn {load,apply,rows,busy,error,message,chosen};',
)(
  (value) => ({ value }),
  () => {},
  (callback) => dispose.push(callback),
  () => props,
  () => () => {},
  () => ({ value: 'daily' }),
  rpc,
  async () => {},
  async () => {},
  async () => {},
);

const old = state.load();
props.kind = 'templates';
const fresh = state.load();
requests[1].resolve({ items: [{ id: 'current-template' }] });
await fresh;
requests[0].resolve({ items: [{ id: 'stale-widget' }] });
await old;
assert.deepEqual(
  state.rows.value,
  [{ id: 'current-template' }],
  'Old category response overwrote current rows',
);

props.kind = 'widgets';
const staleFailure = state.load();
assert.deepEqual(
  state.rows.value,
  [],
  'Previous-category rows must not remain actionable',
);
props.kind = 'templates';
const pending = state.load();
requests[2].reject(new Error('old request failed'));
await staleFailure;
assert.equal(
  state.busy.value,
  true,
  'Old failure cleared current loading state',
);
assert.equal(state.error.value, '');
requests[3].reject(new Error('current request failed'));
await pending;
assert.equal(state.error.value, 'current request failed');
assert.equal(state.busy.value, false);

const applying = state.apply({
  id: 'template',
  payload: { format: 'duoyu-template' },
});
props.kind = 'widgets';
const newCategory = state.load();
requests[4].resolve({});
await applying;
assert.equal(state.busy.value, true, 'Old apply cleared a new category load');
assert.equal(
  state.message.value,
  '',
  'Old apply posted success to another category',
);
requests[5].resolve({ items: [{ id: 'new-widget' }] });
await newCategory;

const unmounted = state.load();
dispose.forEach((callback) => callback());
requests[6].resolve({ items: [{ id: 'after-unmount' }] });
await unmounted;
assert.deepEqual(
  state.rows.value,
  [],
  'Unmounted request must not publish rows',
);
console.log(
  'PASS catalog out-of-order loads, obsolete errors, apply/category race and unmount isolation',
);
