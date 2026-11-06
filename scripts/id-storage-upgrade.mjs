import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function exportsOf(file, bindings, expose) {
  const body = (
    await readFile('../DuoYu-ID/admin/src/utils/' + file + '.ts', 'utf8')
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
const config = await exportsOf(
  'storage/storage-config',
  { __APP_VERSION__: '3.10.0' },
  'StorageConfig',
);
test('upgrade preserves older stores, the current version marker and unrelated origin data', async () => {
  const storage = Object.assign(
    Object.create({
      getItem(k) {
        return this[k] ?? null;
      },
      setItem(k, v) {
        this[k] = v;
      },
      removeItem(k) {
        delete this[k];
      },
    }),
    {
      'sys-version': '3.9.0',
      'sys-v3.9.0-table': 'saved',
      'sys-v3.9.0-menu': 'old',
      'sys-v3.10.0-menu': 'current',
      'sys-v3.9.0': 'legacy',
      'other-app': 'safe',
    },
  );
  let logouts = 0;
  const timers = [];
  const upgrade = await exportsOf(
    'sys/upgrade',
    {
      StorageConfig: config,
      localStorage: storage,
      ElNotification() {},
      useUserStore: () => ({
        logOut() {
          logouts++;
        },
      }),
      setTimeout: (fn) => timers.push(fn),
      upgradeLogList: {
        value: [{ version: '3.10.0', title: 'test', requireReLogin: true }],
      },
    },
    'systemUpgrade',
  );
  await upgrade();
  for (const fn of timers) await fn();
  assert.equal(storage['sys-version'], '3.10.0');
  assert.equal(storage['sys-v3.10.0-table'], 'saved');
  assert.equal(storage['sys-v3.10.0-menu'], 'current');
  assert.equal(storage['sys-v3.10.0'], 'legacy');
  assert.equal(storage['other-app'], 'safe');
  assert.equal(logouts, 1);
});
test('only versioned data keys qualify as stored state', () => {
  assert.equal(config.isVersionedKey('sys-version'), false);
  assert.equal(config.isCurrentVersionKey('sys-v3.10.01-user'), false);
  assert.equal(
    config.createCurrentVersionPattern().test('sys-v3x10x0-user'),
    false,
  );
  assert.equal(config.createKeyPattern('a.b').test('sys-v2.0.0-aXb'), false);
});
test('storage compatibility propagates the required-login result for empty storage', async () => {
  const storage = {};
  Object.defineProperty(storage, 'getItem', { value: () => null });
  const check = await exportsOf(
    'storage/storage',
    { localStorage: storage, StorageConfig: config, setTimeout() {} },
    'checkStorageCompatibility',
  );
  assert.equal(check(false), true);
  assert.equal(check(true), false);
});
