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

  const first = page.locator('[data-library-id="home-widget-1"]');
  await expect(first).toBeVisible();
  await page.waitForTimeout(800);
  const grid = page.locator('.library-cell-grid');
  const siblings = await grid.evaluate((el) =>
    el.gridstack.engine.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
    })),
  );
  const source = siblings.find((n) => n.id === 'home-widget-1');
  const neighbor = siblings.find(
    (n) => n.x === source.x + source.w && n.y === source.y,
  );
  assert.ok(neighbor);
  await first.hover();
  const handle = await first.locator(':scope > .ui-resizable-se').boundingBox();
  const cell = await grid.evaluate(
    (el) => el.getBoundingClientRect().width / 18,
  );
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + cell,
    handle.y + handle.height / 2,
    { steps: 20 },
  );
  await expect(first).toHaveAttribute('gs-w', String(source.w + 1));
  await expect(
    page.locator(`[data-library-id="${neighbor.id}"]`),
  ).toHaveAttribute('gs-x', String(neighbor.x + 1));
  await page.mouse.up();
  await page.reload();
  await expect(first).toHaveAttribute('gs-w', String(source.w + 1));
  await expect(
    page.locator(`[data-library-id="${neighbor.id}"]`),
  ).toHaveAttribute('gs-x', String(neighbor.x + 1));
  const result = await grid.evaluate((el) => {
    const Engine = el.gridstack.engine.constructor;
    const e = new Engine({ column: 6, maxRow: 4 });
    e.nodes = [
      { id: 'a', x: 0, y: 0, w: 2, h: 1 },
      { id: 'b', x: 2, y: 0, w: 2, h: 1 },
      { id: 'c', x: 4, y: 0, w: 2, h: 1 },
    ];
    const ok = e.moveNodeCheck(e.nodes[0], { w: 3, h: 1, resizing: true });
    const valid = e.nodes.every(
      (a) =>
        a.x >= 0 &&
        a.y >= 0 &&
        a.x + a.w <= 6 &&
        a.y + a.h <= 4 &&
        e.nodes.every(
          (b) =>
            a === b ||
            a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y,
        ),
    );
    return { ok, valid, width: e.nodes[0].w };
  });
  assert.deepEqual(result, { ok: true, valid: true, width: 3 });
  assert.deepEqual(errors, []);
  console.log(
    'PASS live width resize pushes right neighbors, edge relocation, persisted layout',
  );
} finally {
  await context.close();
}
