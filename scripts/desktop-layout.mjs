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
    viewport: { width: 1440, height: 1200 },
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
  async function geometry(rows, bottom) {
    const metrics = await grid.evaluate((el) => ({
      columns: el.gridstack.getColumn(),
      rows: el.gridstack.opts.maxRow,
      mode: el.gridstack.engine.mode,
    }));
    assert.deepEqual(metrics, { columns: 18, rows, mode: 'float' });
    assert.equal(await grid.evaluate((el) => el.gridstack.cellWidth()), 74);
    assert.equal(await grid.evaluate((el) => el.gridstack.getCellHeight()), 86);

    const g = await grid.boundingBox(),
      area = await page.locator('.desktop-content').boundingBox();
    assert.ok(
      Math.abs(g.x + g.width / 2 - 720) < 2,
      'horizontal screen center',
    );
    assert.ok(
      Math.abs(
        bottom
          ? g.y + g.height - area.y - area.height
          : g.y + g.height / 2 - area.y - area.height / 2,
      ) < 2,
      'vertical alignment',
    );
    assert.ok(
      g.y >= area.y - 1 && g.y + g.height <= area.y + area.height + 1,
      'bounded grid',
    );
  }
  await geometry(6, true);
  const directional = await grid.evaluate((el) => {
    const Engine = el.gridstack.engine.constructor;
    const run = (nodes, desired, column = 18, maxRow = 10) => {
      const engine = new Engine({ column, maxRow, mode: 'float', nodes });
      const before = nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
      const ok = engine.moveNodeCheck(nodes[0], { ...desired, resizing: true });
      return {
        ok,
        before,
        after: nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
      };
    };
    const node = (id, x, y, w = 1, h = 1) => ({
      _id: id,
      id: String(id),
      x,
      y,
      w,
      h,
    });
    return {
      right: run([node(1, 0, 0, 2, 2), node(2, 2, 0), node(3, 3, 0)], { w: 3 }),
      down: run([node(1, 0, 0, 2, 2), node(2, 0, 2), node(3, 0, 3)], { h: 3 }),
      corner: run([node(1, 0, 0, 2, 2), node(2, 2, 0), node(3, 0, 2)], {
        w: 3,
        h: 3,
      }),
      edge: run(
        [node(1, 0, 0, 2, 2), node(2, 2, 0), node(3, 3, 0)],
        { w: 3 },
        4,
      ),
      locked: run([node(1, 0, 0, 2, 2), { ...node(2, 2, 0), locked: true }], {
        w: 3,
      }),
    };
  });
  assert.equal(directional.right.ok, true);
  assert.deepEqual(
    directional.right.after.map((n) => [n.x, n.y]),
    [
      [0, 0],
      [3, 0],
      [4, 0],
    ],
  );
  assert.equal(directional.down.ok, true);
  assert.deepEqual(
    directional.down.after.map((n) => [n.x, n.y]),
    [
      [0, 0],
      [0, 3],
      [0, 4],
    ],
  );
  assert.equal(directional.corner.ok, true);
  assert.deepEqual(
    directional.corner.after.map((n) => [n.x, n.y]),
    [
      [0, 0],
      [3, 0],
      [0, 3],
    ],
  );
  for (const key of ['edge', 'locked']) {
    assert.equal(directional[key].ok, false);
    assert.deepEqual(directional[key].after, directional[key].before);
  }

  async function folderAppearance(selector) {
    return page.locator(selector).evaluate((el) => {
      const icon = el.querySelector('.cell-icon');
      const image = icon.querySelector('img');
      const cs = getComputedStyle(el.querySelector('.cell-panel'));
      const material = getComputedStyle(
        el.querySelector('.cell-panel'),
        '::before',
      );
      return {
        width: getComputedStyle(icon).width,
        height: getComputedStyle(icon).height,
        imageWidth: getComputedStyle(image).width,
        imageHeight: getComputedStyle(image).height,
        labels: el.querySelectorAll('.folder-cells .cell-label').length,
        materialImage: material.backgroundImage,
        materialFilter: material.filter,
        background: cs.background,
        filter: cs.backdropFilter,
        shadow: cs.boxShadow,
      };
    });
  }
  const homeAppearance = await folderAppearance(
    '[data-library-id="home-widget-1"]',
  );
  assert.equal(homeAppearance.width, '52px');
  assert.equal(homeAppearance.height, '52px');
  assert.equal(homeAppearance.labels, 0);
  assert.match(homeAppearance.materialImage, /blob:/);
  assert.match(homeAppearance.materialFilter, /blur/);

  const search = await page.locator('.search-form').boundingBox();
  const toggle = await page.locator('.glass-mode-switch').boundingBox();
  assert.ok(toggle.y < 25 && 1440 - toggle.x - toggle.width < 30);
  await page.screenshot({ path: 'work/desktop-home-layout.png' });
  const resizeCard = page.locator('[data-library-id="home-widget-2"]');
  await resizeCard.hover();
  const handle = await resizeCard.locator('.ui-resizable-se').boundingBox();
  await expect(resizeCard.locator('.ui-resizable-se')).toHaveCSS(
    'opacity',
    '0.45',
  );
  const surface = await resizeCard.locator('.cell-tile').boundingBox();
  assert.ok(
    handle.x >= surface.x &&
      handle.y >= surface.y &&
      handle.x + handle.width <= surface.x + surface.width &&
      handle.y + handle.height <= surface.y + surface.height,
    'resize handle stays inside the card',
  );

  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 82, handle.y + 8, { steps: 15 });
  await expect(resizeCard.locator('.ui-resizable-se')).toHaveCSS(
    'opacity',
    '1',
  );
  await page.mouse.up();
  await expect(resizeCard).toHaveAttribute('gs-w', '5');
  await expect(
    page.locator('[data-library-id="home-widget-3"]'),
  ).toHaveAttribute('gs-x', '12');
  await expect(
    page.locator('[data-library-id="home-widget-3"]'),
  ).toHaveAttribute('gs-y', '4');
  await page.waitForTimeout(600);
  const card = page.locator('[data-library-id="home-widget-1"]');
  const box = await card.boundingBox();
  const cell = await grid.evaluate((el) => el.gridstack.getCellHeight());
  await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width - 12,
    box.y + box.height / 2 - cell * 2,
    { steps: 20 },
  );
  await expect(page.locator('.grid-guide-cells')).toHaveCSS('opacity', '1');
  const guide = page.locator('.grid-guide-cells > span').first();
  await expect(guide).toHaveCSS('width', '52px');
  await expect(guide).toHaveCSS('height', '52px');
  await expect(page.locator('.grid-guide-cells > span')).toHaveCount(18 * 6);
  await page.mouse.up();
  await expect(page.locator('.grid-guide-cells')).toHaveCSS('opacity', '0');
  await expect(card).toHaveAttribute('gs-y', '2');
  await page.waitForTimeout(400);
  await page.mouse.move(1200, 400);
  await page.mouse.wheel(0, 180);
  await page
    .locator('[data-library-page-id="library-demo"] .library-page-choice')
    .click();
  await expect(page.locator('[data-library-id="demo-folder"]')).toBeVisible();
  await page.waitForTimeout(800);
  await geometry(10, false);
  for (const id of ['demo-folder', 'demo-calendar', 'demo-link-10']) {
    const item = page.locator(`[data-library-id="${id}"]`);
    const label = item.locator(':scope > .tile-caption');
    await expect(label).toBeVisible();
    const metrics = await label.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const card = el.parentElement
        .querySelector('.cell-tile')
        .getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        below: box.top >= card.bottom,
        centered: Math.abs(box.x + box.width / 2 - card.x - card.width / 2) < 1,
        overflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });
    assert.deepEqual(metrics, {
      below: true,
      centered: true,
      overflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  }

  for (const id of ['demo-folder', 'demo-calendar', 'demo-link-10']) {
    const delta = await page
      .locator(`[data-library-id="${id}"]`)
      .evaluate((el) => {
        const n = el.gridstackNode;
        const grid = el.closest('.library-cell-grid');
        const guides = grid.querySelectorAll('.grid-guide-cells > span');
        const columns = grid.gridstack.getColumn();
        const first = guides[n.y * columns + n.x].getBoundingClientRect();
        const last =
          guides[
            (n.y + n.h - 1) * columns + n.x + n.w - 1
          ].getBoundingClientRect();
        const card = el.querySelector('.cell-tile').getBoundingClientRect();
        return {
          x: Math.abs(
            (first.left + last.right) / 2 - (card.left + card.right) / 2,
          ),
          y: Math.abs(
            (first.top + last.bottom) / 2 - (card.top + card.bottom) / 2,
          ),
        };
      });
    assert.ok(
      delta.x < 1 && delta.y < 1,
      `${id} guide aligns with content, excluding caption`,
    );
  }

  const libraryAppearance = await folderAppearance(
    '[data-library-id="demo-folder"]',
  );
  assert.deepEqual(
    libraryAppearance,
    homeAppearance,
    'shared folder icons and home glass material',
  );
  await page
    .getByRole('button', { name: '展开 常用网站', exact: true })
    .click();
  await expect(
    page.locator('.expanded-folder .cell-label').first(),
  ).toBeVisible();
  await expect(page.locator('.folder-page-dot')).toHaveCount(2);
  await expect(page.locator('.folder-pages')).toHaveText('');
  await page.locator('.expanded-folder').hover();
  await page.mouse.wheel(0, 120);
  await expect(
    page.getByRole('button', { name: '文件夹第 2 页', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.expanded-folder .cell-link')).toHaveCount(1);
  const folderGeometry = await page
    .locator('.folder-dialog')
    .evaluate((el) => ({
      titleBottom: el.querySelector('h2').getBoundingClientRect().bottom,
      panelTop: el
        .querySelector('.folder-dialog-content')
        .getBoundingClientRect().top,
      material: getComputedStyle(
        el.querySelector('.folder-dialog-content'),
        '::before',
      ).backgroundImage,
    }));
  assert.ok(folderGeometry.titleBottom < folderGeometry.panelTop);
  assert.match(folderGeometry.material, /blob:/);
  await page
    .locator('.base-dialog-backdrop')
    .click({ position: { x: 8, y: 8 } });

  const otherSearch = await page.locator('.search-form').boundingBox();
  assert.equal(otherSearch.width, search.width);
  assert.equal(otherSearch.height, search.height);
  await page.screenshot({ path: 'work/desktop-library-layout.png' });
  await page.locator('.library-home').click();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('gs-y', '2');
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('gs-y', '2');
  // Item context menu shares bounded resize/persistence with pointer resizing.
  await card.click({ button: 'right', position: { x: 30, y: 30 } });
  await expect(page.locator('.grid-item-menu')).toBeVisible();
  await expect(page.locator('.size-picker button')).toHaveCount(81);
  await page.getByRole('button', { name: '3列 × 2行', exact: true }).click();
  await expect(card).toHaveAttribute('gs-w', '3');
  await expect(card).toHaveAttribute('gs-h', '2');
  await expect(page.locator('.grid-item-menu')).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.reload();
  await expect(card).toHaveAttribute('gs-w', '3');
  await card.click({ button: 'right', position: { x: 30, y: 30 } });
  await page.getByRole('button', { name: '9列 × 9行', exact: true }).click();
  await expect(card).toHaveAttribute('gs-w', '3');
  await expect(page.locator('.grid-item-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.grid-item-menu')).toHaveCount(0);
  await card.hover();
  const resizeHandle = card.locator('.ui-resizable-se');
  await expect(resizeHandle).toHaveCSS('opacity', '0.45');
  await resizeHandle.hover();
  await expect(resizeHandle).toHaveCSS('opacity', '1');
  await expect(resizeHandle).toHaveCSS('background-size', '12px 12px');
  await page.mouse.move(1, 1);
  await expect(resizeHandle).toHaveCSS('opacity', '0');
  assert.equal(await grid.evaluate((el) => el.gridstack.opts.margin), 8);
  assert.deepEqual(errors, []);
  console.log(
    'PASS 18x6 home bottom alignment, 18x10 centered library, shared drag persistence, unchanged search, top-right switch',
  );
} finally {
  await context.close();
}
