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

  const card = page.locator('[data-library-id="home-widget-1"]');
  async function resize(w, h) {
    await card.click({ button: 'right', position: { x: 20, y: 20 } });
    await page
      .getByRole('button', { name: w + '列 × ' + h + '行', exact: true })
      .click();
    await expect(card).toHaveAttribute('data-width', String(w));
    await expect(card).toHaveAttribute('data-height', String(h));
    await page.waitForTimeout(300);
  }
  await resize(3, 1);
  const check = async () =>
    card.locator('.folder-cells .folder-icon').evaluateAll((icons) =>
      icons.map((icon) => {
        const r = icon.getBoundingClientRect(),
          p = icon.closest('.folder-link').getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          fits:
            r.left >= p.left - 0.5 &&
            r.right <= p.right + 0.5 &&
            r.top >= p.top - 0.5 &&
            r.bottom <= p.bottom + 0.5,
        };
      }),
    );
  const horizontal = await check();
  assert.ok(
    horizontal.length === 3 &&
      horizontal.every(
        (i) =>
          Math.abs(i.width - 48) < 0.1 &&
          Math.abs(i.height - 48) < 0.1 &&
          i.fits,
      ),
    JSON.stringify(horizontal),
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'work/folder-single-row-60.png' });
  await card.evaluate((el) =>
    el.closest('.library-cell-grid').gridstack.update(el, { y: 1 }),
  );
  await resize(1, 3);
  assert.ok((await check()).every((i) => i.fits && i.width === i.height));
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, 180);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  await page.locator('[data-library-page-id="library-demo"]').click();
  const icon = page.locator('[data-library-id="demo-link-10"] .cell-icon');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveCSS('width', '56px');
  await expect(icon).toHaveCSS('height', '56px');
  assert.equal(await grid.evaluate((el) => el.gridstack.getCellHeight()), 112);
  assert.equal(await grid.evaluate((el) => el.gridstack.cellWidth()), 92);
  await icon.click({ button: 'right' });
  const picker = page.locator('.size-picker');
  await expect(picker.locator('button')).toHaveCount(16);
  await expect(picker.locator('.current')).toHaveCount(1);
  await picker.getByRole('button', { name: '3列 × 2行', exact: true }).hover();
  await expect(picker.locator('.preview')).toHaveCount(6);
  await expect(picker.locator('.current')).toHaveCount(1);
  await page.locator('.grid-item-menu header').hover();
  await expect(picker.locator('.preview')).toHaveCount(0);
  await expect(picker.locator('.current')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);
  const bounds = await grid.evaluate((el) => {
    const r = el.getBoundingClientRect(),
      p = el.parentElement.getBoundingClientRect();
    return {
      fits:
        r.top >= p.top - 1 &&
        r.bottom <= p.bottom + 1 &&
        r.left >= p.left - 1 &&
        r.right <= p.right + 1,
      zoom: getComputedStyle(el).zoom,
    };
  });
  assert.ok(bounds.fits, JSON.stringify(bounds));
  const tile = page.locator('[data-library-id="demo-link-10"]');
  const before = await tile.evaluate((el) => ({
    x: el.gridstackNode.x,
    y: el.gridstackNode.y,
  }));
  const iconRect = await icon.boundingBox();
  const cell = await grid.evaluate(
    (el) => el.getBoundingClientRect().width / 18,
  );
  await page.mouse.move(
    iconRect.x + iconRect.width / 2,
    iconRect.y + iconRect.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    iconRect.x + iconRect.width / 2 - cell,
    iconRect.y + iconRect.height / 2,
    { steps: 15 },
  );
  await page.mouse.up();
  await expect(tile).toHaveAttribute('gs-x', String(before.x - 1));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'work/grid-fit-56.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS 56px icons, 48px folder icons, 92x112 grid, unclipped 3x1 and 1x3 folders',
  );
} finally {
  await context.close();
}
