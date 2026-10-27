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

  await page.waitForTimeout(700);
  await page.mouse.move(900,400);
  await page.mouse.wheel(0,180);
  await page.waitForTimeout(700);
  const maskPixels = await page.evaluate(async () => {
    const image = new Image(); image.src = '/images/iconpark-filled/Bookmark.svg'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0,48,48);
    return [ctx.getImageData(12,30,1,1).data[3],ctx.getImageData(26,8,1,1).data[3]];
  });
  assert.deepEqual(maskPixels,[255,0]);
  const rows = page.locator('.library-page-row');
  const count = await rows.count();
  await page.getByRole('button',{name:'添加收藏页',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'添加收藏页',exact:true});
  await expect(dialog).toBeVisible();
  await expect(rows).toHaveCount(count);
  await expect(dialog.getByRole('group',{name:'选择页面图标'}).getByRole('button')).toHaveCount(32);
  await dialog.getByLabel('收藏页名称').fill('我的音乐');
  await dialog.getByRole('button',{name:'音乐',exact:true}).click();
  await dialog.getByRole('button',{name:'添加',exact:true}).click();
  await expect(rows).toHaveCount(count+1);
  const row = rows.filter({hasText:'我的音乐'});
  await expect(row.locator('[data-icon="Music"]')).toHaveAttribute('data-theme','filled');
  const id = await row.getAttribute('data-library-page-id');
  await row.click({button:'right'});
  await page.getByRole('menuitem',{name:'修改名称和图标'}).click();
  const edit = page.getByRole('dialog',{name:'编辑收藏页',exact:true});
  await expect(edit.getByRole('button',{name:'音乐',exact:true})).toHaveAttribute('aria-pressed','true');
  await edit.getByLabel('收藏页名称').fill('阅读收藏');
  await edit.getByRole('button',{name:'阅读',exact:true}).click();
  await edit.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator(`[data-library-page-id="${id}"]`)).toContainText('阅读收藏');
  await page.reload();
  await expect(page.locator(`[data-library-page-id="${id}"] [data-icon="Book"]`)).toHaveCount(1);
  assert.deepEqual(errors,[]);
  console.log('PASS 32 IconPark choices, deferred creation, selected filled theme, edit and reload persistence');
} finally { await context.close(); }
