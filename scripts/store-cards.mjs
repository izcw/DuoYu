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
  let secondFailed = false;
  const requests = [];
  await context.route('https://api.bimg.cc/all?**', async r => {
    const n = Number(new URL(r.request().url()).searchParams.get('page'));
    requests.push(n);
    if (n === 2 && !secondFailed) { secondFailed = true; return r.fulfill({status:503,body:'unavailable'}); }
    const data = Array.from({length:18}, (_, i) => {
      const id = (n-1)*18+i;
      return {id, title:`Wallpaper ${id}`,url:`https://bing.com/th?id=test${id}_1920x1080.jpg`,datetime:new Date(Date.UTC(2026,9,23-id)).toISOString().slice(0,10),copyright:'Test'};
    });
    await r.fulfill({json:{code:200,data,total:36}});
  });
  await context.route('https://bing.com/**', r => r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#456"/></svg>'}));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page
    .locator('[data-library-page-id="library-demo"]')
    .waitFor({ state: 'attached' });

  await expect(page.locator('.library-cell-grid')).toBeVisible();
  await page.waitForTimeout(700);
  async function menu() {
    await page
      .locator('.library-cell-grid')
      .click({ button: 'right', position: { x: 10, y: 10 } });
    await expect(page.locator('.library-context-menu')).toBeVisible();
    await expect(page.locator('.library-context-menu')).toBeFocused();
    await expect(
      page.getByRole('menuitem', { name: '＋ 添加网址', exact: true }),
    ).not.toBeFocused();
  }
  await menu();
  await page.getByRole('menuitem', { name: '组件商店', exact: true }).click();
  const widgets = page.getByRole('dialog', { name: '组件商店', exact: true });
  await expect(widgets).toBeVisible();
  async function sideBySide(dialog) {
    const left = await dialog.locator('.store-menu').boundingBox();
    const right = await dialog.locator('.store-content').boundingBox();
    assert.ok(left.x + left.width <= right.x);
    assert.ok(Math.abs(left.y - right.y) < 1);
  }
  await sideBySide(widgets);
  const fixedBox = await widgets.boundingBox();
  assert.ok(Math.abs(fixedBox.width/fixedBox.height-4/3)<.01);
  const widgetGrid = await widgets.locator('.widget-card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(widgetGrid, 5);
  const widgetBox = await widgets.locator('.store-widget-card').first().boundingBox();
  assert.ok(Math.abs(widgetBox.width/widgetBox.height-4/3)<0.01);
  await widgets.getByRole('button', { name: '效率工具', exact: true }).click();
  await expect(widgets.locator('.store-content')).toContainText('便签');
  await expect(widgets.locator('.store-content')).not.toContainText('天气');
  await page.keyboard.press('Escape');
  await menu();
  await page.getByRole('menuitem', { name: '换壁纸', exact: true }).click();
  const wallpapers = page.getByRole('dialog', {
    name: '壁纸商店',
    exact: true,
  });
  await sideBySide(wallpapers);
  const wallpaperBox = await wallpapers.boundingBox();
  assert.equal(wallpaperBox.width,fixedBox.width);
  assert.equal(wallpaperBox.height,fixedBox.height);
  await expect(wallpapers.getByAltText('今日必应壁纸')).toHaveAttribute('src', /api.bimg.cc\/today/);
  await wallpapers
    .getByRole('button', { name: '本地壁纸', exact: true })
    .click();
  await expect(wallpapers.getByLabel('导入壁纸')).toBeHidden();
  await expect(wallpapers.getByRole('button', {name:'导入本地壁纸'})).toBeVisible();
  await wallpapers.getByRole('button', {name:'必应壁纸',exact:true}).click();
  const cards = wallpapers.locator('.wallpaper-card');
  await expect(cards).toHaveCount(18);
  assert.deepEqual(requests,[1]);
  const cols = await wallpapers.locator('.wallpaper-card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(cols,3);
  const box = await cards.first().boundingBox();
  assert.ok(Math.abs(box.width/box.height-16/9)<0.01);
  await wallpapers.locator('.store-content').evaluate(el => el.scrollTop = el.scrollHeight);
  await wallpapers.getByRole('button',{name:'壁纸加载失败，请重试'}).click();
  await expect(cards).toHaveCount(36);
  assert.deepEqual(requests,[1,2,2]);
  const dates = await cards.locator('small').allTextContents();
  assert.deepEqual(dates,[...dates].sort().reverse());
  await cards.first().click();
  await expect(wallpapers.getByRole('status')).toHaveText('已应用：Wallpaper 0');
  await page.screenshot({ path: 'work/store-cards.png' });
  const after = await wallpapers.boundingBox();
  assert.equal(after.height,fixedBox.height);
  await page.setViewportSize({width:1000,height:700});
  const small = await wallpapers.boundingBox();
  assert.ok(small.height <= 668);
  assert.ok(Math.abs(small.width/small.height-4/3)<.01);
  assert.deepEqual(errors, []);
  console.log(
    'PASS 5-column 4:3 widgets, 3-column 16:9 wallpapers, descending lazy pagination, retry and apply',
  );
} finally {
  await context.close();
}
