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
  const rect = await first.boundingBox();
  const cell = await grid.evaluate((el) => ({
    w: el.getBoundingClientRect().width / 16,
    h: el.getBoundingClientRect().height / 5,
  }));
  const x = rect.x + 24,
    y = rect.y + rect.height - 32;
  const target = page.locator(`[data-library-id="${neighbor.id}"]`);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 4 * cell.w, y, { steps: 25 });
  await expect
    .poll(() =>
      target.evaluate((el) => [el.gridstackNode.x, el.gridstackNode.y]),
    )
    .not.toEqual([neighbor.x, neighbor.y]);
  await page.mouse.move(x + 4 * cell.w, y - 3 * cell.h, { steps: 25 });
  await expect(target).toHaveAttribute('gs-x', String(neighbor.x));
  await expect(target).toHaveAttribute('gs-y', String(neighbor.y));
  await page.mouse.up();
  await expect(page.locator('.grid-selected')).toHaveCount(0);
  await expect(first).toHaveAttribute('gs-y', String(source.y - 3));
  await page.reload();
  await expect(target).toHaveAttribute('gs-x', String(neighbor.x));
  await expect(target).toHaveAttribute('gs-y', String(neighbor.y));
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
    'PASS temporary drag displacement restored before drop and after reload',
  );
} finally {
  await context.close();
}
