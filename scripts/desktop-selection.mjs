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

  const grid = page.locator('.library-cell-grid');
  await expect(page.locator('[data-library-id="home-widget-1"]')).toBeVisible();
  await page.waitForTimeout(800);

  const first = page.locator('[data-library-id="home-widget-1"]');
  const second = page.locator('[data-library-id="home-widget-2"]');
  const third = page.locator('[data-library-id="home-widget-3"]');
  // A neighbor sits above the selected pair, in their destination.
  await third.evaluate((el) =>
    el.closest('.grid-stack').gridstack.update(el, { x: 7, y: 2 }),
  );
  await page.waitForTimeout(400);
  const a = await first.boundingBox(),
    b = await second.boundingBox();
  await page.mouse.move(a.x - 3, a.y - 3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2, { steps: 15 });
  await expect(page.locator('.grid-selection-box')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.grid-selected')).toHaveCount(2);
  await expect(page.locator('.grid-selection-box')).toHaveCount(0);
  assert.equal(await page.locator('.folder-dialog').count(), 0);
  await page.mouse.move(a.x + 20, a.y + a.height - 45);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + a.height - 45 - 224, { steps: 15 });
  await expect(page.locator('.grid-selection-dragging')).toHaveCount(2);
  await expect(third).toHaveClass(/grid-selection-pushed/);
  await expect(third).toHaveAttribute('gs-y', '2');
  await expect
    .poll(() => third.evaluate((el) => el.style.transform))
    .toBe('translate(0px, -224px)');
  await page.mouse.up();
  await expect(first).toHaveAttribute('gs-y', '2');
  await expect(second).toHaveAttribute('gs-y', '2');
  await expect(third).toHaveAttribute('gs-y', '0');
  await expect(first).toHaveAttribute('gs-x', '3');
  await expect(second).toHaveAttribute('gs-x', '7');
  await expect(page.locator('.folder-dialog')).toHaveCount(0);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(first).toHaveAttribute('gs-y', '2');
  await expect(second).toHaveAttribute('gs-y', '2');
  await first
    .locator('.folder-border')
    .click({ modifiers: ['Control'], position: { x: 10, y: 60 } });
  await second
    .locator('.folder-border')
    .click({ modifiers: ['Control'], position: { x: 10, y: 60 } });
  await expect(page.locator('.grid-selected')).toHaveCount(2);
  await third
    .locator('.folder-border')
    .click({ modifiers: ['Shift'], position: { x: 10, y: 60 } });
  await expect(page.locator('.grid-selected')).toHaveCount(3);
  await third
    .locator('.folder-border')
    .click({ modifiers: ['Control'], position: { x: 10, y: 60 } });
  await expect(page.locator('.grid-selected')).toHaveCount(2);
  const moved = await first.boundingBox();
  await page.mouse.move(moved.x + 20, moved.y + 100);
  await page.mouse.down();
  await page.mouse.move(moved.x + 104, moved.y - 24, { steps: 10 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(first).toHaveAttribute('gs-y', '2');
  await expect(page.locator('.grid-selected')).toHaveCount(0);
  // Atomic engine moves push neighbors without leaving partial moves on failure.
  const result = await grid.evaluate((el) => {
    const Engine = el.gridstack.engine.constructor;
    const e = new Engine({ column: 8, maxRow: 6 });
    e.nodes = [
      { id: 'a', x: 0, y: 0, w: 1, h: 1 },
      { id: 'b', x: 0, y: 2, w: 2, h: 1 },
      { id: 'c', x: 2, y: 0, w: 1, h: 1 },
    ];
    const chain = new Engine({ column: 8, maxRow: 6 });
    chain.nodes = [
      { id: 'a', x: 0, y: 0, w: 1, h: 1 },
      { id: 'b', x: 1, y: 0, w: 1, h: 1 },
      { id: 'c', x: 2, y: 0, w: 1, h: 1 },
    ];
    if (
      !chain.moveSelection(new Set(['a', 'b']), 2, 0) ||
      chain.nodes[2].x !== 4
    )
      throw Error('Group collision did not push past selected neighbor');
    const edge = new Engine({ column: 4, maxRow: 2, mode: 'float' });
    edge.nodes = [
      { id: 'moving', x: 0, y: 0, w: 2, h: 1 },
      { id: 'edge', x: 2, y: 0, w: 2, h: 1 },
    ];
    if (
      !edge.moveNodeCheck(edge.nodes[0], { x: 2, y: 0 }) ||
      edge.nodes[0].x !== 2 ||
      edge.nodes[0].y !== 0
    )
      throw Error('Single drop lost priority at edge');
    if (edge.nodes[1].x !== 2 || edge.nodes[1].y !== 1)
      throw Error('Neighbor did not relocate to available row');
    const full = new Engine({ column: 4, maxRow: 1, mode: 'float' });
    full.nodes = [
      { id: 'a', x: 0, y: 0, w: 1, h: 1 },
      { id: 'b', x: 1, y: 0, w: 1, h: 1 },
      { id: 'c', x: 2, y: 0, w: 1, h: 1 },
      { id: 'd', x: 3, y: 0, w: 1, h: 1 },
    ];
    if (!full.moveSelection(new Set(['a', 'b']), 2, 0))
      throw Error('Full row must reuse vacated slots');
    if (
      full.nodes[0].x !== 2 ||
      full.nodes[1].x !== 3 ||
      new Set(full.nodes.map((n) => n.x)).size !== 4
    )
      throw Error('Priority group placement overlaps');
    const ok = e.moveSelection(new Set(['a', 'b']), 2, 0);
    const positions = e.nodes.map((n) => [n.x, n.y]);
    const before = JSON.stringify(e.nodes);
    const rejected = !e.moveSelection(new Set(['a', 'b']), 8, 0);
    return {
      ok,
      positions,
      rejected,
      unchanged: before === JSON.stringify(e.nodes),
    };
  });
  assert.deepEqual(result, {
    ok: true,
    positions: [
      [2, 0],
      [2, 2],
      [3, 0],
    ],
    rejected: true,
    unchanged: true,
  });
  await page.screenshot({ path: 'work/desktop-selection.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS marquee selection, group move and persistence, modifier selection, Escape cancellation, bounded atomic collision handling',
  );
} finally {
  await context.close();
}
