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
    viewport: { width: 1440, height: 1000 },
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
  await page.mouse.move(1200, 400);
  await page.mouse.wheel(0, 180);
  await page
    .locator('[data-library-page-id="library-demo"] .library-page-choice')
    .click();
  const defaultMenu = page.locator(
    '[data-library-page-id="default"] .library-page-choice',
  );
  const demoMenu = page.locator(
    '[data-library-page-id="library-demo"] .library-page-choice',
  );
  const folder = page.locator('[data-library-id="demo-folder"]');
  await page.waitForTimeout(700);
  const border = await folder.locator('.folder-border').boundingBox();
  await page.mouse.move(border.x + 150, border.y + 3);
  await page.mouse.down();
  await page.waitForTimeout(350);
  const menu = await defaultMenu.boundingBox();
  await page.mouse.move(menu.x + 20, menu.y + 20, { steps: 18 });
  await expect(defaultMenu).toHaveAttribute('aria-current', 'page');
  await page.mouse.move(650, 450, { steps: 10 });
  await page.mouse.up();
  await expect(folder).toBeVisible();
  await folder.getByRole('button', { name: '展开 常用网站' }).click();
  await expect(page.getByRole('dialog').locator('.cell-link')).toHaveCount(9);
  await page.keyboard.press('Escape');
  await demoMenu.click();
  await expect(folder).toHaveCount(0);
  const icon = page.locator('[data-library-id="demo-link-10"]');
  await page.waitForTimeout(700);
  const iconBox = await icon.boundingBox();
  await page.mouse.move(iconBox.x + 45, iconBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(iconBox.x + 55, iconBox.y + 40, { steps: 4 });
  await page.mouse.move(menu.x + 20, menu.y + 20, { steps: 18 });
  await page.mouse.move(menu.x + 21, menu.y + 21);
  await expect(defaultMenu).toHaveAttribute('aria-current', 'page');
  await page.mouse.move(850, 450, { steps: 10 });
  await page.mouse.up();
  await expect(icon).toBeVisible();
  await demoMenu.click();
  await page.waitForTimeout(700);
  const widget = page.locator('[data-library-id="demo-calendar"]');
  const header = await widget.locator('header').boundingBox();
  await page.mouse.move(header.x + 20, header.y + 8);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.move(menu.x + 20, menu.y + 20, { steps: 18 });
  await expect(defaultMenu).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(widget).toHaveCount(0);
  await demoMenu.click();
  await expect(widget).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS hover page switching, folder with children transfer, native icon transfer',
  );
} finally {
  await context.close();
}
