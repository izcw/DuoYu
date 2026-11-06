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
  await page.mouse.click(1850, 500, { button: 'right' });
  const wheel = page.locator('.wallpaper-wheel');
  await expect(wheel).toHaveAttribute('aria-hidden', 'false');
  await expect(
    wheel.getByRole('menuitem', { name: '收藏库', exact: true }),
  ).toHaveCount(0);
  await expect(
    wheel.getByRole('menuitem', { name: '标签工作区', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page
    .getByRole('navigation', { name: '快捷 Dock', exact: true })
    .getByRole('button', { name: '标签工作区', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: '工作区', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: '快捷 Dock', exact: true })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await page.mouse.move(2, 500);
  await page.getByRole('button', { name: '常用收藏', exact: true }).click();
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  await expect(
    page.getByRole('dialog', { name: '收藏库', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.desktop-library .library-board')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS current wheel entries, explicit Dock workspace/home navigation and collection sidebar entry',
  );
} finally {
  await context.close();
}
