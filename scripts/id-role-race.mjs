import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(
  '../DuoYu-ID/admin/src/views/duoyu/project-roles/index.vue',
  'utf8',
);
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
            root.statements.filter((s) => !ts.isImportDeclaration(s)),
          ),
      ],
    },
  })
  .outputText.replace(/export\s*\{\s*\};?/g, '');
const route = {
  query: { id: 'alpha', role: 'editor' },
  path: '/manage/apps/roles/edit',
  fullPath: '/alpha',
};
const requests = [],
  disposers = [];
const bindings = {
  api: (url) =>
    new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
  ref: (value) => ({ value }),
  computed: (fn) => ({
    get value() {
      return fn();
    },
  }),
  watch() {},
  useRoute: () => route,
  useRouter: () => ({ push() {} }),
  onBeforeRouteLeave() {},
  onBeforeRouteUpdate() {},
  onBeforeUnmount: (fn) => disposers.push(fn),
  window: { addEventListener() {}, removeEventListener() {} },
  ElMessage: { success() {}, error() {} },
  ElMessageBox: { confirm: async () => {} },
};
const state = new Function(
  ...Object.keys(bindings),
  compiled +
    '\nreturn {load,roles,appName,form,loading,error,member,selectedRole};',
)(...Object.values(bindings));
const resolvePair = (offset, label) => {
  requests[offset].resolve([{ name: label }]);
  requests[offset + 1].resolve([
    {
      id: 'editor',
      name: label,
      role_key: 'editor',
      description: label,
      is_default: true,
    },
  ]);
};
const old = state.load();
route.query.id = 'beta';
route.fullPath = '/beta';
const current = state.load();
resolvePair(2, 'Beta');
await current;
resolvePair(0, 'Alpha');
await old;
assert.equal(
  state.appName.value,
  'Beta',
  'Old project response replaced the current project',
);
assert.equal(state.form.value.name, 'Beta');

const stale = state.load();
route.query.id = 'gamma';
route.fullPath = '/gamma';
const pending = state.load();
requests[4].reject(new Error('outdated failure'));
requests[5].resolve([]);
await stale;
assert.equal(
  state.loading.value,
  true,
  'Old request cleared current loading state',
);
assert.equal(state.error.value, '');
resolvePair(6, 'Gamma');
await pending;

route.path = '/manage/apps/member-role';
route.query.user = 'user-a';
const memberOld = state.load();
resolvePair(8, 'Gamma');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(requests.length, 11);
route.path = '/manage/apps/roles/edit';
route.query.id = 'delta';
route.fullPath = '/delta';
const editorNew = state.load();
resolvePair(11, 'Delta');
await editorNew;
requests[10].resolve({ items: [{ id: 'user-a', role_id: 'outdated' }] });
await memberOld;
assert.notEqual(
  state.selectedRole.value,
  'outdated',
  'Old membership request polluted another route',
);
assert.equal(state.appName.value, 'Delta');

const unmounted = state.load();
disposers.forEach((fn) => fn());
resolvePair(13, 'After unmount');
await unmounted;
assert.equal(state.appName.value, 'Delta');
console.log(
  'PASS ID project role request ordering, stale failure, member navigation and unmount isolation',
);
