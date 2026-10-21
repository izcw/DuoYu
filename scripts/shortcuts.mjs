import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/shortcuts-')),
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
  await page.waitForTimeout(500);
  const wheel = page.locator('.wallpaper-wheel');
  const open = async (x = 700, y = 520) => {
    await page.mouse.click(x, y, { button: 'right' });
    await expect(wheel).toHaveClass(/is-open/);
    await page.waitForTimeout(250);
  };
  await page.locator('#search-input').click({ button: 'right' });
  await expect(wheel).toHaveCount(0);
  await page.locator('.widget-card').first().click({ button: 'right' });
  await expect(wheel).toHaveCount(0);
  await page.locator('.clock').click({ button: 'right' });
  await expect(wheel).toHaveCount(0);
  console.log('PASS controls and cards excluded');
  await open();
  await expect(page.locator('.wallpaper-wheel .radial-choice')).toHaveCount(9);
  const angles = await page
    .locator('.wallpaper-wheel .radial-orbit')
    .evaluateAll((es) =>
      es.map((e) => parseFloat(e.style.getPropertyValue('--angle'))),
    );
  assert(
    angles.every(
      (a, i) => !i || Math.abs(a - angles[i - 1] - 360 / angles.length) < 0.001,
    ),
  );
  const missing = await page
    .locator('.wallpaper-wheel .radial-choice img')
    .evaluateAll(
      (es) => es.filter((e) => !e.complete || !e.naturalWidth).length,
    );
  assert.equal(missing, 0);
  const before = await page
    .locator('.wallpaper-wheel .radial-choice')
    .evaluateAll((es) => es.map((e) => e.dataset.item));
  const a = await page.locator('[data-item=weread]').boundingBox(),
    b = await page.locator('[data-item=sspai]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page
    .locator('.wallpaper-wheel .radial-choice')
    .evaluateAll((es) => es.map((e) => e.dataset.item));
  assert.notDeepEqual(before, after);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForTimeout(500);
  await open();
  assert.deepEqual(
    await page
      .locator('.wallpaper-wheel .radial-choice')
      .evaluateAll((es) => es.map((e) => e.dataset.item)),
    after,
  );
  console.log('PASS icons, equal spacing, drag order persists');
  await page.locator('.wallpaper-wheel [data-item=add]').click();
  await expect(page.locator('.shortcut-dialog')).toBeVisible();
  await page.locator('#shortcut-name').fill('测试网址');
  await page.locator('#shortcut-url').fill('javascript:alert(1)');
  await page.locator('.shortcut-dialog button[type=submit]').click();
  await expect(page.locator('[role=alert]')).toBeVisible();
  await page.locator('#shortcut-url').fill('https://example.com/');
  await page.locator('.shortcut-dialog button[type=submit]').click();
  await expect(page.locator('.shortcut-dialog')).toHaveCount(0);
  await open();
  await expect(page.locator('.wallpaper-wheel .radial-choice')).toHaveCount(10);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.mouse.move(700, 520);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(230);
  await expect(wheel).toHaveClass(/is-open/);
  await page.mouse.move(710, 525);
  assert.equal(
    await page
      .locator('.wallpaper-wheel .radial-marker')
      .evaluate((e) => e.style.opacity),
    '0',
  );
  await page.mouse.up({ button: 'right' });
  await expect(wheel).toHaveCount(0);
  await page.mouse.move(700, 520);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(300);
  await expect(wheel).toHaveClass(/is-open/);
  await page.mouse.move(700, 400);
  await expect(wheel.locator('.radial-marker')).not.toHaveAttribute(
    'data-target',
    '',
  );
  await page.mouse.move(700, 520);
  await expect(wheel.locator('.radial-marker')).toHaveAttribute(
    'data-target',
    '',
  );
  await page.mouse.up({ button: 'right' });
  await expect(wheel).toHaveCount(0);
  console.log(
    'PASS add URL validation; hold release in center closes, including returning from a selection',
  );
  await page.route('https://weread.qq.com/**', (r) =>
    r.fulfill({ body: 'test' }),
  );
  await context.route('https://weread.qq.com/**', (r) =>
    r.fulfill({ body: 'test' }),
  );
  await page.mouse.move(700, 520);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(400);
  const target = await page.locator('[data-item=weread]').boundingBox();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
  );
  await page.waitForTimeout(50);
  assert.equal(
    await page
      .locator('.wallpaper-wheel .radial-marker')
      .evaluate((e) => e.style.opacity),
    '1',
  );
  const newPage = context.waitForEvent('page');
  await page.mouse.up({ button: 'right' });
  const opened = await newPage;
  await opened.waitForLoadState();
  assert(opened.url().startsWith('https://weread.qq.com/'));
  await opened.close();
  console.log('PASS long hold release opens selected URL in new tab');
  await page.bringToFront();
  await page.waitForTimeout(250);
  await open(8, 8);
  const boxes = await page
    .locator('.wallpaper-wheel .radial-choice')
    .evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
  assert(
    boxes.every(
      (b) => b.x >= 0 && b.y >= 0 && b.right <= 1440 && b.bottom <= 900,
    ),
  );
  await page.screenshot({ path: 'work/wallpaper-wheel.png' });
  assert.deepEqual(errors, []);
  console.log('PASS viewport clamping; no runtime errors');
} finally {
  await context.close();
}
