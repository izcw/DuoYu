import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/widget-tests-')),
  {
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true,
    hasTouch: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
  },
);
try {
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const page = await context.newPage();
  await page.goto('chrome://newtab');
  const first = page.locator('[gs-id=widget-1]');
  const card = first.locator('.widget-card');
  await card.waitFor();
  await page.waitForTimeout(400);
  const order = () =>
    page
      .locator('.bottom-widget-grid > .grid-stack-item')
      .evaluateAll((els) =>
        els.map((el) => [
          el.getAttribute('gs-id'),
          el.getAttribute('gs-x') || '0',
          el.getAttribute('gs-y') || '0',
        ]),
      );
  await expect(page.locator('.widget-link')).toHaveCount(9);
  const broken = await page
    .locator('.widget-link img')
    .evaluateAll(
      (images) =>
        images.filter((img) => !img.complete || !img.naturalWidth).length,
    );
  assert.equal(broken, 0);
  await context.route('https://chatgpt.com/**', (route) =>
    route.fulfill({ body: 'ChatGPT test' }),
  );
  const newTab = context.waitForEvent('page');
  await page.getByRole('link', { name: 'ChatGPT', exact: true }).click();
  const opened = await newTab;
  await opened.waitForLoadState();
  assert(opened.url().startsWith('https://chatgpt.com/'));
  await opened.close();
  await page.bringToFront();
  console.log('PASS nine local icons and new-tab link navigation');
  const initial = await order();
  const a = await card.boundingBox();
  assert.equal(a.width, 300);
  assert.equal(a.height, 160);
  await page.mouse.move(a.x + 100, a.y + 24);
  await page.mouse.down();
  await page.mouse.move(a.x + 420, a.y + 24, { steps: 3 });
  await page.mouse.up();
  assert.deepEqual(await order(), initial);
  console.log('PASS quick drag cannot reorder');
  await page.mouse.move(a.x + 100, a.y + 24);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await expect(first).toHaveClass(/ui-draggable-armed/);
  await page.mouse.move(a.x + 740, a.y + 24, { steps: 20 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.notDeepEqual(await order(), initial);
  console.log('PASS long press reorders', await order());
  for (const item of await page
    .locator('.bottom-widget-grid .widget-card')
    .all()) {
    const box = await item.boundingBox();
    assert.equal(box.width, 300);
    assert.equal(box.height, 160);
  }
  assert.equal(
    await page
      .locator('.bottom-widget-grid .ui-resizable-handle:visible')
      .count(),
    0,
  );
  const cdp = await context.newCDPSession(page);
  const touchCard = page.locator('[gs-id=widget-2] .widget-card');
  const t = await touchCard.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: t.x + 100, y: t.y + 24 }],
  });
  await page.waitForTimeout(350);
  await expect(page.locator('[gs-id=widget-2]')).toHaveClass(
    /ui-draggable-armed/,
  );
  for (let i = 1; i <= 12; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: t.x + 100 + (i * 320) / 12, y: t.y + 24 }],
    });
  await page.waitForTimeout(250);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(400);
  await expect(
    page.locator('.bottom-widget-grid .ui-draggable-dragging'),
  ).toHaveCount(0);
  console.log('PASS native touch long press drag and cleanup');
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(400);
  for (const item of await page
    .locator('.bottom-widget-grid .widget-card')
    .all())
    assert.equal((await item.boundingBox()).width, 300);
  await page.screenshot({ path: 'work/widgets-drag.png' });
  console.log('PASS fixed size, no resize handles, responsive reflow');
} finally {
  await context.close();
}
