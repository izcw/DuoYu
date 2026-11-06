import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function component(name, route, returned) {
  const source = await readFile(
    `../DuoYu-ID/admin/src/views/duoyu/${name}/index.vue`,
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
    navigation = [],
    confirms = [];
  const bindings = {
    api: (url, method, data) =>
      new Promise((resolve, reject) =>
        requests.push({ url, method, data, resolve, reject }),
      ),
    fetch: (url) =>
      new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
    ref: (value) => ({ value }),
    computed: (fn) => ({
      get value() {
        return fn();
      },
    }),
    watch() {},
    useRoute: () => route,
    useRouter: () => ({ push: async (target) => navigation.push(target) }),
    onBeforeRouteLeave() {},
    onMounted() {},
    onBeforeRouteUpdate() {},
    onBeforeUnmount: (fn) => dispose.push(fn),
    window: { addEventListener() {}, removeEventListener() {} },
    location: { origin: 'https://fixture.test' },
    ElMessage: { success() {}, error() {} },
    ElMessageBox: {
      confirm: () => new Promise((resolve) => confirms.push(resolve)),
    },
    copyDuoyuText() {},
  };
  const state = new Function(
    ...Object.keys(bindings),
    compiled + '\nreturn {' + returned + '};',
  )(...Object.values(bindings));
  return { state, requests, dispose, navigation, confirms };
}

async function keys() {
  const route = {
    path: '/manage/project-api/edit',
    fullPath: '/alpha',
    query: { id: 'alpha' },
  };
  const { state, requests, dispose } = await component(
    'project-api',
    route,
    'load,form,loading,error',
  );
  const key = (name) => ({
    id: 'beta',
    name,
    scopes: ['projects:read'],
    all_projects: false,
    app_ids: [],
    expires_at: null,
  });
  const old = state.load();
  route.query.id = 'beta';
  route.fullPath = '/beta';
  const fresh = state.load();
  requests[2].resolve([key('Current')]);
  requests[3].resolve([]);
  await fresh;
  requests[0].resolve([key('Stale')]);
  requests[1].resolve([]);
  await old;
  assert.equal(
    state.form.value.name,
    'Current',
    'Stale developer-key response replaced edited permissions',
  );
  const staleFailure = state.load();
  const pending = state.load();
  requests[4].reject(new Error('old failure'));
  requests[5].resolve([]);
  await staleFailure;
  assert.equal(state.loading.value, true);
  assert.equal(state.error.value, '');
  requests[6].resolve([key('Latest')]);
  requests[7].resolve([]);
  await pending;
  const stopped = state.load();
  dispose.forEach((fn) => fn());
  requests[8].resolve([key('After unmount')]);
  requests[9].resolve([]);
  await stopped;
  assert.equal(
    state.form.value.name,
    '',
    'Unmounted key loader must not commit a response',
  );
}

async function logo() {
  const route = {
    path: '/manage/apps/edit',
    fullPath: '/alpha',
    query: { id: 'alpha' },
  };
  const { state, requests, dispose } = await component(
    'editor',
    route,
    'load,form,uploadLogo,logoUploading,checkApp,checks',
  );
  state.form.value = { name: 'Alpha', logo: '/project-logos/alpha.png' };
  const upload = state.uploadLogo({
    raw: new Blob(['fixture'], { type: 'image/png' }),
  });
  route.query.id = 'beta';
  route.fullPath = '/beta';
  const fresh = state.load();
  requests[1].resolve([{ name: 'Beta', logo: '/project-logos/beta.png' }]);
  await fresh;
  requests[0].resolve({ logo: '/project-logos/alpha-upload.png' });
  await upload;
  assert.equal(
    state.form.value.logo,
    '/project-logos/beta.png',
    'Old logo upload replaced a different project logo',
  );
  const oldCheck = state.checkApp();
  route.query.id = 'gamma';
  route.fullPath = '/gamma';
  const current = state.load();
  requests[3].resolve([{ name: 'Gamma', logo: '/project-logos/gamma.png' }]);
  await current;
  requests[2].resolve({ checks: ['Alpha configuration'] });
  await oldCheck;
  assert.deepEqual(
    state.checks.value,
    [],
    'Configuration checks belong to their source project',
  );
  const stopped = state.uploadLogo({ raw: new Blob(['fixture']) });
  dispose.forEach((fn) => fn());
  requests[4].resolve({ logo: '/project-logos/after-unmount.png' });
  await stopped;
  assert.equal(state.form.value.logo, '/project-logos/gamma.png');
}

const failures = [];
async function preview() {
  const { state, requests, dispose } = await component(
    'settings',
    {},
    'preview,html,purpose',
  );
  const response = (text) => ({ ok: true, text: async () => text });
  const old = state.preview();
  state.purpose.value = 'email';
  const fresh = state.preview();
  requests[1].resolve(response('Email preview'));
  await fresh;
  requests[0].resolve(response('Old login preview'));
  await old;
  assert.equal(
    state.html.value,
    'Email preview',
    'Old mail preview replaced the selected purpose',
  );
  const failure = state.preview();
  requests[2].resolve({ ok: false, status: 503 });
  await failure;
  assert.equal(
    state.html.value,
    '',
    'Failed purpose must not keep the previous preview',
  );
  const stopped = state.preview();
  dispose.forEach((fn) => fn());
  requests[3].resolve(response('After unmount'));
  await stopped;
  assert.equal(state.html.value, '');
}
async function mutations() {
  for (const [name, action, route] of [
    [
      'project-api',
      'create',
      {
        path: '/manage/project-api/edit',
        fullPath: '/alpha',
        query: { id: 'alpha' },
      },
    ],
    [
      'editor',
      'save',
      { path: '/manage/apps/edit', fullPath: '/alpha', query: { id: 'alpha' } },
    ],
    [
      'project-roles',
      'save',
      {
        path: '/manage/apps/roles/edit',
        fullPath: '/alpha',
        query: { id: 'alpha', role: 'role-a' },
      },
    ],
  ]) {
    const h = await component(
      name,
      route,
      `${action},form,loading,saving,baseline`,
    );
    h.state.loading.value = false;
    h.state.form.value = {
      name: 'Alpha',
      logo: '/project-logos/alpha.png',
      redirectText: 'https://fixture.test/callback',
      logoutText: '',
      originText: '',
    };
    const pending = h.state[action]();
    assert.equal(
      h.requests.length,
      1,
      name + ': mutation should issue its request',
    );
    route.fullPath = '/beta';
    route.query.id = 'beta';
    h.state.form.value = { name: 'Beta' };
    h.state.baseline.value = 'Beta baseline';
    h.state.saving.value = true;
    h.requests[0].resolve({});
    await pending;
    assert.equal(
      h.state.baseline.value,
      'Beta baseline',
      name + ': old mutation cleared current dirty state',
    );
    assert.equal(
      h.state.saving.value,
      true,
      name + ': old mutation reset another request state',
    );
    assert.deepEqual(h.navigation, [], name + ': old mutation navigated away');
    h.state.saving.value = false;
    h.state.form.value = {
      name: 'Beta',
      logo: '/project-logos/beta.png',
      redirectText: 'https://fixture.test/callback',
      logoutText: '',
      originText: '',
    };
    const rejected = h.state[action]();
    route.fullPath = '/gamma';
    h.state.saving.value = true;
    h.requests[1].reject(Error('old mutation failed'));
    await rejected;
    assert.equal(
      h.state.saving.value,
      true,
      name + ': old failure reset current saving',
    );
    h.state.saving.value = false;
    const stopped = h.state[action]();
    h.dispose.forEach((fn) => fn());
    h.requests[2].resolve({});
    await stopped;
    assert.deepEqual(h.navigation, [], name + ': unmounted write navigated');
    console.log('PASS ' + name + ' stale write success/failure/unmount');
  }
}
async function lateConfirmation() {
  const route = {
    path: '/manage/apps/roles/edit',
    fullPath: '/alpha',
    query: { id: 'alpha', role: 'role-a' },
  };
  const h = await component('project-roles', route, 'remove,loading');
  h.state.loading.value = false;
  const pending = h.state.remove();
  route.fullPath = '/beta';
  route.query.id = 'beta';
  route.query.role = 'role-b';
  h.confirms[0]();
  await Promise.resolve();
  await Promise.resolve();
  if (h.requests[0]) h.requests[0].resolve({});
  await pending;
  assert.equal(
    h.requests.length,
    0,
    'Old role confirmation must not delete a new route target',
  );
}
async function rotationContext() {
  for (const name of ['project-api', 'editor']) {
    const route = {
      path: name === 'editor' ? '/manage/apps/edit' : '/manage/project-api',
      fullPath: '/alpha',
      query: { id: 'alpha' },
    };
    const h = await component(name, route, 'rotate,loading,saving,secret');
    h.state.loading.value = false;
    const pending = h.state.rotate({ id: 'alpha' });
    h.confirms[0]();
    await Promise.resolve();
    assert.equal(h.requests.length, 1);
    route.fullPath = '/beta';
    h.state.saving.value = true;
    h.requests[0].resolve({ secret: 'fixture-only' });
    await pending;
    assert.equal(
      h.state.secret.value,
      '',
      name + ': late rotation exposed a secret in another view',
    );
    assert.equal(h.state.saving.value, true);
  }
}
for (const test of [
  keys,
  logo,
  preview,
  mutations,
  lateConfirmation,
  rotationContext,
]) {
  try {
    await test();
    console.log('PASS ' + test.name + ' async route isolation');
  } catch (error) {
    failures.push(error);
    console.error(error.message);
  }
}
if (failures.length)
  throw new AggregateError(failures, 'Management async isolation failed');
