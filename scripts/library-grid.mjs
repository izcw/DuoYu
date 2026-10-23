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
  const folder = page.locator('[data-library-id="demo-folder"]');
  await expect(folder).toBeVisible();
  await expect(folder.locator('.cell-link')).toHaveCount(3);
  const count = context.pages().length;
  await folder
    .getByRole('button', { name: '打开收藏 ChatGPT', exact: true })
    .click();
  await expect.poll(() => context.pages().length).toBe(count + 1);
  await page.bringToFront();
  await folder.locator('.folder-border').click({ position: { x: 150, y: 3 } });
  const dialog = page.getByRole('dialog', { name: '常用网站' });
  await expect(dialog.locator('.expanded-folder .cell-link')).toHaveCount(9);
  await dialog.getByRole('button', { name: '文件夹第 2 页' }).click();
  await expect(dialog.locator('.expanded-folder .cell-link')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await folder.hover();
  const handle = await folder.locator('.ui-resizable-se').boundingBox();
  await page.mouse.move(handle.x + 10, handle.y + 10);
  await page.mouse.down();
  const cell =
    (await page.locator('.library-cell-grid').boundingBox()).width / 12;
  await page.mouse.move(handle.x + 10 - cell * 2, handle.y + 10 + cell * 2, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(folder).toHaveAttribute('data-width', '1');
  await expect(folder).toHaveAttribute('data-height', '3');
  await expect(folder.locator('.cell-link')).toHaveCount(3);
  await page
    .locator('[data-library-id="demo-note"] textarea')
    .fill('保存便签测试');
  await page.locator('.clock-action').focus();
  const from = page.locator('[data-library-id="demo-link-11"]'),
    to = page.locator('[data-library-id="demo-link-10"]');
  await from.dragTo(to, { targetPosition: { x: 5, y: 40 } });
  await expect(
    page.locator('.grid-stack-item[data-library-id^="demo-link"]'),
  ).toHaveCount(2);
  await from.dragTo(to, { targetPosition: { x: 48, y: 85 } });
  await expect(
    page.locator('.grid-stack-item[data-library-id^="demo-link"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '打开文件夹 新文件夹', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .locator('[data-library-page-id="library-demo"]')
    .waitFor({ state: 'attached' });
  await page.mouse.move(1200, 400);
  await page.mouse.wheel(0, 180);
  await page
    .locator('[data-library-page-id="library-demo"] .library-page-choice')
    .click();
  await expect(folder).toHaveAttribute('data-width', '1');
  await expect(folder).toHaveAttribute('data-height', '3');
  await expect(
    page.locator('[data-library-id="demo-note"] textarea'),
  ).toHaveValue('保存便签测试');
  await expect(folder.locator('img').first()).toHaveAttribute(
    'src',
    '/images/widgets/chatgpt.svg',
  );
  await folder.getByRole('button', { name: '展开 常用网站' }).click();
  await dialog
    .getByRole('button', { name: '打开收藏 DeepSeek', exact: true })
    .dragTo(
      dialog.getByRole('button', { name: '打开收藏 ChatGPT', exact: true }),
    );
  await expect(dialog.locator('.cell-link').first()).toHaveAttribute(
    'aria-label',
    '打开收藏 DeepSeek',
  );
  await dialog.getByRole('button', { name: '文件夹第 2 页' }).click();
  await expect(dialog.locator('.expanded-folder .cell-link')).toHaveCount(1);
  await dialog.getByRole('button', { name: '关闭文件夹' }).click();
  await expect(folder.locator('.cell-link')).toHaveCount(3);
  const calendar = page.locator('[data-library-id="demo-calendar"]');
  await calendar
    .getByRole('button', { name: '调整大小 日历' })
    .press('ArrowUp');
  await expect(calendar).toHaveAttribute('data-height', '1');
  await expect(calendar.locator('.cell-widget strong')).toHaveText(
    String(new Date().getDate()),
  );
  await calendar
    .getByRole('button', { name: '调整大小 日历' })
    .press('ArrowDown');
  await expect(page.locator('.library-cell-grid')).toHaveClass(
    /grid-stack-animate/,
  );
  const cardHeader = calendar.locator('header');
  const cardBox = await cardHeader.boundingBox();
  const oldX = await calendar.getAttribute('gs-x');
  await page.mouse.move(cardBox.x + 20, cardBox.y + 8);
  await page.mouse.down();

  await page.mouse.move(cardBox.x + 468, cardBox.y + 8, { steps: 15 });
  await expect(calendar).toHaveClass(/ui-draggable-dragging/);
  assert.equal(
    await calendar.evaluate((el) => getComputedStyle(el).opacity),
    '1',
  );
  assert.equal(
    await page
      .locator('.library-cell-grid .placeholder-content')
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
    '0px',
  );
  await expect(
    page.locator('.library-cell-grid .grid-stack-placeholder'),
  ).toBeVisible();
  await page.mouse.up();
  await expect(calendar).not.toHaveAttribute('gs-x', oldX || '0');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'work/library-grid.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS grid sizes, direct folder links, folder pagination, resize persistence, notes, sort vs merge, reload',
  );
} finally {
  await context.close();
}
