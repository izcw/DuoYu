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
  await page.waitForTimeout(800);
  const box = await page.locator('.library-cell-grid').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x / 2, y);
  const hint = page.locator('.workspace-entry-hint');
  await expect(hint).toHaveAttribute('data-side', 'left');
  await expect(hint).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.mouse.move((box.x + box.width + 1920) / 2, y);
  await expect(hint).toHaveAttribute('data-side', 'right');
  await page.mouse.move(box.x + box.width / 2, y);
  await expect(hint).toHaveCount(0);
  await page.mouse.move((box.x + box.width + 1920) / 2, y);
  await page.mouse.click((box.x + box.width + 1920) / 2, y);
  await expect(
    page.getByRole('dialog', { name: '工作区', exact: true }),
  ).toBeVisible();
  await expect(hint).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS left/right white workspace hint, grid exclusion and click entry',
  );
} finally {
  await context.close();
}
