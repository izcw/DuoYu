import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const dir = await mkdtemp(path.resolve('work/home-navigation-'));
const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const channel = process.env.TEST_BROWSER_CHANNEL || 'msedge';
const context = await chromium.launchPersistentContext(
  path.join(dir, 'profile'),
  {
    channel,
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args:
      channel === 'chrome'
        ? ['--enable-unsafe-extension-debugging']
        : [
            '--load-extension=' + extension,
            '--disable-extensions-except=' + extension,
          ],
  },
);
const page = await context.newPage();
try {
  if (channel === 'chrome') {
    const session = await context.browser().newBrowserCDPSession();
    const { id } = await session.send('Extensions.loadUnpacked', {
      path: extension,
    });
    await session.detach();
    const matches = (worker) => new URL(worker.url()).host === id;
    if (!context.serviceWorkers().some(matches))
      await context.waitForEvent('serviceworker', { predicate: matches });
    await page.goto(`chrome-extension://${id}/newtab.html`);
  } else {
    await page.goto('chrome://newtab');
  }
  const home = page.locator('main[data-desktop-page]');
  const hint = page.getByRole('complementary', { name: '桌面导航快捷键' });
  const search = page.locator('#search-input');
  const overlay = page.getByRole('dialog', { name: '工作区', exact: true });
  const pages = page.locator('[data-library-page-id]');
  await page
    .locator('[data-library-page-id="library-demo"]')
    .waitFor({ state: 'attached' });
  const ids = await pages.evaluateAll((nodes) =>
    nodes.map((n) => n.dataset.libraryPageId),
  );
  assert.equal(ids[0], 'home');
  const active = (id) =>
    expect(
      page.locator(
        id === 'home'
          ? '[data-library-page-id="home"]'
          : '[data-library-page-id="' + id + '"] button.side-menu-choice',
      ),
    ).toHaveAttribute('aria-current', 'page');
  await expect(hint).toBeVisible();
  await search.fill('wsad');
  for (const key of [
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'Escape',
  ])
    await page.keyboard.press(key);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('wsad');
  await active('home');
  await expect(overlay).toHaveCount(0);
  await search.fill('');
  await page.mouse.click(410, 90);
  await page.keyboard.press('Shift+s');
  await active('home');
  await expect(overlay).toHaveCount(0);
  await page.mouse.wheel(0, 160);
  await active(ids[1]);
  const engine = page.locator('.engine-trigger');
  await engine.click();
  const engineMenu = page.getByRole('menu', { name: '选择搜索引擎' });
  const choice = engineMenu.getByRole('menuitemradio').first();
  await expect(choice).toBeVisible();
  await choice.focus();
  await page.keyboard.press('Escape');
  await expect(engine).toHaveAttribute('aria-expanded', 'false');
  await active(ids[1]);
  await page.mouse.click(410, 90);
  await page.keyboard.press('a');
  await active('home');
  await page.keyboard.press('s');
  await active(ids[1]);
  await page.keyboard.press('ArrowUp');
  await active('home');
  await page.keyboard.press('w');
  await active(ids.at(-1));
  await page.keyboard.press('ArrowDown');
  await active('home');
  for (const key of ['a', 'ArrowLeft', 'Escape']) {
    await page.keyboard.press('s');
    await active(ids[1]);
    await page.keyboard.press(key);
    await active('home');
  }
  for (const [open, close] of [
    ['d', 'a'],
    ['ArrowRight', 'ArrowLeft'],
    ['d', 'Escape'],
  ]) {
    await page.keyboard.press('s');
    await active(ids[1]);
    await page.keyboard.press(open);
    await expect(overlay).toBeFocused();
    await page.keyboard.press(close);
    await expect(overlay).toHaveCount(0);
    await active('home');
  }
  await page.keyboard.press('d');
  const filter = page.locator('.workspace-search input');
  await filter.fill('adsw');
  await page.keyboard.press('ArrowLeft');
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue('adsw');
  await page.keyboard.press('Escape');
  await expect(filter).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  // Seed two actual ordered spaces ahead of the default and a stale selection
  // from an older release. Opening via the hotkey or Dock must start at #1.
  await page.evaluate(async () => {
    localStorage.setItem('duoyu:active-space', 'marked');
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('duoyu');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('workspaceSpaces', 'readwrite'),
          spaces = tx.objectStore('workspaceSpaces');
        spaces.put({ id: 'nav-first', name: '排序第一', order: -2 });
        spaces.put({ id: 'nav-next', name: '排序第二', order: -1 });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  await page.reload();
  await expect(search).toBeVisible();
  await page.mouse.click(410, 90);
  await page.keyboard.press('d');
  const heading = overlay.locator('h1');
  await expect(heading).toHaveText('排序第一');
  for (const [key, name] of [
    ['s', '排序第二'],
    ['ArrowUp', '排序第一'],
    ['w', '标记'],
    ['ArrowUp', '个人空间'],
    ['ArrowDown', '标记'],
    ['ArrowDown', '排序第一'],
  ]) {
    await page.keyboard.press(key);
    await expect(heading).toHaveText(name);
  }
  await page.getByRole('button', { name: '标记', exact: true }).click();
  await page.keyboard.press('s');
  await expect(heading).toHaveText('排序第一');
  await page.keyboard.press('s');
  await expect(heading).toHaveText('排序第二');
  await filter.fill('ws');
  await page.keyboard.press('ArrowDown');
  await expect(filter).toHaveValue('ws');
  await expect(heading).toHaveText('排序第二');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '快捷 Dock' })
    .getByRole('button', { name: '标签工作区' })
    .click();
  await expect(heading).toHaveText('排序第一');
  await page.keyboard.press('ArrowDown');
  await expect(heading).toHaveText('排序第二');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(hint).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  for (const [index, bright] of [
    [0, 'WS'],
    [1, 'AD'],
  ]) {
    const keys = hint.locator('svg.nav-keys').nth(index);
    for (const key of 'WASD') {
      const group = keys.locator('[data-key="' + key + '"]');
      await expect(group.locator('rect')).toHaveAttribute('opacity', '0.55');
      await expect(group.locator('rect')).toHaveAttribute(
        'stroke-width',
        '0.8',
      );
      await expect(group.locator('path')).toHaveAttribute(
        'opacity',
        bright.includes(key) ? '1' : '0.32',
      );
    }
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(hint).toBeVisible();
    // ResizeObserver positions the hint after the viewport change is laid out.
    await expect
      .poll(async () => {
        const h = await hint.boundingBox(),
          d = await page.locator('.desktop-dock').boundingBox();
        return (
          !!h &&
          !!d &&
          h.x >= 0 &&
          h.x + h.width <= width &&
          h.y + h.height <= 900 &&
          (h.y + h.height <= d.y || h.x >= d.x + d.width)
        );
      })
      .toBe(true);
    await hint.screenshot({ path: path.join(dir, 'hint-' + width + '.png') });
    await page.screenshot({ path: path.join(dir, 'home-' + width + '.png') });
  }
  await expect(home).toHaveAttribute('data-desktop-page', '0');
  await writeFile(
    path.join(dir, 'results.json'),
    JSON.stringify({ channel, passed: true, ids, viewports: [1440, 390] }),
  );
  console.log(
    'PASS home paging, workspace return, search isolation and hint layout:',
    dir,
  );
} catch (error) {
  console.error(
    await page.evaluate(() => ({
      focus: document.activeElement?.outerHTML.slice(0, 210),
      page: document.querySelector('main')?.getAttribute('data-desktop-page'),
      layers: [
        ...document.querySelectorAll(
          '[role=dialog],[role=menu],.library-editor,.grid-selection-box,.ui-draggable-dragging,.radial-wheel[aria-hidden=false]',
        ),
      ].map((e) => [e.className, !!e.getClientRects().length]),
    })),
  );
  throw error;
} finally {
  await context.close();
}
