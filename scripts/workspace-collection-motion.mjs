import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { prepareEditableDesktop } from './fixtures/editable-desktop.mjs';

const extension = path.resolve(process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3');
const context = await chromium.launchPersistentContext('', {
  channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
  headless: true,
  viewport: { width: 1440, height: 900 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--load-extension=' + extension, '--disable-extensions-except=' + extension],
});
try {
  await context.route(/^https?:/, r => r.abort());
  await prepareEditableDesktop(context);
  const worker = context.serviceWorkers()[0];
  const page = await context.newPage();
  await page.goto('chrome-extension://' + new URL(worker.url()).host + '/newtab.html');
  await page.locator('.clock-time').waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open('duoyu-account-' + localStorage.getItem('duoyu-sync-account'));
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const tx = db.transaction('tabCollections', 'readwrite');
      for (let n = 0; n < 9; n++) tx.objectStore('tabCollections').put({
        id: 'g' + n, name: '测试集合 ' + n, spaceId: 'default', order: n, updatedAt: 1,
        tabs: Array.from({ length: 4 }, (_, i) => ({
          id: n + '-' + i, title: '标签 ' + i, url: 'https://example.invalid/' + n + '/' + i, savedAt: 1,
        })),
      });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  const button = (name, root = page) => root.getByRole('button', { name, exact: true });
  await button('标签工作区').first().click();
  const list = page.locator('.workspace-collections');
  const groups = list.locator('[data-collection-id]');
  await expect(groups).toHaveCount(9);
  async function sample(label, id, action, { stationary = false, scroll } = {}) {
    // Finish motion from the preceding action (e.g. folding a group) before sampling this one.
    await list.evaluate(async el => {
      await Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    await page.evaluate(id => {
      const list = document.querySelector('.workspace-collections');
      const group = list.querySelector('[data-collection-id="' + id + '"]');
      const card = group.querySelector('[data-saved-id]');
      const values = [];
      let frame;
      function record() {
        const y = group.getBoundingClientRect().top;
        values.push([y, card.getBoundingClientRect().top - y, list.scrollTop]);
        frame = requestAnimationFrame(record);
      }
      record();
      window.finishCollectionSample = () => { cancelAnimationFrame(frame); return values; };
    }, id);
    await action();
    await page.waitForTimeout(350);
    const frames = await page.evaluate(() => window.finishCollectionSample());
    const spread = values => Math.max(...values) - Math.min(...values);
    // A surviving group can move once to make room. Its children should travel
    // with it, and the group should not travel back in the opposite direction.
    const y = frames.map(f => f[0]);
    const travel = y.slice(1).reduce((sum, v, i) => sum + Math.abs(v - y[i]), 0);
    const result = { label, childDrift: spread(frames.map(f => f[1])),
      backtrack: (travel - Math.abs(y.at(-1) - y[0])) / 2,
      groupTravel: travel, scroll: [...new Set(frames.map(f => f[2]))] };
    console.log(JSON.stringify(result));
    assert.ok(result.childDrift < 2, label + ': card moved independently of its group');
    assert.ok(result.backtrack < 2, label + ': existing group jumped back');
    if (stationary) assert.ok(result.groupTravel < 2, label + ': list shifted');
    if (scroll) assert.deepEqual(result.scroll, scroll, label + ': unexpected intermediate scroll');
  }
  await sample('create', 'g0', async () => {
    await button('新建集合').click();
    await expect(groups).toHaveCount(10);
  });
  const added = groups.first();
  await button('更多集合操作', added).click();
  await sample('confirm prompt', 'g0', () => button('删除集合', added).click(), { stationary: true });
  await sample('delete', 'g0', async () => {
    await button('确认删除', added).click();
    await expect(groups).toHaveCount(9);
  });
  await sample('undo', 'g0', async () => {
    await button('撤销删除').click();
    await expect(groups).toHaveCount(10);
  });
  await list.evaluate(el => { el.scrollTop = 640; });
  await sample('create while scrolled', 'g3', async () => {
    await button('新建集合').click();
    await expect(groups).toHaveCount(11);
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0);
  }, { scroll: [640, 0] });
  await button('列表').click();
  const middle = groups.filter({ has: button('测试集合 4') });
  await middle.locator('.workspace-collection-name').click();
  await button('更多集合操作', middle).click();
  await sample('confirm a collapsed collection', 'g5', () => button('删除集合', middle).click(), { stationary: true });
  await sample('cancel deletion', 'g5', () => button('取消', middle).click(), { stationary: true });
  await expect(middle.locator('.workspace-collection-name')).toHaveAttribute('aria-expanded', 'false');
  const search = page.getByRole('searchbox', { name: '搜索工作区' });
  await search.fill('测试集合 8');
  await expect(groups).toHaveCount(1);
  await button('新建集合').click();
  await expect(groups).toHaveCount(12);
  await expect(search).toHaveValue('');
  await expect(groups.first().locator('.workspace-collection-name')).toHaveText('集合03');
} finally { await context.close(); }
