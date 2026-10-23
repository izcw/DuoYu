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

  await expect(page.locator('[data-library-id="home-widget-1"]')).toBeVisible();
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
  ]) {
    await page.setViewportSize(size);
    for (let state = 0; state < 2; state++) {
      if (state === 1) {
        await page.mouse.move(size.width - 100, 400);
        await page.mouse.wheel(0, 180);
      }
      await page.waitForTimeout(850);
      const centers = await page.evaluate(() =>
        ['.clock', '.search-form', '.library-cell-grid'].map((sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return { sel, center: r.x + r.width / 2 };
        }),
      );
      for (const entry of centers)
        assert.ok(
          Math.abs(entry.center - size.width / 2) < 1,
          JSON.stringify({ size, state, entry }),
        );
      if (state === 1) {
        await page.getByRole('button', { name: '首页', exact: true }).click();
        await page.waitForTimeout(700);
      }
    }
  }
  console.log(
    'PASS browser-centered clock, search and grid on home/library at three viewport sizes',
  );
} finally {
  await context.close();
}
