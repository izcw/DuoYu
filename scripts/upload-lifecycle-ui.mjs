import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openGridMenu } from './ui-helpers.mjs';
await mkdir('work', { recursive: true });
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/upload-lifecycle-')),
  {
    headless: true,
    channel: 'msedge',
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  },
);
let page;
try {
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/newtab.html`);
  const grid = page.locator('.library-cell-grid').first();
  await grid.waitFor();
  await openGridMenu(page, grid);
  await page.getByRole('menuitem', { name: '换壁纸', exact: true }).click();
  await page.getByRole('button', { name: '我的壁纸', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /上传壁纸/ }).click();
  await (
    await chooser
  ).setFiles({
    name: 'my-wallpaper.png',
    mimeType: 'image/png',
    buffer: await readFile('.output/chrome-mv3/icons/128.png'),
  });
  await page
    .getByRole('button', { name: '删除上传图片', exact: true })
    .waitFor();
  await page.getByRole('button', { name: '删除上传图片', exact: true }).click();
  await page
    .getByRole('button', { name: '删除上传图片', exact: true })
    .waitFor({ state: 'hidden' });
  await expect(page.getByRole('button', { name: /上传壁纸/ })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS real extension local wallpaper upload, explicit deletion, current-upload visibility and no script errors',
  );
} catch (error) {
  await page?.screenshot({ path: 'work/upload-lifecycle-failure.png' });
  if (page) console.log(await page.locator('body').innerText());
  throw error;
} finally {
  await context.close();
}
