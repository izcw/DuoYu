import { chromium } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
await mkdir('work', { recursive: true });
const extensionPath = path.resolve('.output/chrome-mv3');
const profile = await mkdtemp(path.resolve('work/cloud-ui-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
  ignoreDefaultArgs: ['--disable-extensions'],
  viewport: { width: 1440, height: 1000 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => args[0]?.type === 'duoyu-auth' && args[0]?.action === 'status'
      ? new Promise(() => {}) : send(...args);
  });
  const started = Date.now();
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await page.locator('.account-entry').waitFor({ timeout: 30000 });
  await page.locator('.library-cell-grid').first().waitFor({ timeout: 30000 });
  console.log('Local grid visible with authentication stalled:', Date.now()-started, 'ms');
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: 'work/startup-offline.png' });
  console.log(
    'PASS startup renders while authentication is stalled; extension ID ' +
      id,
  );
} finally {
  await context.close();
}
