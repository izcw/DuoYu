import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/radial-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
  },
);
try {
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page.locator('#search-input').waitFor();
  await page.waitForTimeout(400);
  const wallpaper = page.locator('.wallpaper-wheel');
  const engine = page.locator('.engine-wheel');
  const trigger = page.locator('.engine-trigger');
  await page.mouse.move(720, 500);
  await page.mouse.down({ button: 'left' });
  await page.waitForTimeout(230);
  await expect(wallpaper).toHaveCount(0);
  await page.mouse.up();
  // Blank left clicks now enter the workspace; close it before testing the wheel.
  await page.locator('.workspace-board').waitFor();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-overlay')).toHaveCount(0);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(300);
  await expect(wallpaper).toHaveClass(/is-open/);
  await expect(wallpaper.locator('.radial-center')).toHaveCount(0);
  const anchor = await wallpaper.getAttribute('style');
  await page.mouse.move(735, 505);
  assert.equal(
    await wallpaper.locator('.radial-marker').getAttribute('data-target'),
    '',
  );
  await page.mouse.move(720, 380);
  await expect(wallpaper.locator('.radial-marker')).toHaveAttribute(
    'data-target',
    'weread',
  );
  assert.equal(await wallpaper.getAttribute('style'), anchor);
  await page.mouse.move(720, 500);
  await expect(wallpaper.locator('.radial-marker')).toHaveAttribute(
    'data-target',
    '',
  );
  await expect(wallpaper.locator('.radial-marker')).toHaveCSS('opacity', '0');
  await page.mouse.up({ button: 'right' });
  await expect(wallpaper).toHaveClass(/is-open/);
  await page.mouse.move(830, 500);
  await expect(wallpaper.locator('.radial-marker')).toHaveAttribute(
    'data-target',
    'xiaohongshu',
  );
  await page.mouse.move(730, 505);
  await expect(wallpaper.locator('.radial-marker')).toHaveAttribute(
    'data-target',
    '',
  );
  await expect(wallpaper.locator('.radial-marker')).toHaveCSS('opacity', '0');
  await page.mouse.click(1000, 550, { button: 'right' });
  await expect(wallpaper).not.toHaveClass(/is-open/);
  assert.equal(await wallpaper.getAttribute('style'), anchor);
  await page.waitForTimeout(250);
  await expect(wallpaper).toHaveCount(0);
  console.log(
    'PASS separate buttons, 44px dead zone, fixed hold center, free hover proximity, second right click closes',
  );
  // A highlighted item must not open when the empty ring is left-clicked.
  await context.route('https://weread.qq.com/**', (r) =>
    r.fulfill({ body: 'test' }),
  );
  await page.mouse.click(720, 500, { button: 'right' });
  await expect(wallpaper).toHaveClass(/is-open/);
  await page.mouse.move(720, 440);
  await expect(wallpaper.locator('.radial-marker')).toHaveAttribute(
    'data-target',
    'weread',
  );
  const pagesBefore = context.pages().length;
  await page.mouse.click(720, 440);
  await expect(wallpaper).not.toHaveClass(/is-open/);
  await page.waitForTimeout(300);
  assert.equal(
    context.pages().length,
    pagesBefore,
    'Blank left click must not open a tab',
  );
  await page.mouse.click(720, 500, { button: 'right' });
  await expect(wallpaper).toHaveClass(/is-open/);
  const openedPromise = context.waitForEvent('page');
  await wallpaper.locator('[data-item=weread]').click();
  const openedPage = await openedPromise;
  await openedPage.waitForLoadState();
  assert(openedPage.url().startsWith('https://weread.qq.com/'));
  await openedPage.close();
  await page.bringToFront();
  await page.waitForTimeout(250);
  await page.mouse.click(720, 500, { button: 'right' });
  await expect(wallpaper).toHaveClass(/is-open/);
  await trigger.focus();
  await expect(wallpaper).not.toHaveClass(/is-open/);
  await page.waitForTimeout(250);
  await trigger.click();
  await expect(engine).toHaveClass(/is-open/);
  const bingSize = await engine
    .locator('[data-item=bing] img')
    .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  assert.deepEqual(bingSize, { width: 23, height: 23 });
  await page.locator('#search-input').focus();
  await expect(engine).not.toHaveClass(/is-open/);
  await page.waitForTimeout(250);
  await page.mouse.click(720, 500, { button: 'right' });
  await expect(wallpaper).toHaveClass(/is-open/);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(wallpaper).not.toHaveClass(/is-open/);
  await page.waitForTimeout(250);
  console.log(
    'PASS hidden center, blank left click dismisses, direct icon click opens, focus/window blur closing and Bing dimensions',
  );
  await trigger.click({ button: 'right' });
  await expect(engine).not.toHaveClass(/is-open/);
  await trigger.click();
  await expect(engine).toHaveClass(/is-open/);
  await page.waitForTimeout(220);
  const order = () =>
    engine
      .locator('[data-item]')
      .evaluateAll((es) => es.map((e) => e.dataset.item));
  const before = await order();
  const selected = await trigger.getAttribute('aria-label');
  const a = await engine.locator('[data-item=bing]').boundingBox(),
    b = await engine.locator('[data-item=github]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await order();
  assert.notDeepEqual(after, before);
  assert.equal(await trigger.getAttribute('aria-label'), selected);
  await page.reload();
  await page.waitForTimeout(500);
  await trigger.click();
  await page.waitForTimeout(250);
  assert.deepEqual(await order(), after);
  await engine.locator('[data-item=google]').click();
  await expect(trigger).toHaveAttribute('aria-label', /Google|谷歌/);
  console.log(
    'PASS engine drag saves order without selecting; click still selects',
  );
  await page.waitForTimeout(250);
  const t = await trigger.boundingBox();
  await page.mouse.move(t.x + 22, t.y + 22);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await expect(engine).toHaveClass(/is-open/);
  const target = await engine.locator('[data-item=bing]').boundingBox();
  await page.mouse.move(target.x + 22, target.y + 22);
  await page.mouse.up();
  await expect(trigger).toHaveAttribute('aria-label', /Bing/);
  assert.deepEqual(errors, []);
  console.log('PASS engine left hold selection and no runtime errors');
} finally {
  await context.close();
}
