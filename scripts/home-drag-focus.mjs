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

  const first = page.locator('[data-library-id="home-widget-1"]');
  await expect(first).toBeVisible();
  await page.waitForTimeout(800);
  const grid = page.locator('.library-cell-grid');
  const siblings = await grid.evaluate((el) =>
    el.gridstack.engine.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
    })),
  );
  const source = siblings.find((n) => n.id === 'home-widget-1');
  const neighbor = siblings.find(
    (n) => n.x === source.x + source.w && n.y === source.y,
  );
  assert.ok(neighbor);
  const rect = await first.boundingBox();
  const cell = await grid.evaluate((el) => ({
    w: el.getBoundingClientRect().width / 16,
    h: el.getBoundingClientRect().height / 5,
  }));
  const x = rect.x + 24,
    y = rect.y + rect.height - 32;
  const target = page.locator(`[data-library-id="${neighbor.id}"]`);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4 * cell.w, y, { steps: 25 });

  const backdrop = page.locator('.desktop-library-backdrop');
  await expect(backdrop).toHaveCSS('opacity', '1');
  await expect(backdrop).toHaveCSS('backdrop-filter', 'blur(52px)');
  await page.mouse.up();
  await expect(backdrop).toHaveCSS('opacity', '0');
  await expect(backdrop).toHaveCSS('visibility', 'hidden');
  console.log(
    'PASS homepage drag uses shared focus glass and clears on release',
  );
} finally {
  await context.close();
}
