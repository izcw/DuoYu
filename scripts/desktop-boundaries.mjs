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
    viewport: { width: 1440, height: 1200 },
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

  async function checkBoundary() {
    const rect = await grid.boundingBox();
    const inside = { x: rect.x + 20, y: rect.y + 20 };
    const outside = { x: rect.x - 3, y: rect.y + 25 };
    await page.mouse.click(inside.x, inside.y, { button: 'right' });
    await expect(page.getByRole('menu', { name: '收藏页菜单' })).toBeVisible();
    await expect(
      page.locator('.radial-wheel[aria-hidden="false"]'),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(inside.x, inside.y);
    await expect(page.locator('.workspace-overlay')).toHaveCount(0);
    await page.mouse.click(outside.x, outside.y, { button: 'right' });
    await expect(page.locator('.radial-wheel[aria-hidden="false"]')).toHaveCSS(
      'visibility',
      'visible',
    );
    await expect(page.getByRole('menu', { name: '收藏页菜单' })).toHaveCount(0);
    // The first left click only dismisses an already-open wheel.
    await page.mouse.click(outside.x, outside.y);
    await expect(
      page.locator('.radial-wheel[aria-hidden="false"]'),
    ).toHaveCount(0);
    await expect(page.locator('.workspace-overlay')).toHaveCount(0);
    await page.mouse.click(outside.x, outside.y);
    await expect(page.locator('.workspace-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace-overlay')).toHaveCount(0);
    // A hold without a choice still closes on release.
    await page.mouse.move(outside.x, outside.y);
    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(250);
    await expect(page.locator('.radial-wheel[aria-hidden="false"]')).toHaveCSS(
      'visibility',
      'visible',
    );
    await page.mouse.up({ button: 'right' });
    await expect(
      page.locator('.radial-wheel[aria-hidden="false"]'),
    ).toHaveCount(0);
  }
  await checkBoundary();
  await page.mouse.move(720, 400);
  await page.mouse.wheel(0, 180);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  await page.waitForTimeout(700);
  await checkBoundary();
  assert.deepEqual(errors, []);
  console.log(
    'PASS home/library grid menus, outside wheel/workspace, wheel dismissal, long-press release',
  );
} finally {
  await context.close();
}
