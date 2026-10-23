import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/widget-links-')),
  {
    channel: 'msedge',
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page.locator('.widget-link').first().waitFor();
  await page.waitForTimeout(500);
  const links = (group) =>
    page
      .locator(`[data-link-group=${group}] [data-link-id]`)
      .evaluateAll((es) => es.map((e) => e.dataset.linkId));
  const move = async (id, group, index) => {
    const a = await page.locator(`[data-link-id=${id}]`).boundingBox();
    const b = await page
      .locator(`[data-link-group=${group}] [data-link-slot="${index}"]`)
      .boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 16);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 18, { steps: 12 });
    // Verify reflow happens while still holding the pointer.
    await page.waitForTimeout(220);
    const targetIds = await links(group);
    if (targetIds.length < 8 || targetIds.includes(id)) {
      assert.equal(targetIds[Math.min(index, targetIds.length - 1)], id);
    }
    await expect(page.locator('.is-drop-target')).toHaveCount(0);
    await page.mouse.up();
    await page.waitForTimeout(450);
  };
  for (const group of ['widget-1', 'widget-2', 'widget-3']) {
    const slots = page.locator(`[data-link-group=${group}] [data-link-slot]`);
    await expect(slots).toHaveCount(8);
    const boxes = await slots.evaluateAll((es) =>
      es.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y };
      }),
    );
    assert.equal(new Set(boxes.map((b) => b.x)).size, 4);
    assert.equal(new Set(boxes.map((b) => b.y)).size, 2);
  }
  const desktop = page.locator('.desktop-pages');
  const homeY = (await page.locator('.bottom-widgets').boundingBox()).y;
  await page.mouse.move(1200, 450);
  await page.mouse.wheel(0, 160);
  await expect(desktop).toHaveAttribute('data-desktop-page', '1');
  await page.waitForTimeout(700);
  assert((await page.locator('.bottom-widgets').boundingBox()).y < homeY - 80);
  await expect(
    page.getByRole('navigation', { name: '收藏页面' }),
  ).toHaveAttribute('aria-hidden', 'false');
  await page.screenshot({ path: 'work/desktop-second-page.png' });
  await page.mouse.wheel(0, -160);
  await expect(desktop).toHaveAttribute('data-desktop-page', '0');
  await page.waitForTimeout(700);
  const pageCount = context.pages().length;
  await move('chatgpt', 'widget-1', 2);
  assert.deepEqual(await links('widget-1'), ['deepseek', 'claude', 'chatgpt']);
  await move('chatgpt', 'widget-2', 1);
  assert.deepEqual(await links('widget-1'), ['deepseek', 'claude']);
  assert.deepEqual(await links('widget-2'), [
    'bilibili',
    'chatgpt',
    'xiaohongshu',
    'music',
  ]);
  assert.equal(context.pages().length, pageCount);
  const savedOrder = await page
    .locator('[data-link-id]')
    .evaluateAll((es) => es.map((e) => e.dataset.linkId));
  await page.addInitScript(() => {
    window.__firstLayout = [];
    const observer = new MutationObserver(() => {
      const links = [...document.querySelectorAll('[data-link-id]')].map(
        (el) => el.dataset.linkId,
      );
      if (links.length && !window.__firstLayout.length)
        window.__firstLayout = links;
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await page.waitForTimeout(600);
  assert.deepEqual(
    await page.evaluate(() => window.__firstLayout),
    savedOrder,
    'First rendered layout must already match saved order',
  );
  const overflow = await page.locator('.widget-card').evaluateAll((es) =>
    es.map((el) => ({
      x: getComputedStyle(el).overflowX,
      y: getComputedStyle(el).overflowY,
    })),
  );
  assert(
    overflow.every((style) => style.x === 'hidden' && style.y === 'hidden'),
  );
  console.log(
    'PASS first render uses saved order without default-order flash; card scrollbars disabled',
  );

  assert.deepEqual(await links('widget-2'), [
    'bilibili',
    'chatgpt',
    'xiaohongshu',
    'music',
  ]);
  console.log(
    'PASS 2x4 slots, reorder, cross-card transfer, no accidental navigation, persistence',
  );
  for (const id of ['deepseek', 'claude', 'github', 'deepl'])
    await move(id, 'widget-2', 7);
  assert.equal((await links('widget-2')).length, 8);
  await move('mail', 'widget-2', 7);
  assert.deepEqual(await links('widget-3'), ['mail']);
  await expect(page.locator('.widget-layout-notice')).toContainText(
    '最多放置 8',
  );
  const all = await page
    .locator('[data-link-id]')
    .evaluateAll((es) => es.map((e) => e.dataset.linkId));
  assert.equal(new Set(all).size, 9);
  assert.equal(all.length, 9);
  const a = await page.locator('[data-link-id=mail]').boundingBox();
  await page.mouse.move(a.x + 10, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(600, 500, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await links('widget-3'), ['mail']);
  await expect(page.locator('.widget-link-drag-preview')).toHaveCount(0);
  await page.screenshot({ path: 'work/widget-links-layout.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS full-card rejection, empty-card support, no duplicates/loss, Escape cancellation',
  );
} finally {
  await context.close();
}
