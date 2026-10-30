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
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await page.locator('.account-entry').waitFor({ timeout: 30000 });
  await page.locator('.library-cell-grid').first().waitFor({ timeout: 30000 });
  await page.locator('.account-entry').click();
  await page.getByText('使用多鱼账号登录', { exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: 'work/cloud-ui-guest.png' });
  console.log(
    'PASS extension guest bootstrap, grid, login panel and no JavaScript errors; extension ID ' +
      id,
  );
} finally {
  await context.close();
}
