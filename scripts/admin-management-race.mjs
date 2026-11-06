import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function component(name = 'Manage') {
  const source = await readFile(
    `../DuoYu-Backend/admin/src/${name}.vue`,
    'utf8',
  );
  const compiled = ts
    .transpileModule(
      source.split('<script setup lang="ts">')[1].split('</script>')[0],
      {
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
      },
    )
    .outputText.replace(/export\s*\{\s*\};?/g, '');
  const requests = [],
    dispose = [],
    confirms = [],
    messages = [],
    navigation = [];
  const route = {
    params: { section: 'wallpapers', id: 'alpha' },
    query: {},
    fullPath: '/wallpapers/alpha',
  };
  const bindings = {
    ref: (value) => ({ value }),
    computed: (fn) => ({
      get value() {
        return typeof fn === 'function' ? fn() : fn.get();
      },
    }),
    watch() {},
    onMounted() {},
    onUnmounted: (fn) => dispose.push(fn),
    useRoute: () => route,
    useRouter: () => ({ push: async (path) => navigation.push(path) }),
    onBeforeRouteLeave() {},
    onBeforeRouteUpdate() {},
    api: (url, body, method) =>
      new Promise((resolve, reject) =>
        requests.push({ url, body, method, resolve, reject }),
      ),
    fetch: (url, options) =>
      new Promise((resolve, reject) =>
        requests.push({ url, options, resolve, reject }),
      ),
    ElMessage: {
      success: (text) => messages.push(text),
      error: (text) => messages.push(text),
    },
    ElMessageBox: {
      confirm: () => new Promise((resolve) => confirms.push(resolve)),
    },
    session: { csrf: 'fixture' },
    pageName: (s) => s,
    size: String,
    date: String,
    window: { addEventListener() {}, removeEventListener() {} },
    nextTick: async () => {},
    echarts: {
      use() {},
      init() {
        throw Error('Unexpected chart initialization');
      },
    },
    LineChart: {},
    GridComponent: {},
    TooltipComponent: {},
    LegendComponent: {},
    CanvasRenderer: {},
  };
  const returned =
    name === 'Manage'
      ? 'load,form,configText,upload,uploadPreview,busy,error,dirty,defaultTemplate,remove,deleteUserFile,save,items'
      : 'load,stats,busy,error';
  const state = new Function(
    ...Object.keys(bindings),
    compiled + '\nreturn {' + returned + '};',
  )(...Object.values(bindings));
  return { state, requests, dispose, confirms, messages, navigation, route };
}
const payload = (url) => ({
  items: [{ name: url, payload: { url }, version: 1 }],
});
async function uploadRoute() {
  const h = await component();
  h.state.configText.value = JSON.stringify({ url: 'alpha' });
  const old = h.state.upload({
    target: { files: [new Blob(['image'])], value: 'file' },
  });
  h.route.fullPath = '/wallpapers/beta';
  h.route.params.id = 'beta';
  const fresh = h.state.load();
  h.requests[1].resolve(payload('beta'));
  await fresh;
  h.requests[0].resolve({
    ok: true,
    json: async () => ({ url: 'alpha-upload' }),
  });
  await old;
  assert.equal(
    JSON.parse(h.state.configText.value).url,
    'beta',
    'Old upload changed another wallpaper',
  );
  assert.equal(h.state.dirty.value, false);
  h.dispose.forEach((fn) => fn());
}
async function unmountedLoad() {
  const h = await component();
  const pending = h.state.load();
  h.dispose.forEach((fn) => fn());
  h.requests[0].resolve(payload('late'));
  await pending;
  assert.notEqual(
    h.state.form.value.name,
    'late',
    'Unmounted loader committed data',
  );
}
async function defaultRace() {
  const h = await component();
  h.route.params = { section: 'templates', id: '' };
  h.route.fullPath = '/templates';
  const old = h.state.load();
  h.requests[0].resolve({ items: [] });
  await Promise.resolve();
  const fresh = h.state.load();
  h.requests[2].resolve({ items: [] });
  await Promise.resolve();
  h.requests[3].resolve({
    items: [{ id: 'default_template_id', value: 'fresh' }],
  });
  await fresh;
  h.requests[1].resolve({
    items: [{ id: 'default_template_id', value: 'stale' }],
  });
  await old;
  assert.equal(
    h.state.defaultTemplate.value,
    'fresh',
    'Old default template request overwrote current state',
  );
}
async function deleteContext() {
  for (const file of [false, true]) {
    const h = await component();
    h.route.params = { section: file ? 'users' : 'wallpapers', id: 'alpha' };
    const pending = file
      ? h.state.deleteUserFile({ sha256: 'hash' })
      : h.state.remove({ name: 'Alpha', id: 'shared', version: 1 });
    h.route.params = { section: 'widgets', id: 'beta' };
    h.route.fullPath = '/widgets/beta';
    h.confirms[0]();
    await Promise.resolve();
    await Promise.resolve();
    const mutation = h.requests[0];
    if (mutation) {
      mutation.resolve({});
      await Promise.resolve();
      h.requests[1]?.resolve({ items: [] });
    }
    await pending;
    assert.ok(
      !mutation ||
        mutation.url.startsWith(file ? 'users/alpha/' : 'catalog/wallpapers/'),
      'Confirmation deleted a different route target',
    );
  }
}
async function saveContext() {
  const h = await component();
  h.state.form.value = { name: 'Alpha', version: 1 };
  h.state.configText.value = '{}';
  const pending = h.state.save();
  h.route.fullPath = '/wallpapers/beta';
  h.route.params.id = 'beta';
  const fresh = h.state.load();
  h.requests[1].resolve(payload('beta'));
  await fresh;
  h.state.dirty.value = true;
  h.requests[0].resolve({});
  await pending;
  assert.equal(
    h.state.dirty.value,
    true,
    'Old save cleared a new form dirty flag',
  );
  assert.deepEqual(
    h.navigation,
    [],
    'Old save navigated away from current editing',
  );
}
async function dashboardRace() {
  const h = await component('Dashboard');
  const old = h.state.load();
  const fresh = h.state.load();
  h.requests[2].resolve({ users: 2 });
  h.requests[3].resolve({ items: [] });
  await fresh;
  h.requests[0].resolve({ users: 1 });
  h.requests[1].resolve({ items: [] });
  await old;
  assert.equal(
    h.state.stats.value.users,
    2,
    'Old dashboard refresh replaced current statistics',
  );
  const pending = h.state.load();
  h.dispose.forEach((fn) => fn());
  h.requests[4].resolve({ users: 3 });
  h.requests[5].resolve({ items: [] });
  await pending;
  assert.equal(
    h.state.stats.value.users,
    2,
    'Unmounted dashboard committed data',
  );
}
async function failureAndRecovery() {
  const h = await component();
  const old = h.state.load(),
    fresh = h.state.load();
  h.requests[0].reject(Error('stale error'));
  await old;
  assert.equal(h.state.busy.value, true);
  assert.equal(h.state.error.value, '');
  h.requests[1].reject(Error('current error'));
  await fresh;
  assert.equal(h.state.busy.value, false);
  assert.equal(h.state.error.value, 'current error');
  assert.deepEqual(h.state.form.value, {});
  await h.state.save();
  assert.equal(
    h.requests.length,
    2,
    'Loading failure must not permit saving stale data',
  );
  const recovered = h.state.load();
  h.requests[2].resolve(payload('recovered'));
  await recovered;
  const save = h.state.save();
  h.requests[3].resolve({});
  await save;
  assert.deepEqual(h.navigation, ['/wallpapers']);
  assert.equal(h.state.dirty.value, false);
}
async function currentDelete() {
  const h = await component();
  const pending = h.state.remove({ id: 'alpha', name: 'Alpha', version: 2 });
  h.confirms[0]();
  await Promise.resolve();
  assert.equal(h.requests[0].url, 'catalog/wallpapers/alpha?version=2');
  assert.equal(h.requests[0].method, 'DELETE');
  h.requests[0].resolve({});
  await Promise.resolve();
  h.requests[1].resolve({ items: [] });
  await pending;
  assert.ok(h.messages.includes('已删除'));
}
const failures = [];
for (const test of [
  uploadRoute,
  unmountedLoad,
  defaultRace,
  deleteContext,
  saveContext,
  dashboardRace,
  failureAndRecovery,
  currentDelete,
]) {
  try {
    await test();
    console.log('PASS ' + test.name);
  } catch (error) {
    failures.push(error);
    console.error(error.message);
  }
}
if (failures.length)
  throw new AggregateError(
    failures,
    'Business management async isolation failed',
  );
