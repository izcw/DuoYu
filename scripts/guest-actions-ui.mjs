import { chromium, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openGridMenu } from './ui-helpers.mjs';
const ext = path.resolve(process.argv[2] || '.output/chrome-mv3');
const profile = await mkdtemp(path.resolve('work/guest-actions-ui-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1440, height: 1000 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--load-extension=' + ext, '--disable-extensions-except=' + ext],
});
try {
  const page = await ctx.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const worker =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  await page.goto(
    'chrome-extension://' + new URL(worker.url()).host + '/newtab.html',
  );
  const button = (name) => page.getByRole('button', { name, exact: true });
  const dialog = page.getByRole('dialog', { name: '登录后编辑' });
  const prompt = async (label) => {
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '前往登录' }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: '继续浏览' }).click();
    await expect(dialog).not.toBeVisible();
    console.log('PASS', label);
  };
  async function records() {
    return page.evaluate(async () => {
      const db = await new Promise((r, j) => {
        const q = indexedDB.open('duoyu-guest-template-v1');
        q.onsuccess = () => r(q.result);
        q.onerror = () => j(q.error);
      });
      try {
        const names = Array.from(db.objectStoreNames).filter(
          (n) => !n.startsWith('sync'),
        );
        const tr = db.transaction(names, 'readonly');
        return await Promise.all(
          names.map(
            (n) =>
              new Promise((r, j) => {
                const q = tr.objectStore(n).getAll();
                q.onsuccess = () => r(q.result);
                q.onerror = () => j(q.error);
              }),
          ),
        );
      } finally {
        db.close();
      }
    });
  }
  await expect(
    page.locator('.bottom-widgets [data-library-id]').first(),
  ).toBeVisible({ timeout: 25000 });
  const before = await records();
  await button('切换桌面').click();
  await button('添加桌面').click();
  await prompt('添加桌面');
  await page
    .locator('.desktop-cards [data-desktop]')
    .first()
    .click({ button: 'right' });
  await button('重命名').click();
  await prompt('桌面重命名');
  await page.keyboard.press('Escape');
  const grid = page.locator('.bottom-widgets .library-cell-grid');
  await openGridMenu(page, grid);
  await page.getByRole('menuitem', { name: '添加网址' }).click();
  await prompt('添加网址');
  await openGridMenu(page, grid);
  await page.getByRole('menuitem', { name: '组件商店' }).click();
  await page.locator('.store-widget-card').filter({ hasText: '日历' }).click();
  await prompt('添加组件');
  await page.keyboard.press('Escape');
  const item = grid.locator('[data-library-id]').first();
  await item.click({ button: 'right', position: { x: 5, y: 5 } });
  await page
    .locator('.grid-item-menu')
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await prompt('删除收藏');
  await button('登录多鱼账号').click();
  await button('备份与恢复').click();
  await button('导入备份').click();
  await prompt('导入备份');
  await page.keyboard.press('Escape');
  await button('柔和').click();
  await prompt('修改玻璃效果');
  await page.locator('.dock-entry[data-dock-id="duoyu-workspace"]').click();
  await button('新建集合').click();
  await prompt('新建集合');
  const menu = page.locator('.workspace-board .side-menu');
  await menu.hover();
  await button('新建空间').click();
  await prompt('新建空间');
  const more = button('更多集合操作').first();
  if (await more.count()) {
    await more.click();
    await button('删除集合').click();
    await prompt('删除集合');
  }
  assert.deepEqual(await records(), before);
  assert.deepEqual(errors, []);
  console.log('PASS guest template content unchanged and no page errors');
} finally {
  await ctx.close();
}
