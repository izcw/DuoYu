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
    viewport: { width: 1920, height: 1800 },
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

  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('duoyu');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('libraryItems', 'readwrite');
      const store = tx.objectStore('libraryItems');
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result)
          if (item.pageId === 'home') store.delete(item.id);
        const base = {
          pageId: 'home',
          parent: '',
          url: 'https://example.com',
          icon: '',
          updatedAt: Date.now(),
        };
        store.put({
          ...base,
          id: 'align-widget',
          name: 'Weather',
          kind: 'widget',
          widget: 'weather',
          gridX: 0,
          gridY: 0,
          width: 2,
          height: 2,
          order: 0,
        });
        for (let i = 0; i < 2; i++)
          store.put({
            ...base,
            id: 'align-link-' + i,
            name: 'Link ' + i,
            kind: 'link',
            gridX: 2,
            gridY: i,
            width: 1,
            height: 1,
            order: i + 1,
          });
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator('[data-library-id="align-link-1"]')).toBeVisible();
  await page.waitForTimeout(600);
  const geometry = await page.evaluate(() => {
    const rect = (id, sel) =>
      document
        .querySelector(`[data-library-id="${id}"] ${sel}`)
        .getBoundingClientRect();
    const panel = rect('align-widget', '.cell-tile');
    const label = rect('align-widget', '.tile-caption');
    const scale =
      document.querySelector('.library-cell-grid').getBoundingClientRect()
        .width /
      (16 * 84);
    return {
      scale,
      panelTop: panel.top,
      panelWidth: panel.width,
      panelHeight: panel.height,
      labelBottom: label.bottom,
      links: [0, 1].map((i) => {
        const icon = rect('align-link-' + i, '.cell-icon'),
          title = rect('align-link-' + i, '.tile-caption');
        return {
          top: icon.top,
          gap: title.top - icon.bottom,
          bottom: title.bottom,
        };
      }),
    };
  });
  assert.ok(Math.abs(geometry.links[0].top - geometry.panelTop) < 1);
  assert.ok(Math.abs(geometry.links[1].bottom - geometry.labelBottom) < 1);
  for (const link of geometry.links)
    assert.ok(Math.abs(link.gap - 4 * geometry.scale) < 1);
  assert.ok(Math.abs(geometry.panelWidth - geometry.panelHeight) < 1);
  assert.deepEqual(errors, []);
  console.log(
    'PASS compact icon-caption gap, top of first icon and bottom of last caption align with adjacent widget',
  );
} finally {
  await context.close();
}
