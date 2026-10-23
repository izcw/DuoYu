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
    viewport: { width: 1440, height: 1000 },
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
  await page.mouse.move(1200, 400);
  await page.mouse.wheel(0, 180);
  await page
    .locator('[data-library-page-id="library-demo"] .library-page-choice')
    .click();
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('duoyu');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('libraryItems', 'readwrite');
          const store = tx.objectStore('libraryItems');
          store.clear();
          store.put({
            id: 'free-note',
            kind: 'widget',
            widgetType: 'note',
            name: '便签',
            pageId: 'library-demo',
            parent: '',
            order: 0,
            width: 3,
            height: 1,
            gridX: 0,
            gridY: 0,
          });
          store.put({
            id: 'free-link',
            kind: 'link',
            name: '测试',
            url: 'https://example.com',
            pageId: 'library-demo',
            parent: '',
            order: 1,
            width: 1,
            height: 1,
            gridX: 10,
            gridY: 1,
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  async function reopen() {
    await page.reload();
    await page
      .locator('[data-library-page-id="library-demo"]')
      .waitFor({ state: 'attached' });
    await page.mouse.move(1200, 400);
    await page.mouse.wheel(0, 180);
    await page
      .locator('[data-library-page-id="library-demo"] .library-page-choice')
      .click();
    await expect(page.locator('[data-library-id="free-note"]')).toBeVisible();
    await page.waitForTimeout(800);
  }
  await reopen();
  const grid = page.locator('.library-cell-grid');
  assert.equal(await grid.evaluate((el) => el.gridstack.engine.mode), 'float');
  async function move(id, x, y) {
    const item = page.locator(`[data-library-id="${id}"]`);
    const box = await item.boundingBox();
    const bounds = await grid.boundingBox();
    const cw = bounds.width / 12;
    const ch = await grid.evaluate((el) => el.gridstack.getCellHeight());
    await page.mouse.move(box.x + 25, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(bounds.x + x * cw + 25, bounds.y + y * ch + 20, {
      steps: 20,
    });
    await expect(grid).toHaveClass(/grid-guides-visible/);
    await expect
      .poll(() =>
        grid.evaluate((el) => getComputedStyle(el, '::before').opacity),
      )
      .toBe('1');
    assert.equal(
      await grid.evaluate(
        (el) => getComputedStyle(el, '::before').pointerEvents,
      ),
      'none',
    );
    await page.mouse.up();
    await expect(grid).not.toHaveClass(/grid-guides-visible/);
    await expect
      .poll(() =>
        grid.evaluate((el) => getComputedStyle(el, '::before').opacity),
      )
      .toBe('0');
    await expect(item).toHaveAttribute('gs-x', String(x));
    await expect(item).toHaveAttribute('gs-y', String(y));
    await page.waitForTimeout(800);
  }
  await move('free-note', 4, 4);
  await move('free-link', 9, 5);
  await expect(page.locator('[data-library-id="free-note"]')).toHaveAttribute(
    'gs-y',
    '4',
  );
  await reopen();
  for (const [id, x, y] of [
    ['free-note', 4, 4],
    ['free-link', 9, 5],
  ]) {
    await expect(page.locator(`[data-library-id="${id}"]`)).toHaveAttribute(
      'gs-x',
      String(x),
    );
    await expect(page.locator(`[data-library-id="${id}"]`)).toHaveAttribute(
      'gs-y',
      String(y),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS widget and icon free placement, gaps, unaffected neighbors, reload persistence',
  );
} finally {
  await context.close();
}
