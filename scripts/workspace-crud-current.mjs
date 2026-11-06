import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('work', { recursive: true });
const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/workspace-current-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  },
);
try {
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const open = async () => {
    await page
      .getByRole('navigation', { name: '快捷 Dock', exact: true })
      .getByRole('button', { name: '标签工作区', exact: true })
      .click();
    await expect(page.locator('.workspace-board')).toBeVisible();
  };
  await page.goto('chrome://newtab');
  await open();
  const board = page.locator('.workspace-board');
  await board.getByRole('searchbox', { name: '搜索工作区' }).fill('搜索检查');
  await board.getByRole('button', { name: '清空工作区搜索' }).click();
  await expect(
    board.getByRole('searchbox', { name: '搜索工作区' }),
  ).toHaveValue('');
  const groups = board.locator('.workspace-collection');
  const initial = await groups.count();
  await board.getByRole('button', { name: '新建集合', exact: true }).click();
  await expect(groups).toHaveCount(initial + 1);
  const group = groups.last();
  await group.getByRole('button', { name: '更多集合操作' }).click();
  await group.getByRole('button', { name: '重命名', exact: true }).click();
  const input = group.getByRole('textbox', { name: '重命名集合' });
  await input.fill('回归集合');
  await input.press('Enter');
  await expect(group.locator('.workspace-collection-name')).toHaveText(
    '回归集合',
  );
  await page.reload();
  await open();
  const saved = groups.filter({
    has: page.locator('.workspace-collection-name', { hasText: '回归集合' }),
  });
  await expect(saved).toHaveCount(1);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const menu = await board.locator('.desktop-menu').boundingBox();
    const collection = await saved.boundingBox();
    if (!menu || !collection || collection.x < menu.x + menu.width) {
      throw new Error('Mobile space menu overlaps the collection');
    }
  }
  await board.getByRole('searchbox', { name: '搜索工作区' }).fill('回归集合');
  await board.getByRole('button', { name: '清空工作区搜索' }).click();
  await expect(
    board.getByRole('searchbox', { name: '搜索工作区' }),
  ).toHaveValue('');
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect(page.locator('.newtab')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.workspace-overlay')).toHaveCSS('opacity', '1');
  // On the brightest possible wallpaper, the focus layer must retain enough
  // contrast for the workspace's white primary text (WCAG relative luminance).
  const contrast = await page.locator('.workspace-overlay').evaluate((el) => {
    const parts = getComputedStyle(el)
      .backgroundColor.match(/[\d.]+/g)
      .map(Number);
    const alpha = parts[3] ?? 1;
    const linear = parts
      .slice(0, 3)
      .map((v) => (v * alpha + 255 * (1 - alpha)) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return (
      1.05 /
      (linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 + 0.05)
    );
  });
  if (contrast < 4.5)
    throw new Error('Workspace primary text loses contrast on white wallpaper');
  await page.screenshot({ path: 'work/workspace-current-mobile.png' });
  await saved.getByRole('button', { name: '更多集合操作' }).click();
  await saved.getByRole('button', { name: '删除集合', exact: true }).click();
  await saved.getByRole('button', { name: '取消', exact: true }).click();
  await expect(saved).toHaveCount(1);
  await saved.getByRole('button', { name: '更多集合操作' }).click();
  await saved.getByRole('button', { name: '删除集合', exact: true }).click();
  await saved.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(groups).toHaveCount(initial);
  await board.getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(saved).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(board).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('duoyu');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('tabCollections', 'readwrite');
          tx.objectStore('tabCollections').put({
            id: 'history',
            spaceId: 'default',
            name: '历史集合',
            order: 2,
            updatedAt: 1,
            tabs: [
              {
                id: 'invalid-url',
                url: 'https://[',
                title: '旧网址',
                icon: '',
                savedAt: 1,
              },
            ],
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
  await page.reload();
  await open();
  await expect(
    board.locator('[data-saved-id="invalid-url"] .workspace-favicon'),
  ).toHaveText('旧');
  await expect.poll(() => errors).toEqual([]);
  console.log(
    'PASS current Dock entry, collection create/rename/persistence, 320/390px layout, white-wallpaper primary text contrast, search clear, delete cancel/confirm/undo and Escape',
  );
} finally {
  await context.close();
}
