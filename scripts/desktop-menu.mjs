import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { openGridMenu } from './ui-helpers.mjs';
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

  const rect = await grid.boundingBox();
  const cellWidth = await grid.evaluate(
    (el) => el.getBoundingClientRect().width / el.gridstack.getColumn(),
  );
  async function menu(x, y) {
    if (x === undefined) {
      await openGridMenu(page, grid);
      return;
    }
    await page.mouse.click(x, y, { button: 'right' });
    await expect(page.getByRole('menu', { name: '收藏页菜单' })).toBeVisible();
  }
  await menu(rect.x + 6 * cellWidth + 20, rect.y + 20);
  for (const name of ['组件商店', '换壁纸', '图标搜索', '立即备份', '设置']) {
    await expect(
      page.getByRole('menuitem', { name, exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
  const addedFolder = page
    .locator('.grid-stack-item')
    .filter({ has: page.locator('.tile-caption', { hasText: '新文件夹' }) });
  await expect(addedFolder).toHaveAttribute('gs-x', '6');
  await expect(addedFolder).toHaveAttribute('gs-y', '0');
  await addedFolder.locator('.folder-border').click();
  await expect(
    page.locator('.folder-dialog-content.desktop-card-glass'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭文件夹' })).toHaveCount(0);
  await page.locator('.folder-title').click();
  await page
    .getByRole('textbox', { name: '文件夹名称', exact: true })
    .fill('测试文件夹');
  await page
    .getByRole('textbox', { name: '文件夹名称', exact: true })
    .press('Enter');
  await expect(page.locator('.folder-title')).toHaveText('测试文件夹');
  await page.screenshot({ path: 'work/folder-detail.png' });
  await page
    .locator('.base-dialog-backdrop')
    .click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.folder-dialog')).toHaveCount(0);
  await menu(rect.x + 10 * cellWidth + 20, rect.y + 20);
  await page.getByRole('menuitem', { name: '添加网址' }).click();
  await expect(
    page.getByRole('dialog', { name: '添加网址', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: '收藏名称', exact: true })
    .fill('位置测试');
  await page
    .getByRole('textbox', { name: '收藏网址', exact: true })
    .fill('https://example.com/');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const link = page
    .locator('.grid-stack-item')
    .filter({ has: page.locator('.tile-caption', { hasText: '位置测试' }) });
  await expect(link).toHaveAttribute('gs-x', '10');
  await expect(link).toHaveAttribute('gs-y', '0');
  await menu(rect.x + 12 * cellWidth + 20, rect.y + 20);
  await page.getByRole('menuitem', { name: '组件商店', exact: true }).click();
  await page.getByRole('button', { name: '日历' }).click();
  const calendar = page
    .locator('.grid-stack-item')
    .filter({ has: page.locator('.tile-caption', { hasText: '日历' }) });
  await expect(calendar).toHaveAttribute('gs-x', '12');
  await calendar.click({ button: 'right', position: { x: 30, y: 30 } });
  await expect(
    page
      .locator('.grid-item-menu')
      .getByRole('button', { name: '编辑', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await menu();
  await page.getByRole('menuitem', { name: '图标搜索', exact: true }).click();
  await page
    .getByRole('searchbox', { name: '搜索图标和组件' })
    .fill('位置测试');
  await expect(page.locator('.tool-results .tool-entry')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await menu();
  await page.getByRole('menuitem', { name: '立即备份', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    '请先登录账号再创建云端备份',
  );
  await menu();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await downloading;
  assert.match(download.suggestedFilename(), /^duoyu-backup.*json$/);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(exported.format, 'duoyu-backup');
  await page.keyboard.press('Escape');
  await menu();
  await page.getByRole('menuitem', { name: '换壁纸', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '壁纸商店', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '我的壁纸', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /上传壁纸/ }).click();
  await (
    await choosing
  ).setFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: await readFile('public/icons/128.png'),
  });
  await expect(
    page.getByRole('button', { name: '删除上传图片', exact: true }),
  ).toBeVisible();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('duoyu-wallpaper-mode')),
    'custom',
  );
  await page.keyboard.press('Escape');
  await menu();
  await page
    .getByRole('menuitem', { name: '切换为自动布局', exact: true })
    .click();
  assert.equal(await grid.evaluate((el) => el.gridstack.engine.mode), 'top');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(grid).toBeVisible();
  await expect
    .poll(() => grid.evaluate((el) => el.gridstack.engine.mode))
    .toBe('top');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('duoyu-wallpaper-mode')),
    'custom',
  );
  await menu();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '设置', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: '当前页面布局', exact: true })
    .click();
  await page.getByRole('option', { name: '自由布局', exact: true }).click();
  await page.getByRole('combobox', { name: '玻璃效果', exact: true }).click();
  await page.getByRole('option', { name: '柔和', exact: true }).click();
  await expect(
    page.locator('.glass-mode-switch button[aria-pressed="true"]'),
  ).toHaveText('柔和');
  await page.keyboard.press('Escape');
  assert.equal(await grid.evaluate((el) => el.gridstack.engine.mode), 'float');
  assert.deepEqual(errors, []);
  console.log(
    'PASS context menus, positioned creation, folder rename/material, immutable widget title, search, backup, wallpaper import, persistent layout and settings',
  );
} finally {
  await context.close();
}
