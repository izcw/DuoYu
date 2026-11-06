import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const dir = await mkdtemp(path.resolve('work/preference-account-'));
const results = [];
const alice = 'a'.repeat(64),
  bob = 'b'.repeat(64);
async function storedGlass(page, owner) {
  return page.evaluate(async (owner) => {
    const result = (request) =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const db = await result(
      indexedDB.open(owner ? 'duoyu-account-' + owner : 'duoyu'),
    );
    try {
      const row = await result(
        db
          .transaction('preferences')
          .objectStore('preferences')
          .get('glassMode'),
      );
      return row?.value ?? null;
    } finally {
      db.close();
    }
  }, owner);
}
const context = await chromium.launchPersistentContext(
  path.join(dir, 'profile'),
  {
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  },
);
try {
  await context.route(/^https?:/, (route) => route.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const origin = 'chrome-extension://' + new URL(worker.url()).host;
  for (const [owner, next] of [
    [alice, bob],
    [alice, ''],
    ['', bob],
    [alice, alice],
    ['', ''],
  ]) {
    const page = await context.newPage();
    // Hold the startup status request so the boundary between a marker change
    // and reload is deterministic. Storage, settings and mutations are real.
    await page.addInitScript((owner) => {
      localStorage.clear();
      localStorage.setItem('duoyu-sync-account', owner);
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message) =>
        message.type === 'duoyu-auth' && message.action === 'status'
          ? new Promise(() => {})
          : original(message);
    }, owner);
    await page.goto(origin + '/newtab.html');
    await page
      .getByRole('button', { name: /^(登录多鱼账号|我的账号)$/ })
      .click();
    await page.getByRole('button', { name: '常规设置', exact: true }).click();
    const previousGlass = await storedGlass(page, owner);
    await page.evaluate(() =>
      chrome.storage.local.set({ glassMode: 'natural' }),
    );
    await page.getByRole('combobox', { name: '当前页面布局' }).click();
    await page
      .getByRole('option', { name: '自动布局' })
      .evaluate((el, next) => {
        localStorage.setItem('duoyu-sync-account', next);
        el.click();
      }, next);
    const layout = await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(
          ([key, value]) => key.includes('duoyu-layout-') && value === 'auto',
        )
        .map(([key]) => key),
    );
    await page.getByRole('combobox', { name: '玻璃效果' }).click();
    await page.getByRole('option', { name: '柔和' }).click();
    await expect(
      page.getByRole('combobox', { name: '玻璃效果' }),
    ).toBeEnabled();
    const guestGlass = await page.evaluate(
      async () => (await chrome.storage.local.get('glassMode')).glassMode,
    );
    const rejected =
      (await page
        .getByRole('alert')
        .filter({ hasText: '账号已切换' })
        .count()) > 0;
    const databaseGlass = await storedGlass(page, owner);
    results.push({
      owner,
      next,
      layout,
      guestGlass,
      previousGlass,
      databaseGlass,
      rejected,
    });
    await page.close();
  }
  await writeFile(
    path.join(dir, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  console.log('Evidence:', dir);
  for (const row of results) {
    if (row.owner !== row.next) {
      assert.deepEqual(row.layout, [], 'Stale page wrote layout preferences');
      assert.equal(
        row.guestGlass,
        'natural',
        'Stale page modified guest settings',
      );
      assert.ok(row.rejected, 'Stale action must explain the account change');
      assert.equal(row.databaseGlass, row.previousGlass);
    } else {
      assert.equal(row.layout.length, 1);
      assert.ok(
        row.layout[0].startsWith(
          row.owner
            ? 'account:' + row.owner + ':duoyu-layout-'
            : 'duoyu-layout-',
        ),
      );
      assert.equal(row.guestGlass, row.owner ? 'natural' : 'soft');
      assert.equal(row.databaseGlass, row.owner ? 'soft' : row.previousGlass);
    }
  }
  console.log(
    'PASS stale account, logout, guest login, active account and guest preferences',
  );
} finally {
  await context.close();
}
