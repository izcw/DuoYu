import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile('src/features/sync/JsonImportDialog.vue', 'utf8');
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
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const open = { value: true },
    watches = [],
    unmounts = [],
    plans = [],
    writes = [];
  const ref = (value) => ({ value });
  const state = new Function(
    'ref',
    'shallowRef',
    'computed',
    'watch',
    'onUnmounted',
    'defineModel',
    'planJsonImport',
    'commitJsonImport',
    'syncNow',
    'activeAccountKey',
    compiled +
      '\nreturn {file,input,plan,busy,error,done,includeSettings,preview,submit};',
  )(
    ref,
    ref,
    (read) => ({
      get value() {
        return read();
      },
    }),
    (target, callback) => watches.push({ target, callback }),
    (fn) => unmounts.push(fn),
    (name) => {
      assert.equal(
        name,
        'open',
        'Import dialog must match SettingsDialog v-model:open',
      );
      return open;
    },
    async (content, settings) => {
      const task = deferred();
      plans.push({ ...task, content, settings });
      return task.promise;
    },
    async (plan) => {
      const task = deferred();
      writes.push({ ...task, plan });
      return task.promise;
    },
    async () => {},
    () => 'fixture-account',
  );
  return {
    ...state,
    plans,
    writes,
    setOpen(value) {
      open.value = value;
      watches.find((w) => w.target === open).callback(value);
    },
    unmount() {
      unmounts.forEach((fn) => fn());
    },
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
{
  const s = fixture();
  s.file.value = { size: 20, text: async () => 'old-file' };
  const first = s.preview();
  await tick();
  s.setOpen(false);
  s.setOpen(true);
  s.plans[0].resolve({ digest: 'old', counts: {} });
  await first;
  assert.equal(
    s.plan.value,
    undefined,
    'closed preview reappeared in a fresh dialog',
  );
  assert.equal(s.busy.value, false);
}
{
  const s = fixture(),
    text = deferred();
  s.file.value = { size: 20, text: () => text.promise };
  s.includeSettings.value = true;
  const first = s.preview();
  s.includeSettings.value = false;
  text.resolve('selected-file');
  await tick();
  assert.equal(
    s.plans[0].settings,
    true,
    'file read changed the preview settings snapshot',
  );
  s.plans[0].resolve({ digest: 'current' });
  await first;
  assert.equal(s.plan.value.digest, 'current');
}
for (const fail of [false, true]) {
  const s = fixture();
  s.plan.value = { digest: 'submitted' };
  const write = s.submit();
  await tick();
  s.setOpen(false);
  s.setOpen(true);
  assert.equal(
    s.busy.value,
    true,
    'pending import no longer prevents duplicate submit',
  );
  if (fail) s.writes[0].reject(new Error('old import failed'));
  else s.writes[0].resolve();
  await write;
  assert.equal(
    s.done.value,
    false,
    'old import posted success to a fresh dialog',
  );
  assert.equal(s.error.value, '');
  assert.equal(s.busy.value, false);
}
{
  const s = fixture();
  s.file.value = { size: 20, text: async () => 'unmounted' };
  const job = s.preview();
  await tick();
  s.unmount();
  s.plans[0].resolve({ digest: 'stale' });
  await job;
  assert.equal(s.plan.value, undefined);
}
{
  const s = fixture();
  s.input.value = { value: 'same-file.json' };
  s.setOpen(false);
  s.setOpen(true);
  assert.equal(
    s.input.value.value,
    '',
    'same-file selection cannot trigger change after reopening',
  );
  s.plan.value = { digest: 'normal' };
  const job = s.submit();
  await tick();
  s.writes[0].resolve();
  await job;
  assert.equal(s.done.value, true);
  assert.equal(s.plan.value, undefined);
}
console.log(
  'PASS import dialog close/reopen, settings snapshot, old save success/failure, unmount, same-file selection and normal submit',
);
