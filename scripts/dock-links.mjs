import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/grid-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1920, height: 1800 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
      '--enable-unsafe-swiftshader',
    ],
  },
);
try {
  await context.route('https://api.bimg.cc/**', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><path fill="#45585c" d="M0 0h1440v1000H0z"/></svg>',
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page
    .locator('[data-library-page-id="library-demo"]')
    .waitFor({ state: 'attached' });

  const folder = page.locator('[data-library-id="home-widget-1"]');
  await expect(folder).toBeVisible();
  await page.waitForTimeout(700);
  async function dragOut(popup, cancel = false) {
    if (popup) await folder.locator('.folder-border').click();
    const list = popup ? page.locator('.folder-dialog') : folder;
    const icon = list.locator('[data-folder-item]').first();
    const id = await icon.getAttribute('data-folder-item');
    const a = await icon.locator('.folder-icon').boundingBox();
    const grid = await page.locator('.library-cell-grid').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(grid.x + 30, grid.y + 30, { steps: 30 });
    if (popup) await expect(page.locator('.folder-dialog')).toHaveCount(0);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (cancel) {
      await expect(folder.locator(`[data-folder-item="${id}"]`)).toHaveCount(1);
      await expect(page.locator(`[data-library-id="${id}"]`)).toHaveCount(0);
    } else {
      await expect(page.locator(`[data-library-id="${id}"]`)).toBeVisible();
      await expect(folder.locator(`[data-folder-item="${id}"]`)).toHaveCount(0);
      await page.reload();
      await expect(page.locator(`[data-library-id="${id}"]`)).toBeVisible();
      await page.waitForTimeout(600);
    }
  }
  await dragOut(false);
  const dock = page.locator('.desktop-dock');
  const link = page.locator('.library-cell-grid > [data-kind="link"]').first();
  const id = await link.getAttribute('data-library-id');
  const a = await link.locator('.cell-icon').boundingBox();
  const d = await dock.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 35 });
  const preview = page.locator('body > .desktop-transfer-preview');
  await expect(preview).toBeVisible();
  assert.equal(await preview.evaluate(el => getComputedStyle(el).position), 'fixed');
  assert.equal(await link.evaluate(el => getComputedStyle(el).visibility), 'hidden');
  await page.screenshot({path:'work/dock-transfer-preview.png'});
  await page.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect(dock.locator(`[data-dock-id="${id}"]`)).toBeVisible();
  await expect(page.locator(`[data-library-id="${id}"]`)).toHaveCount(0);
  const icon = await dock.locator(`[data-dock-id="${id}"] img`).boundingBox();
  assert.equal(icon.width,30);
  assert.equal(icon.height,30);
  await page.reload();
  const dockLink = dock.locator(`[data-dock-id="${id}"]`);
  await expect(dockLink).toBeVisible();
  await page.waitForTimeout(700);
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(700);
  await page.locator('[data-library-page-id="library-demo"] button').click();
  await expect(dock.locator('img[src="/images/back.png"]')).toBeVisible();
  await page.waitForTimeout(700);
  const grid = await page.locator('.library-cell-grid').boundingBox();
  const origin = await dockLink.boundingBox();
  await page.mouse.move(
    origin.x + origin.width / 2,
    origin.y + origin.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    origin.x + origin.width / 2 + 10,
    origin.y + origin.height / 2,
    { steps: 5 },
  );
  await page.mouse.move(grid.x + 30, grid.y + 30, { steps: 35 });
  await page.mouse.up();
  await expect(page.locator(`[data-library-id="${id}"]`)).toBeVisible();
  await expect(dockLink).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(700);
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(700);
  await page.locator('[data-library-page-id="library-demo"] button').click();
  await expect(page.locator(`[data-library-id="${id}"]`)).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS link moved into Dock and back to collection, persisted and return icon shown',
  );
} finally {
  await context.close();
}
