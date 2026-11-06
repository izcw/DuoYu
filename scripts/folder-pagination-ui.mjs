import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

await mkdir('work', { recursive: true });
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/folder-pagination-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  },
);
context.setDefaultTimeout(12000);
try {
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('chrome://newtab');
  await page.locator('[data-library-id="home-widget-1"]').waitFor();
  // Real IndexedDB fixture in an isolated browser profile. The operations below
  // exercise the rendered folder and its normal deletion transaction.
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('duoyu');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('libraryItems', 'readwrite'),
          store = tx.objectStore('libraryItems');
        store.put({
          id: 'pagination-folder',
          kind: 'folder',
          pageId: 'home',
          parent: '',
          name: '分页验证',
          url: '',
          icon: '',
          width: 3,
          height: 1,
          gridX: 0,
          gridY: 0,
          order: 100,
          updatedAt: Date.now(),
        });
        for (let i = 1; i <= 51; i++)
          store.put({
            id: `pagination-${i}`,
            kind: 'link',
            pageId: 'home',
            parent: 'pagination-folder',
            name: `分页收藏 ${i}`,
            url: `https://example.invalid/${i}`,
            icon: '',
            width: 1,
            height: 1,
            order: i,
            updatedAt: Date.now(),
          });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await page.reload();
  await page
    .getByRole('button', { name: '展开 分页验证', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '分页验证', exact: true });
  await expect(dialog.locator('.folder-link')).toHaveCount(50);
  await expect(
    dialog.getByRole('button', { name: '文件夹第 1 页', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await dialog.locator('.expanded-folder').hover();
  await page.mouse.wheel(0, 120);
  await expect(
    dialog.getByRole('button', { name: '文件夹第 2 页', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.folder-link')).toHaveCount(1);
  const last = dialog.getByRole('button', {
    name: '打开收藏 分页收藏 51',
    exact: true,
  });
  await last.click({ button: 'right' });
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog.locator('.folder-link')).toHaveCount(50);
  await expect(dialog.locator('.folder-pages')).toHaveCount(0);
  await expect(last).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await page
    .getByRole('button', { name: '展开 分页验证', exact: true })
    .click();
  await expect(dialog.locator('.folder-link')).toHaveCount(50);
  await expect(last).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS 50-item pagination, wheel navigation, deleting last page item clamps page and persists',
  );
} finally {
  await context.close();
}
