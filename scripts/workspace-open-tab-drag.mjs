import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { prepareEditableDesktop } from './fixtures/editable-desktop.mjs';

const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext('', {
  channel: 'msedge', headless: true, viewport: { width: 1440, height: 960 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension],
});
try {
  await context.route(/^https?:/, route => route.fulfill({ contentType: 'text/html', body: '<title>Tab</title>' }));
  await prepareEditableDesktop(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('chrome-extension://' + new URL(context.serviceWorkers()[0].url()).host + '/newtab.html');
  await page.locator('.clock-time').waitFor();
  const ids = await page.evaluate(async () => {
    const ids = [];
    for (let n = 0; n < 9; n++)
      ids.push((await chrome.tabs.create({ url: 'https://example.invalid/drag/' + n, active: false })).id);
    return ids;
  });
  await page.getByRole('button', { name: '标签工作区', exact: true }).first().click();
  const row = id => page.locator('[data-browser-tab-id="' + id + '"]');
  await expect(row(ids[8])).toBeVisible();
  const nativeOrder = () => page.evaluate(async ids => (await chrome.tabs.query({currentWindow: true}))
    .filter(t => ids.includes(t.id)).sort((a,b) => a.index - b.index).map(t => t.id), ids);
  async function start(id) {
    await row(id).scrollIntoViewIfNeeded();
    const r = await row(id).boundingBox();
    const x = r.x + 70, y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 8, y);
    await expect(row(id)).toHaveClass(/is-drag-source/);
  }
  async function frame() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function boundary(source, upper, lower, cancel = false) {
    await start(source);
    const a = await row(upper).boundingBox(), b = await row(lower).boundingBox();
    const x = a.x + 75, y = (a.y + a.height + b.y) / 2;
    await page.mouse.move(x, y, { steps: 6 });
    await frame();
    // A shaky hand hovering in the same inter-row gap should keep one landing position.
    const samples = [];
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(x + i % 2, y + (i % 2 ? 1 : -1));
      await frame();
      const visualOrder = await page.locator('.workspace-browser-group [data-browser-tab-id]').evaluateAll(
        (rows, source) => rows.filter(el => Number(el.dataset.browserTabId) !== source)
          .map(el => Math.round(el.getBoundingClientRect().top)), source);
      samples.push(visualOrder);
    }
    const tail = samples.slice(-8);
    const maxMovement = Math.max(...tail[0].map((_, i) =>
      Math.max(...tail.map(frame => frame[i])) - Math.min(...tail.map(frame => frame[i]))));
    console.log('stationary boundary movement (px):', maxMovement);
    assert.ok(maxMovement <= 1, 'neighbouring tabs kept moving after the pointer settled in the same gap');
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  }
  await boundary(ids[0], ids[2], ids[3]);
  const moved = [ids[1], ids[2], ids[0], ...ids.slice(3)];
  await expect.poll(nativeOrder).toEqual(moved);
  await boundary(ids[4], ids[1], ids[2], true);
  assert.deepEqual(await nativeOrder(), moved);

  const groupId = await page.evaluate(tabIds => chrome.tabs.group({ tabIds }), ids.slice(5, 7));
  const members = () => page.evaluate(async id => (await chrome.tabs.query({ groupId: id }))
    .sort((a,b) => a.index - b.index).map(t => t.id), groupId);
  await expect(page.locator('[data-group-id="' + groupId + '"] [data-browser-tab-id]')).toHaveCount(2);
  async function dropAtCenter(source, target) {
    await start(source);
    await row(target).scrollIntoViewIfNeeded();
    const box = await row(target).boundingBox();
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  }
  await dropAtCenter(ids[1], ids[5]);
  await expect.poll(members).toEqual([ids[5], ids[1], ids[6]]);
  await dropAtCenter(ids[1], ids[2]);
  await expect.poll(members).toEqual(ids.slice(5, 7));
  await expect.poll(nativeOrder).toEqual(moved);
  await expect(page.locator('[data-tab-preview], .is-drag-source')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS stable row gaps, Escape, native tab order, and dragging into and out of a group');
} finally { await context.close(); }
