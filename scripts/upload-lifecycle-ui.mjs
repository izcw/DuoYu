import { chromium } from '@playwright/test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
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
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/newtab.html`);
  const grid = page.locator('.library-cell-grid').first();
  await grid.waitFor();
  const box = await grid.boundingBox();
  await grid.click({ button: 'right', position: { x: box.width / 2, y: 25 } });
  await page.getByRole('menuitem', { name: '换壁纸', exact: true }).click();
  await page.getByRole('button', { name: '本地壁纸', exact: true }).click();
  await page
    .getByLabel('导入壁纸', { exact: true })
    .setInputFiles({
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
  assert.deepEqual(errors, []);
  console.log(
    'PASS real extension local wallpaper upload, explicit deletion, current-upload visibility and no script errors',
  );
} finally {
  await context.close();
}

