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

  const grid = page.locator('.library-cell-grid');
  await expect(page.locator('[data-library-id="home-widget-1"]')).toBeVisible();
  await page.waitForTimeout(800);

  const folder = page.locator('[data-library-id="home-widget-1"]');
  const inner = folder.locator('.folder-auto-grid');
  await expect(inner.locator('[data-folder-item]')).toHaveCount(3);
  const ids = await inner
    .locator('[data-folder-item]')
    .evaluateAll((els) => els.map((el) => el.dataset.folderItem));
  const first = inner.locator('[data-folder-item]').first();
  const a = await first.boundingBox(),
    c = await inner.locator('[data-folder-item]').last().boundingBox();
  const originalFolder = await folder.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 20 });
  await expect(first).toHaveClass(/ui-draggable-dragging/);
  assert.ok(
    !(await folder.getAttribute('class')).includes('ui-draggable-dragging'),
  );
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = () =>
    inner
      .locator('[data-folder-item]')
      .evaluateAll((els) => els.map((el) => el.dataset.folderItem));
  await expect.poll(after).toEqual([ids[1], ids[2], ids[0]]);
  assert.deepEqual(await folder.boundingBox(), originalFolder);
  const packed = await inner.evaluate((el) => ({
    mode: el.gridstack.engine.mode,
    positions: el.gridstack.engine.nodes
      .map((n) => n.y * el.gridstack.getColumn() + n.x)
      .sort((a, b) => a - b),
  }));
  assert.deepEqual(packed, { mode: 'list', positions: [0, 1, 2] });
  await page.reload();
  await expect.poll(after).toEqual([ids[1], ids[2], ids[0]]);
  await folder.locator('.folder-border').click();
  const expanded = page.locator('.folder-dialog .folder-auto-grid');
  await expect(expanded.locator('.folder-icon-label')).toHaveCount(3);
  const e0 = await expanded.locator('[data-folder-item]').first().boundingBox(),
    e2 = await expanded.locator('[data-folder-item]').last().boundingBox();
  await page.mouse.move(e2.x + 30, e2.y + 35);
  await page.mouse.down();
  await page.mouse.move(e0.x + 30, e0.y + 35, { steps: 20 });
  await page.mouse.up();
  await expect
    .poll(() =>
      expanded
        .locator('[data-folder-item]')
        .evaluateAll((els) => els.map((el) => el.dataset.folderItem)),
    )
    .toEqual(ids);
  await expect(page.locator('.folder-dialog')).toBeVisible();
  await page.screenshot({ path: 'work/folder-auto-sort.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(700);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  await page.locator('[data-library-page-id="library-demo"]').click();
  await page
    .getByRole('button', { name: '展开 常用网站', exact: true })
    .click();
  await expect(page.locator('.folder-dialog [data-folder-item]')).toHaveCount(
    10,
  );
  const dimensions = await page
    .locator('.folder-dialog .folder-auto-grid')
    .evaluate((el) => ({
      cols: el.gridstack.getColumn(),
      rows: el.gridstack.opts.maxRow,
    }));
  assert.deepEqual(dimensions, { cols: 10, rows: 5 });
  await expect(
    page.getByRole('button', { name: '文件夹第 2 页', exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS shared GridStack folder preview/detail sorting, no parent drag, automatic packing and persistence',
  );
} finally {
  await context.close();
}
