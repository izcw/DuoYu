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

  const dock = page.getByRole('navigation', { name: '快捷 Dock' });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole('button',{name:'首页',exact:true})).toHaveAttribute('draggable','false');
  await expect(dock.getByRole('button',{name:'标签工作区',exact:true})).toHaveAttribute('draggable','false');
  const source = await dock.getByRole('button',{name:'画布',exact:true}).boundingBox();
  const target = await dock.getByRole('button',{name:'首页',exact:true}).boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(source.x+source.width/2-10,source.y+source.height/2,{steps:5});
  await page.mouse.move(target.x+2,target.y+target.height/2,{steps:20});
  await expect(page.locator('.dock-drag-image img')).toHaveCount(1);
  assert.equal(await page.locator('.dock-dragging').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await page.mouse.up();
  const expected = ['duoyu-home','duoyu-workspace','duoyu-canvas','duoyu-memo','duoyu-translate'];
  assert.deepEqual(await dock.locator('.dock-entry').evaluateAll(els=>els.map(el=>el.dataset.dockId)),expected);
  await expect(page.locator('.dock-drag-image')).toHaveCount(0);
  await page.reload();
  await expect(dock).toBeVisible();
  assert.deepEqual(await dock.locator('.dock-entry').evaluateAll(els=>els.map(el=>el.dataset.dockId)),expected);
  await page.getByRole('button',{name:'隐藏首页组件',exact:true}).click();
  await expect(dock).toBeHidden();
  await expect(page.locator('.desktop-dock')).toHaveAttribute('inert','');
  await page.getByRole('button',{name:'显示首页组件',exact:true}).click();
  await expect(dock).toBeVisible();
  const before = await dock.boundingBox();
  await dock.getByRole('button', { name: '标签工作区', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '工作区', exact: true }),
  ).toBeVisible();
  await expect(dock).toBeVisible();
  assert.deepEqual(await dock.boundingBox(), before);
  await dock.getByRole('button', { name: '首页', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '工作区', exact: true }),
  ).toHaveCount(0);
  await page.waitForTimeout(900);
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  assert.deepEqual(await dock.boundingBox(), before);
  await expect(
    dock.locator('img[src="/images/shortcuts/translate.png"]'),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS persistent fixed Dock, workspace/home navigation and collection page positioning',
  );
} finally {
  await context.close();
}
