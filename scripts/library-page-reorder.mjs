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

  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '添加收藏页', exact: true }).click();
  await page.getByRole('button', { name: '添加收藏页', exact: true }).click();
  const rows = page.locator('.library-page-row');
  await expect(rows).toHaveCount(4);
  await page.waitForTimeout(500);
  const order = () =>
    rows.evaluateAll((els) => els.map((el) => el.dataset.libraryPageId));
  const original = await order();
  const from = await rows.first().boundingBox(),
    to = await rows.last().boundingBox();
  const x = from.x + 30,
    y = to.y + to.height - 8;
  await page.mouse.move(x, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(x, from.y + 35, { steps: 5 });
  await page.mouse.move(x, y, { steps: 16 });
  await page.waitForTimeout(220);
  await page.mouse.move(x + 5, y, { steps: 4 });
  await page.mouse.move(x, y, { steps: 4 });
  await page.waitForTimeout(220);
  await expect(page.locator('.library-page-row.is-dragging')).toHaveCount(1);
  const expected = [...original.slice(1), original[0]];
  await expect(page.locator('.library-page-row.drop-after')).toHaveCount(1);
  assert.deepEqual(await order(), original);
  for (let n = 0; n < 12; n++) {
    // Browsers continuously emit dragover while the pointer rests on animating rows.
    await page.locator('.library-page-menu').dispatchEvent('dragover', {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    await page.waitForTimeout(35);
    assert.deepEqual(await order(), original);
  }
  await page.mouse.up();
  await expect(page.locator('.library-page-row.is-dragging')).toHaveCount(0);
  await expect.poll(order).toEqual(expected);
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.locator('[data-library-id="home-widget-1"]')).toBeVisible();
  await page.waitForTimeout(800);
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  await expect.poll(order).toEqual(expected);
  await page.waitForTimeout(700);
  // Cancelled sorting restores the order and never persists its preview.
  const source = rows.last();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer: dt });
  const top = await rows.first().boundingBox();
  await page.locator('.library-page-menu').dispatchEvent('dragover', {
    clientX: top.x + 20,
    clientY: top.y + 2,
    dataTransfer: dt,
  });
  await expect(page.locator('.library-page-row.drop-before')).toHaveCount(1);
  assert.deepEqual(await order(), expected);
  await source.dispatchEvent('dragend', { dataTransfer: dt });
  await expect.poll(order).toEqual(expected);
  assert.deepEqual(errors, []);
  console.log(
    'PASS stable native page reorder, stationary pointer during animation, persisted order and cancelled preview',
  );
} finally {
  await context.close();
}
