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
  const grid = page.locator('.library-cell-grid');
  const pushing = await grid.evaluate((el) => {
    const Engine = el.gridstack.engine.constructor;
    const active = {
      _id: 1001,
      id: 'active',
      x: 0,
      y: 3,
      w: 3,
      h: 1,
      maxW: 5,
      maxH: 4,
    };
    const blocker = { _id: 1002, id: 'blocker', x: 0, y: 4, w: 3, h: 2 };
    const engine = new Engine({
      column: 12,
      maxRow: 6,
      mode: 'float',
      nodes: [active, blocker],
    });
    const moved = engine.moveNodeCheck(active, { w: 3, h: 3, resizing: true });
    const separate =
      active.x + active.w <= blocker.x ||
      blocker.x + blocker.w <= active.x ||
      active.y + active.h <= blocker.y ||
      blocker.y + blocker.h <= active.y;
    return {
      moved,
      separate,
      height: active.h,
      bounded: engine.nodes.every((n) => n.x + n.w <= 12 && n.y + n.h <= 6),
    };
  });
  assert.deepEqual(pushing, {
    moved: true,
    separate: true,
    height: 3,
    bounded: true,
  });
  const folder = page.locator('[data-library-id="demo-folder"]');
  assert.deepEqual(
    await folder.evaluate((el) => [
      el.gridstackNode.maxW,
      el.gridstackNode.maxH,
    ]),
    [16, 8],
  );
  async function enlarge(item) {
    await item.hover();
    // Resizing another item can recreate or move this handle. Let Playwright
    // wait for the final node to be visible, stable and able to receive input.
    await item.locator('.ui-resizable-se').hover({ position: { x: 8, y: 8 } });
    await page.mouse.down();
    await page.mouse.move(1420, 980, { steps: 25 });
    if (await item.locator('.folder-cells').count()) {
      const live = await item.evaluate((el) => ({
        w: el.gridstackNode.w,
        h: el.gridstackNode.h,
      }));
      await expect(item.locator('.folder-cells')).toHaveAttribute(
        'data-columns',
        String(live.w),
      );
      await expect(item.locator('.folder-cells')).toHaveAttribute(
        'data-rows',
        String(live.h),
      );
      await expect(
        item.locator('.preview-icons [data-folder-item]'),
      ).toHaveCount(Math.min(10, live.w * live.h));
      const atMax = await item.boundingBox();
      await page.mouse.move(1435, 995);
      const beyondMax = await item.boundingBox();
      assert(Math.abs(atMax.width - beyondMax.width) < 1);
      assert(Math.abs(atMax.height - beyondMax.height) < 1);
    }
    await page.mouse.up();
  }
  await enlarge(folder);
  const expanded = await folder.evaluate((el) => [
    el.gridstackNode.w,
    el.gridstackNode.h,
  ]);
  assert.ok(
    expanded[0] > 3 && expanded[0] <= 16 && expanded[1] > 1 && expanded[1] <= 8,
  );
  await folder.click({ button: 'right', position: { x: 20, y: 20 } });
  await page.getByRole('button', { name: '1列 × 3行', exact: true }).click();
  await expect(folder).toHaveAttribute('data-width', '1');
  await expect(folder).toHaveAttribute('data-height', '3');
  const icon = page.locator('[data-library-id="demo-link-10"]');
  assert.deepEqual(
    await icon.evaluate((el) => [el.gridstackNode.maxW, el.gridstackNode.maxH]),
    [4, 4],
  );
  await enlarge(icon);
  await expect
    .poll(async () => Number(await icon.getAttribute('data-width')))
    .toBe(4);
  assert(Number(await icon.getAttribute('data-width')) <= 4);
  assert(Number(await icon.getAttribute('data-height')) <= 4);
  assert(
    Number(await icon.getAttribute('data-width')) > 1 ||
      Number(await icon.getAttribute('data-height')) > 1,
  );
  const bounded = await grid.evaluate((el) => {
    const nodes = el.gridstack.engine.nodes;
    return nodes.every(
      (n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= 16 && n.y + n.h <= 8,
    );
  });
  assert(bounded);
  assert.equal(
    await page
      .locator('.library-scroll')
      .evaluate((el) => getComputedStyle(el).overflow),
    'hidden',
  );
  await folder.hover();
  const handle = await folder.locator('.ui-resizable-se').boundingBox();
  const cell = (await grid.boundingBox()).width / 16;
  // The folder is already 1x3; dragging farther toward the minimum must keep
  // the three-cell minimum area and its live preview consistent.
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 8 - cell * 4, handle.y + 8 - cell * 4, {
    steps: 20,
  });
  await expect(folder.locator('.folder-cells')).toHaveAttribute(
    'data-columns',
    '1',
  );
  await expect(folder.locator('.folder-cells')).toHaveAttribute(
    'data-rows',
    '3',
  );
  await expect(folder.locator('.preview-icons [data-folder-item]')).toHaveCount(
    3,
  );
  await page.screenshot({ path: 'work/library-resizing.png' });
  await page.mouse.up();
  await expect(folder).toHaveAttribute('data-width', '1');
  await expect(folder).toHaveAttribute('data-height', '3');
  await folder.hover();
  const minHandle = await folder.locator('.ui-resizable-se').boundingBox();
  await page.mouse.move(minHandle.x + 8, minHandle.y + 8);
  await page.mouse.down();
  await page.mouse.move(40, 40, { steps: 15 });
  const atMin = await folder.boundingBox();
  const rowHeight = await grid.evaluate(
    (el) => el.getBoundingClientRect().height / el.gridstack.opts.maxRow,
  );
  assert(atMin.width >= cell - 1 && atMin.height >= rowHeight * 3 - 1);
  await page.mouse.move(5, 5);
  const beyondMin = await folder.boundingBox();
  assert(Math.abs(atMin.width - beyondMin.width) < 1);
  assert(Math.abs(atMin.height - beyondMin.height) < 1);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'work/library-limits.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS bounded 16x8 grid, folder resize/live preview/minimum area, icons up to 4x4, no scrollbars',
  );
} finally {
  await context.close();
}
