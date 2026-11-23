import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { prepareEditableDesktop } from './fixtures/editable-desktop.mjs';

const extension = path.resolve(process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3');
const context = await chromium.launchPersistentContext('', {
  channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true,
  viewport: { width: 1600, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension],
});
try {
  await context.route(/^https?:/, route => route.abort());
  await prepareEditableDesktop(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('chrome-extension://' + new URL(context.serviceWorkers()[0].url()).host + '/newtab.html');
  await page.locator('.clock-time').waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('duoyu-account-' + localStorage.getItem('duoyu-sync-account'));
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const tx = db.transaction('tabCollections', 'readwrite');
      for (let g = 0; g < 12; g++) {
        const tabs = Array.from({ length: g < 2 ? 5 : 30 }, (_, t) => ({
          id: g + '-' + t, title: '链接 ' + g + '/' + t, savedAt: 1,
          icon: '/icons/16.png', url: 'https://example.invalid/' + g + '/' + t,
        }));
        tx.objectStore('tabCollections').put({ id: 'g' + g, spaceId: 'default', name: '集合 ' + g, order: g, updatedAt: 1, tabs });
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  const enter = () => page.getByRole('button', { name: '标签工作区', exact: true }).first().click();
  await enter();
  await expect(page.locator('[data-saved-id]')).toHaveCount(310);
  await page.locator('.workspace-collections').evaluate(async el => {
    await Promise.allSettled(el.getAnimations({ subtree: true }).map(a => a.finished));
  });
  await page.evaluate(() => {
    const original = Element.prototype.getBoundingClientRect;
    const offPath = new WeakSet(document.querySelectorAll('.workspace-collection:nth-child(n+3) [data-saved-id]'));
    let recording = false, previous = 0, frame, unrelated = 0, releaseAt = 0, releaseMs = null;
    let gaps = [];
    Element.prototype.getBoundingClientRect = function () {
      if (recording && offPath.has(this)) unrelated++;
      return original.call(this);
    };
    document.addEventListener('mouseup', () => { if (recording) releaseAt = performance.now(); }, true);
    function sample(t) {
      if (releaseAt) {
        if (releaseMs === null && !document.querySelector('.workspace-board > .drag-landing-preview'))
          releaseMs = performance.now() - releaseAt;
      } else if (previous) gaps.push(t - previous);
      previous = t;
      frame = requestAnimationFrame(sample);
    }
    window.beginDragSample = () => {
      previous = unrelated = releaseAt = 0; releaseMs = null; gaps = []; recording = true;
      frame = requestAnimationFrame(sample);
    };
    window.endDragSample = () => {
      cancelAnimationFrame(frame); recording = false;
      gaps.sort((a, b) => a - b);
      return { unrelatedCardReads: unrelated, frames: gaps.length,
        p95FrameMs: Math.round(gaps[Math.floor(gaps.length * .95)] || 0), releaseMs: Math.round(releaseMs ?? -1) };
    };
  });
  const group = n => page.locator('[data-collection-id="g' + n + '"]');
  const order = n => group(n).locator('[data-saved-id]').evaluateAll(cards => cards.map(c => c.dataset.savedId));
  async function drag(toGroup) {
    const first = await order(0);
    const source = page.locator('[data-saved-id="' + first[0] + '"]');
    const start = await source.boundingBox();
    const endpoints = await group(toGroup).locator('[data-saved-id]').evaluateAll(cards => cards.slice(0, 4).map(c => {
      const r = c.getBoundingClientRect();
      return { x: r.x + r.width * .32, y: r.y + r.height * .55 };
    }));
    await page.mouse.move(start.x + start.width * .4, start.y + start.height * .55);
    await page.mouse.down();
    await page.evaluate(() => window.beginDragSample());
    for (const i of [3, 0, 3, 0, 3]) await page.mouse.move(endpoints[i].x, endpoints[i].y, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => window.endDragSample());
    console.log(toGroup ? 'cross-collection' : 'within collection', JSON.stringify(metrics));
    if (toGroup) {
      await expect(group(1).locator('[data-saved-id="' + first[0] + '"]')).toHaveCount(1);
      await expect(group(0).locator('[data-saved-id="' + first[0] + '"]')).toHaveCount(0);
    } else assert.notDeepEqual(await order(0), first);
    return metrics;
  }
  const within = await drag(0), cross = await drag(1);
  const final = [await order(0), await order(1)];
  await page.reload(); await enter();
  await expect(group(1).locator('[data-saved-id]')).toHaveCount(6);
  assert.deepEqual([await order(0), await order(1)], final);
  for (const sample of [within, cross]) {
    assert.ok(sample.frames > 0);
    assert.equal(sample.unrelatedCardReads, 0);
  }

  await context.route('https://example.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Workspace test</title>' }));
  const url = 'https://example.invalid/0/0';
  const other = 'https://example.invalid/0/1';
  const saved = id => page.locator('[data-saved-id="' + id + '"]');
  const dot = id => saved(id).getByRole('img', { name: '此链接已打开' });
  async function checkDotPosition() {
    await expect(dot('0-0')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    // Measure both boxes in the same frame during the grid/list transition.
    const bounds = await dot('0-0').evaluate(dot => {
      const card = dot.closest('[data-saved-id]').getBoundingClientRect();
      const mark = dot.getBoundingClientRect();
      return { width: mark.width, height: mark.height, left: mark.left - card.left, bottom: card.bottom - mark.bottom };
    });
    assert.equal(bounds.width, 6);
    assert.equal(bounds.height, 6);
    assert.ok(Math.abs(bounds.left - 10) <= 2);
    assert.ok(Math.abs(bounds.bottom - 8) <= 2);
  }
  await expect(dot('0-0')).toHaveCount(0);
  const firstTab = await page.evaluate(url => chrome.tabs.create({ url, active: false }), url);
  await expect(dot('0-0')).toBeVisible();
  await checkDotPosition();
  await expect(dot('0-1')).toHaveCount(0);
  const secondWindow = await page.evaluate(url => chrome.windows.create({ url, focused: false }), url);
  const secondTab = secondWindow.tabs[0].id;
  await page.evaluate(([id, url]) => chrome.tabs.update(id, { url }), [firstTab.id, other]);
  await expect(dot('0-1')).toBeVisible();
  await expect(dot('0-0')).toBeVisible();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await checkDotPosition();
  await page.evaluate(([id, url]) => chrome.tabs.update(id, { url }), [secondTab, url + '?variant']);
  await expect(dot('0-0')).toHaveCount(0);
  await page.evaluate(id => chrome.tabs.remove(id), firstTab.id);
  await expect(dot('0-1')).toHaveCount(0);
  await page.evaluate(id => chrome.windows.remove(id), secondWindow.id);

  const listOrder = await order(0);
  const center = async id => {
    const box = await saved(id).boundingBox();
    return [box.x + box.width * .4, box.y + box.height * .55];
  };
  const from = await center(listOrder[0]), to = await center(listOrder[2]);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 10 });
  await expect(page.locator('[data-card-preview]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-card-preview], .is-drag-source, .drag-landing-preview')).toHaveCount(0);
  assert.deepEqual(await order(0), listOrder);
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => order(0)).toEqual([listOrder[1], listOrder[2], listOrder[0], ...listOrder.slice(3)]);
  assert.deepEqual(errors, []);
  console.log('PASS grid/list drag, cancellation, persisted order, and live indicators across two windows');
} finally { await context.close(); }
