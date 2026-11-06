import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

export async function verifyGuestExport({ page, evidence }) {
  await page.getByRole('button', { name: '登录多鱼账号', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  const original = await page.evaluate(async () => {
    const original = await chrome.storage.local.get('searchEngine');
    await chrome.storage.local.set({ searchEngine: 'guest-test-engine' });
    localStorage.setItem('duoyu-layout-guest-export', 'guest-only');
    localStorage.setItem(
      'account:other:duoyu-layout-guest-export',
      'other-account-only',
    );
    return original;
  });
  try {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    const filename = path.join(evidence, 'guest-portable.json');
    await (await event).saveAs(filename);
    const file = JSON.parse(await readFile(filename));
    assert.equal(file.storage.searchEngine, 'guest-test-engine');
    assert.equal(file.preferences['duoyu-layout-guest-export'], 'guest-only');
    assert.ok(!JSON.stringify(file).includes('other-account-only'));
    assert.ok(!('duoyu-sync-account' in file.preferences));
    console.log(
      'PASS guest export retains guest preferences and excludes account-scoped values',
    );
  } finally {
    await page.evaluate(async (original) => {
      localStorage.removeItem('duoyu-layout-guest-export');
      localStorage.removeItem('account:other:duoyu-layout-guest-export');
      if ('searchEngine' in original) await chrome.storage.local.set(original);
      else await chrome.storage.local.remove('searchEngine');
    }, original);
    await page.keyboard.press('Escape');
  }
}

export async function verifyExportBoundaries({ page, evidence }) {
  const account = await page.evaluate(() =>
    localStorage.getItem('duoyu-sync-account'),
  );
  assert.match(account, /^[a-f0-9]{64}$/);
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await page.getByRole('button', { name: '常规设置', exact: true }).click();
  const glass = page.getByRole('combobox', { name: '玻璃效果', exact: true });
  await glass.click();
  await page.getByRole('option', { name: '柔和', exact: true }).click();
  await expect(glass).toBeEnabled();
  await expect(glass).toContainText('柔和');
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  const backup = page.getByRole('button', { name: '导出备份', exact: true });
  const name = 'duoyu-layout-export-scope';
  const original = await page.evaluate(
    async ({ account, name }) => {
      const old = await chrome.storage.local.get('searchEngine');
      await chrome.storage.local.set({ searchEngine: 'fixture-guest-engine' });
      localStorage.setItem(name, 'guest-layout');
      localStorage.setItem('account:' + account + ':' + name, 'own-layout');
      localStorage.setItem('account:other:' + name, 'other-layout');
      return old;
    },
    { account, name },
  );
  const captures = [];
  const onDownload = (event) => captures.push(event);
  page.on('download', onDownload);
  try {
    const download = page.waitForEvent('download');
    await backup.click();
    const filename = path.join(evidence, 'export-scope-file.json');
    await (await download).saveAs(filename);
    const file = JSON.parse(await readFile(filename));
    assert.equal(file.format, 'duoyu-backup');
    const accountPreferences = Object.fromEntries(
      file.tables.preferences
        .filter((p) => ['glassMode', 'searchEngine'].includes(p.id))
        .map((p) => [p.id, p.value]),
    );
    const normal = {
      ownLayout: file.preferences[name],
      containsGuest:
        JSON.stringify(file).includes('fixture-guest-engine') ||
        JSON.stringify(file).includes('guest-layout'),
      containsOther: JSON.stringify(file).includes('other-layout'),
      containsAccountMarker: 'duoyu-sync-account' in file.preferences,
      expectedStorage: accountPreferences,
      storage: file.storage,
    };
    await expect(
      page.getByText('备份文件已生成', { exact: true }),
    ).toBeVisible();
    await backup.evaluate((button) => {
      localStorage.setItem('duoyu-sync-account', 'b'.repeat(64));
      button.click();
    });
    await expect(backup).toBeEnabled();
    const messages = await page.locator('[role=alert]').allTextContents();
    // Change account after the initial guard, during the actual read-only
    // IndexedDB snapshot. No file should be downloaded for the old page.
    await backup.evaluate((button, account) => {
      localStorage.setItem('duoyu-sync-account', account);
      const original = IDBTransaction.prototype.objectStore;
      globalThis.__restoreExportRead = () => {
        IDBTransaction.prototype.objectStore = original;
      };
      IDBTransaction.prototype.objectStore = function (name) {
        if (
          name === 'libraryItems' &&
          this.mode === 'readonly' &&
          this.objectStoreNames.contains('syncMeta')
        ) {
          localStorage.setItem('duoyu-sync-account', 'b'.repeat(64));
          globalThis.__exportAccountChanged = true;
        }
        return original.call(this, name);
      };
      button.click();
    }, account);
    await expect(backup).toBeEnabled();
    const midReadChanged = await page.evaluate(
      () => globalThis.__exportAccountChanged === true,
    );
    const result = {
      normal,
      messages,
      downloads: captures.length,
      midReadChanged,
    };
    await writeFile(
      path.join(evidence, 'export-boundaries.json'),
      JSON.stringify(result, null, 2),
    );
    assert.equal(normal.ownLayout, 'own-layout');
    assert.equal(
      normal.containsGuest ||
        normal.containsOther ||
        normal.containsAccountMarker,
      false,
    );
    assert.deepEqual(normal.storage, accountPreferences);
    assert.equal(accountPreferences.glassMode, 'soft');
    assert.ok(midReadChanged);
    assert.ok(messages.some((m) => m.includes('账号已切换')));
    assert.equal(captures.length, 1);
  } finally {
    page.off('download', onDownload);
    await page.evaluate(
      async ({ account, name, original }) => {
        globalThis.__restoreExportRead?.();
        localStorage.setItem('duoyu-sync-account', account);
        for (const key of [
          name,
          'account:' + account + ':' + name,
          'account:other:' + name,
        ])
          localStorage.removeItem(key);
        if ('searchEngine' in original)
          await chrome.storage.local.set(original);
        else await chrome.storage.local.remove('searchEngine');
      },
      { account, name, original },
    );
    await page.keyboard.press('Escape');
  }
  console.log(
    'PASS export contains current account settings and rejects stale page after account switch',
  );
}
