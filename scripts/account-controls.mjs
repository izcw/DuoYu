import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { computed, ref } from 'vue';

async function controls(file, expose) {
  const source = await readFile(
    '../DuoYu-ID/admin/src/views/duoyu/' + file,
    'utf8',
  );
  const script = source
    .split('<script setup lang="ts">')[1]
    .split('</script>')[0];
  const js = ts.transpileModule(
    script.replace(/^\s*import .*? from .*?$/gm, ''),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const route = {
    path: '/account/security',
    query: { action: 'deletePasskey', key: 'first' },
  };
  const requests = [],
    mounted = [],
    disposed = [],
    timers = new Set();
  const roles = ref(['R_SUPER']);
  const bindings = {
    ref,
    computed,
    useRoute: () => route,
    useRouter: () => ({ push() {} }),
    useWindowSize: () => ({ width: ref(1440) }),
    useUserStore: () => ({
      get info() {
        return { roles: roles.value };
      },
    }),
    watch() {},
    onMounted: (cb) => mounted.push(cb),
    onBeforeUnmount: (cb) => disposed.push(cb),
    onBeforeRouteLeave() {},
    onBeforeRouteUpdate() {},
    window: { addEventListener() {}, removeEventListener() {} },
    ElMessage: { error() {}, success() {} },
    ElMessageBox: { confirm: async () => {} },
    setInterval: (cb) => {
      timers.add(cb);
      return cb;
    },
    clearInterval: (cb) => timers.delete(cb),
    api: (url, method) =>
      new Promise((resolve, reject) =>
        requests.push({ url, method, resolve, reject }),
      ),
  };
  const state = new Function(
    ...Object.keys(bindings),
    js + '\nreturn {' + expose + '}',
  )(...Object.values(bindings));
  return { state, route, requests, mounted, disposed, timers, roles };
}
test('passkey removal uses the currently displayed route and issues a single delete', async () => {
  const { state, route, requests } = await controls(
    'profile/index.vue',
    'selectPasskey,securityAction,passkeys,loading',
  );
  state.loading.value = false;
  state.passkeys.value = [{ id: 'first' }, { id: 'second' }];
  state.selectPasskey('first');
  route.query.key = 'second';
  const first = state.securityAction(),
    repeat = state.securityAction();
  assert.deepEqual(
    requests.map((r) => r.url),
    ['/api/me/passkeys/second'],
  );
  requests[0].reject(Error('test outage'));
  await Promise.all([first, repeat]);
  route.query.key = 'unknown';
  await state.securityAction();
  assert.equal(requests.length, 1);
});
test('unknown authenticator status cannot begin enrollment', async () => {
  const { state, requests, mounted } = await controls(
    'profile/AuthenticatorSettings.vue',
    'submit',
  );
  const load = mounted[0]();
  requests[0].reject(Error('test outage'));
  await load;
  void state.submit();
  assert.equal(requests.length, 1);
});
test('leaving during a mail request does not start a detached countdown', async () => {
  const { state, requests, mounted, disposed, timers } = await controls(
    'profile/AuthenticatorSettings.vue',
    'send',
  );
  const load = mounted[0]();
  requests[0].resolve({ enabled: false, recovery_remaining: 0 });
  await load;
  const sending = state.send();
  requests[1].resolve({ email: 'fixture@example.invalid' });
  await Promise.resolve();
  disposed.forEach((fn) => fn());
  requests[2].resolve({});
  await sending;
  assert.equal(timers.size, 0);
});
for (const view of ['health', 'manage']) {
  test(
    view + ' actions follow role revocation on the mounted instance',
    async () => {
      const { state, roles } = await controls(
        view + '/index.vue',
        'get allowed(){return typeof superAdmin==="boolean"?superAdmin:superAdmin.value}',
      );
      assert.equal(state.allowed, true);
      roles.value = [];
      assert.equal(state.allowed, false);
    },
  );
}
test('logout clears account and legacy credentials while preserving origin preferences', async () => {
  const source = await readFile(
    '../DuoYu-ID/admin/src/components/core/layouts/art-header-bar/widget/ArtUserMenu.vue',
    'utf8',
  );
  const body = source
    .split('<script setup lang="ts">')[1]
    .split('</script>')[0]
    .replace(/^\s*import .*? from .*?$/gm, '');
  const js = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const local = Object.assign(
    Object.create({
      removeItem(k) {
        delete this[k];
      },
      clear() {
        for (const k of Object.keys(this)) delete this[k];
      },
    }),
    {
      'sys-v2.0-user': 'secret',
      'sys-v3.0-worktab': 'private',
      'sys-v1.0': 'legacy',
      'sys-v3.0-setting': 'theme',
      'sys-version': '3.0',
      'other-origin-feature': 'keep',
      user: 'legacy user',
    },
  );
  const configSource = await readFile(
    '../DuoYu-ID/admin/src/utils/storage/storage-config.ts',
    'utf8',
  );
  const configJS = ts.transpileModule(
    configSource.replace('export class', 'class'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const config = new Function(
    '__APP_VERSION__',
    configJS + '\nreturn StorageConfig',
  )('3.0');
  let destination;
  const errors = [];
  const bindings = {
    useUserStore: () => ({}),
    useRouter: () => ({}),
    api: async () => {},
    ElMessageBox: { confirm: async () => {} },
    ElMessage: { error: (e) => errors.push(e) },
    localStorage: local,
    sessionStorage: { removeItem() {} },
    StorageConfig: config,
    window: {
      location: {
        assign(url) {
          destination = url;
        },
      },
    },
  };
  const command = new Function(
    ...Object.keys(bindings),
    js + '\nreturn command',
  )(...Object.values(bindings));
  await command('logout');
  assert.deepEqual(errors, []);
  assert.equal(destination, '/login');
  assert.deepEqual(
    { ...local },
    {
      'sys-v3.0-setting': 'theme',
      'sys-version': '3.0',
      'other-origin-feature': 'keep',
    },
  );
});
test('dynamic menu opens only web URLs and keeps nested iframe destinations in the router', async () => {
  async function loadModule(file, bindings, expose) {
    const body = (
      await readFile(
        '../DuoYu-ID/admin/src/utils/navigation/' + file + '.ts',
        'utf8',
      )
    )
      .replace(/^import .*$/gm, '')
      .replace(/^export /gm, '');
    const js = ts.transpileModule(body, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    return new Function(...Object.keys(bindings), js + '\nreturn ' + expose)(
      ...Object.values(bindings),
    );
  }
  const routes = await loadModule(
    'route',
    { location: { href: 'https://example.invalid/' } },
    '({webNavigationUrl,isNavigableMenuItem})',
  );
  const external = [],
    internal = [];
  const jump = await loadModule(
    'jump',
    {
      ...routes,
      router: { push: (p) => internal.push(p) },
      window: { open: (...args) => external.push(args) },
    },
    '({openExternalLink,handleMenuJump})',
  );
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,x',
    'chrome://settings',
    ' ',
  ])
    jump.openExternalLink(value);
  jump.openExternalLink('https://example.invalid/help');
  jump.handleMenuJump(
    {
      path: '/parent',
      meta: {},
      children: [
        {
          path: '/outside/iframe/help',
          meta: { link: 'https://example.invalid/help', isIframe: true },
        },
      ],
    },
    true,
  );
  assert.deepEqual(external, [
    ['https://example.invalid/help', '_blank', 'noopener,noreferrer'],
  ]);
  assert.deepEqual(internal, ['/outside/iframe/help']);
});
test('form field paths cannot write through an object prototype', async () => {
  for (const name of ['art-form', 'art-search-bar']) {
    const src = await readFile(
      '../DuoYu-ID/admin/src/components/core/forms/' + name + '/index.vue',
      'utf8',
    );
    const block = src.slice(
      src.indexOf(
        'const ' + (name === 'art-form' ? 'parsePath' : 'getFieldValue') + ' =',
      ),
      src.indexOf('const isRichTextEmpty'),
    );
    const js = ts.transpileModule(block, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const state = { value: {} };
    const { setFieldValue, getFieldValue } = new Function(
      'modelValue',
      'PATH_NUMBER_RE',
      'normalizeFieldValue',
      js + '\nreturn {setFieldValue,getFieldValue}',
    )(state, /^\d+$/, (v) => v);
    try {
      const key = name === 'art-form' ? '__proto__.p2probe' : '__proto__';
      setFieldValue(
        key,
        name === 'art-form' ? 'unsafe' : { p2probe: 'unsafe' },
      );
      assert.equal(state.value.p2probe, undefined);
      assert.equal(getFieldValue(key), undefined);
      const valid = name === 'art-form' ? 'items.0.name' : 'name';
      setFieldValue(valid, 'saved');
      assert.equal(getFieldValue(valid), 'saved');
    } finally {
      delete Object.prototype.p2probe;
    }
  }
});
