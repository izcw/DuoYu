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
  const item = page.locator('[data-library-id="home-widget-1"]');
  const before = await item.boundingBox();
  await item.click({button:'right'});
  await page.getByRole('button',{name:'删除',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'确认删除',exact:true});
  await expect(dialog).toBeVisible();
  assert.deepEqual(await item.boundingBox(),before);
  assert.equal(await dialog.evaluate(el=>el.closest('.library-board')===null),true);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(item).toBeVisible();
  await item.click({button:'right'});
  await page.getByRole('button',{name:'删除',exact:true}).click();
  await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(item).toHaveCount(0);
  assert.deepEqual(errors,[]);
  console.log('PASS floating confirmation leaves grid unchanged; cancel and delete work');
} finally { await context.close(); }
