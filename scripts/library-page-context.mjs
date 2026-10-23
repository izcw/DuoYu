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

  await expect(page.locator('.library-page-actions')).toHaveCount(0);
  const row = page.locator('.library-page-row').first();
  await row.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: '收藏页操作' })).toBeVisible();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('textbox', { name: '收藏页名称' }).fill('右键管理测试');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(row).toContainText('右键管理测试');
  await page.getByRole('button', { name: '添加收藏页', exact: true }).click();
  const rows = page.locator('.library-page-row');
  await expect(rows).toHaveCount(3);
  await rows.last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除页面', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await row.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '收藏页操作' })).toHaveCount(0);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(700);
  const folder = page.locator('[data-library-id="home-widget-1"]');
  // Place the fixture against the left boundary before requesting a full-width folder.
  await folder.evaluate((el) =>
    el.closest('.grid-stack').gridstack.update(el, { x: 0, y: 0 }),
  );
  await expect(folder).toHaveAttribute('gs-x', '0');
  assert.equal(await folder.evaluate((el) => el.gridstackNode.maxW), 18);
  await folder.click({ button: 'right', position: { x: 10, y: 10 } });
  await page.getByRole('button', { name: '18列 × 1行', exact: true }).click();
  await expect(folder).toHaveAttribute('gs-w', '18');
  await page.reload();
  await expect(folder).toHaveAttribute('gs-w', '18');
  await page.waitForTimeout(800);
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await expect(row).toContainText('右键管理测试');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: page context rename/delete, folder 18-column resize, reload persistence',
  );
} finally {
  await context.close();
}
