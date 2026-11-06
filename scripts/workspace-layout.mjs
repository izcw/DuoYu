import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

// Use an isolated offline profile with a populated test collection.
await mkdir('work', { recursive: true });
const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const profile = await mkdtemp(path.resolve('work/workspace-layout-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
  headless: true,
  viewport: { width: 390, height: 780 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--load-extension=' + extension,
    '--disable-extensions-except=' + extension,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const account = {
    issuer: 'https://fixture.invalid',
    sub: 'workspace-layout',
    name: '工作区测试',
  };
  const owner = createHash('sha256')
    .update(account.issuer + '\0' + account.sub)
    .digest('hex');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.setOffline(true);
  await page.addInitScript(
    ({ account, owner }) => {
      localStorage.setItem('duoyu-sync-account', owner);
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message) =>
        message.type === 'duoyu-auth' && message.action === 'status'
          ? Promise.resolve({ view: { account } })
          : send(message);
    },
    { account, owner },
  );
  await page.goto(
    'chrome-extension://' + new URL(worker.url()).host + '/newtab.html',
  );

  await page.locator('.clock-time').waitFor();
  await page.evaluate(async (owner) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('duoyu-account-' + owner);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction(
      ['workspaceSpaces', 'tabCollections'],
      'readwrite',
    );
    for (const [order, id] of ['default', 'other'].entries())
      tx.objectStore('workspaceSpaces').put({ id, order, name: id });
    const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
    tx.objectStore('tabCollections').put({
      id: 'test-layout',
      spaceId: 'default',
      order: 0,
      name: '浏览器测试',
      updatedAt: 1,
      tabs: titles.map((title, i) => ({
        id: 'test-' + i,
        title,
        url: 'https://example.test/' + title,
        savedAt: 1,
      })),
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, owner);
  await page.reload();
  const open = () =>
    page.getByRole('button', { name: '标签工作区', exact: true }).click();
  await open();
  const board = page.locator('.workspace-board');
  const group = board.locator('[data-collection-id="test-layout"]');
  const cards = group.locator('[data-saved-id]');
  const grid = board.getByRole('button', { name: '网格', exact: true });
  const list = board.getByRole('button', { name: '列表', exact: true });
  const search = board.getByRole('searchbox');
  const moving = () =>
    cards.evaluateAll((nodes) =>
      nodes.some((el) =>
        el
          .getAnimations({ subtree: true })
          .some((a) => a.playState === 'running'),
      ),
    );
  await expect(cards).toHaveCount(6);
  async function checkSurfaceDuringMotion() {
    const samples = await cards.evaluateAll((nodes) => {
      const animations = nodes
        .flatMap((el) => el.getAnimations({ subtree: true }))
        .filter((animation) =>
          animation.effect.getKeyframes().some((frame) => frame.transform),
        );
      const samples = [];
      for (const offset of [0.2, 0.5, 0.8, 1]) {
        for (const animation of animations) {
          animation.pause();
          animation.currentTime =
            animation.effect.getTiming().duration * offset;
        }
        samples.push(
          nodes.map((el) => {
            const { x, y, width, height } = el.getBoundingClientRect();
            const icon = el
              .querySelector('.workspace-icon-slot')
              .getBoundingClientRect();
            return {
              surface: {
                x,
                y,
                width,
                height,
                radius: getComputedStyle(el).borderRadius,
              },
              iconX: icon.x,
              iconY: icon.y,
            };
          }),
        );
      }
      for (const animation of animations) animation.finish();
      return samples;
    });
    for (const sample of samples.slice(0, -1)) {
      sample.forEach(({ surface }, i) => {
        assert.deepEqual(
          surface,
          samples.at(-1)[i].surface,
          'Background and border must keep the destination geometry throughout the switch',
        );
      });
    }
    assert.ok(
      samples[0].some(
        (card, i) =>
          Math.hypot(
            card.iconX - samples.at(-1)[i].iconX,
            card.iconY - samples.at(-1)[i].iconY,
          ) > 1,
      ),
      'Foreground should travel independently of the surface',
    );
  }
  for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 840 });
    await expect(grid).toHaveAttribute('aria-pressed', 'true');
    const first = cards.nth(0),
      second = cards.nth(1);
    const icon = first.locator('.workspace-icon-slot'),
      title = first.locator('strong');
    assert.equal((await first.boundingBox()).y, (await second.boundingBox()).y);
    assert.ok(
      (await title.boundingBox()).y >=
        (await icon.boundingBox()).y + (await icon.boundingBox()).height,
    );
    await list.press('Enter');
    await expect.poll(moving).toBe(true);
    await grid.press('Enter');
    await expect.poll(moving).toBe(false);
    await list.click();
    await checkSurfaceDuringMotion();
    await expect.poll(moving).toBe(false);
    assert.equal((await first.boundingBox()).x, (await second.boundingBox()).x);
    assert.ok((await second.boundingBox()).y > (await first.boundingBox()).y);
    assert.ok((await title.boundingBox()).x > (await icon.boundingBox()).x);
    await search.fill('Charlie');
    await expect(cards).toHaveCount(1);
    await grid.click();
    await checkSurfaceDuringMotion();
    await expect(cards.first()).toContainText('Charlie');
    await search.fill('');
    await expect(cards).toHaveCount(6);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await list.click();
  assert.equal(await moving(), false);
  await page.keyboard.press('s');
  await expect(cards).toHaveCount(0);
  await page.keyboard.press('w');
  await expect(cards).toHaveCount(6);
  await page.reload();
  await open();
  await expect(list).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.locator('strong')).toHaveText([
    'Alpha',
    'Bravo',
    'Charlie',
    'Delta',
    'Echo',
    'Foxtrot',
  ]);
  assert.deepEqual(errors, []);
  console.log(
    'PASS desktop/mobile card and list geometry, real motion, reversal, keyboard, filter, space navigation, reduced motion and persisted order/view',
  );
} finally {
  await context.close();
}
