import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openGridMenu } from './ui-helpers.mjs';
await mkdir('work', { recursive: true });
const ext = path.resolve('.output/chrome-mv3');
const c = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/crud-audit-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
  },
);
c.setDefaultTimeout(12000);
try {
  await c.route('https://example.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<title>Audit</title>' }),
  );
  await c.route('https://api.bimg.cc/**', (r) => r.abort());
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('chrome://newtab');
  const grid = p.locator('.library-cell-grid').first();
  await grid.waitFor();
  await openGridMenu(p, grid);
  await p.getByRole('menuitem', { name: '添加网址', exact: true }).click();
  await p
    .getByLabel('收藏网址', { exact: true })
    .fill('https://example.com/audit');
  await p.getByLabel('收藏名称', { exact: true }).fill('审计网址');
  const imageInput = p.locator('fieldset input[type="file"]');
  await imageInput.setInputFiles(path.join(ext, 'icons/128.png'));
  const removeImage = p.getByRole('button', { name: '删除此图片' }).first();
  await expect(removeImage).toBeAttached();
  await p.evaluate(() => {
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (...args) => {
      const bitmap = await decode(...args);
      await new Promise((resolve) => {
        window.releaseIconDecode = resolve;
      });
      return bitmap;
    };
  });
  await imageInput.setInputFiles(path.join(ext, 'icons/48.png'));
  await p.waitForFunction(() => typeof window.releaseIconDecode === 'function');
  await removeImage.evaluate((button) => button.click());
  await p.evaluate(async () => {
    window.releaseIconDecode();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await expect(removeImage).toHaveCount(0);
  await p.getByLabel('编辑收藏', { exact: true }).evaluate((form) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  const item = () =>
    p
      .locator('.grid-stack-item')
      .filter({
        has: p.getByRole('button', { name: '打开收藏 审计网址', exact: true }),
      })
      .first();
  try {
    await item().waitFor();
  } catch (error) {
    console.log(await p.locator('body').innerText());
    throw error;
  }
  await expect(
    p.locator('.grid-stack-item').filter({
      has: p.getByRole('button', { name: '打开收藏 审计网址', exact: true }),
    }),
  ).toHaveCount(1);
  const id = await item().getAttribute('data-library-id');
  await item().click({ button: 'right' });
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  await p.getByLabel('收藏名称', { exact: true }).fill('审计已修改');
  await p
    .getByLabel('收藏网址', { exact: true })
    .fill('https://example.com/edited');
  await p.getByRole('button', { name: '保存', exact: true }).click();
  await expect(p.getByRole('dialog', { name: '编辑网址' })).toHaveCount(0);
  await expect(p.locator(`[data-library-id="${id}"]`)).toContainText(
    '审计已修改',
  );
  await p.reload();
  const saved = p.locator(`[data-library-id="${id}"]`);
  await saved.waitFor();
  await expect(saved).toContainText('审计已修改');
  await saved.click({ button: 'right' });
  await p.getByLabel('2列 × 2行', { exact: true }).click();
  await p.waitForTimeout(600);
  await p.reload();
  await saved.waitFor();
  await expect(saved).toHaveAttribute('gs-w', '2');
  await expect(saved).toHaveAttribute('gs-h', '2');
  await saved.click({ button: 'right' });
  await p.getByRole('button', { name: '删除', exact: true }).click();
  await p.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(saved).toHaveCount(0);
  await p.reload();
  await grid.waitFor();
  await expect(saved).toHaveCount(0);
  await openGridMenu(p, grid);
  await p.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
  const folder = p
    .locator('[data-kind="folder"]')
    .filter({ hasText: '新文件夹' })
    .last();
  await folder.waitFor();
  const folderId = await folder.getAttribute('data-library-id');
  await folder.click({ button: 'right' });
  await p.getByLabel('4列 × 2行', { exact: true }).click();
  await expect(folder).toHaveAttribute('gs-w', '4');
  await p.waitForTimeout(500);
  await p.reload();
  await grid.waitFor();
  const persistedFolder = p.locator(`[data-library-id="${folderId}"]`);
  await expect(persistedFolder).toHaveAttribute('gs-w', '4');
  await expect(persistedFolder).toHaveAttribute('gs-h', '2');
  await persistedFolder.click({ button: 'right' });
  await p.getByRole('button', { name: '删除', exact: true }).click();
  await p.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(persistedFolder).toHaveCount(0);
  await openGridMenu(p, grid);
  await p.getByRole('menuitem', { name: '添加网址', exact:true }).click();
  await p.getByLabel('收藏名称',{exact:true}).fill('旧账号提交');
  await p.getByLabel('收藏网址',{exact:true}).fill('https://example.com/stale');
  try {
    await p.getByLabel('编辑收藏',{exact:true}).evaluate(form => {
      localStorage.setItem('duoyu-sync-account','a'.repeat(64));
      form.requestSubmit();
    });
    await expect(p.getByRole('alert').filter({hasText:'账号已切换'}).first()).toBeVisible();
  } finally {
    await p.evaluate(() => localStorage.removeItem('duoyu-sync-account'));
  }
  await p.reload();
  await expect(grid).toBeVisible();
  await expect(p.getByRole('button',{name:'打开收藏 旧账号提交',exact:true})).toHaveCount(0);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'PASS real UI add, edit URL/name, reload persistence, resize persistence, delete and reload',
  );
} finally {
  await c.close();
}
