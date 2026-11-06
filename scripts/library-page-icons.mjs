import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { verifyPageIcons } from './fixtures/folded-page-icons.mjs';

// Exercise the installed build offline. auth-isolated --page-icons also runs
// these interactions after real OIDC login with a disposable account.
const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const profile = await mkdtemp(path.resolve('work/icon-picker-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
  headless: true,
  viewport: { width: 390, height: 780 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--load-extension=' + extension,
    '--disable-extensions-except=' + extension,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const account = {
    issuer: 'https://fixture.invalid',
    sub: 'icon-picker',
    name: '图标测试',
  };
  const owner = createHash('sha256')
    .update(account.issuer + '\0' + account.sub)
    .digest('hex');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.setOffline(true);
  await page.addInitScript(
    ({ account, owner }) => {
      localStorage.setItem('duoyu-sync-account', owner);
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message) =>
        message.type === 'duoyu-auth' && message.action === 'status'
          ? Promise.resolve({ view: { account } })
          : send(message);
    },
    { account, owner },
  );
  await page.goto(
    'chrome-extension://' + new URL(worker.url()).host + '/newtab.html',
  );
  await verifyPageIcons(page);
  assert.deepEqual(errors, []);
} finally {
  await context.close();
}
