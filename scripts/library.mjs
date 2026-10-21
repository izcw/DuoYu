import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/library-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
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
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="a"><stop stop-color="#334b60"/><stop offset="1" stop-color="#4a384e"/></linearGradient></defs><path fill="url(#a)" d="M0 0h1600v900H0z"/></svg>',
    }),
  );
  const icon = await readFile('public/images/shortcuts/deepseek.png');
  await context.route('https://example.com/**', (r) =>
    r.fulfill({ contentType: 'image/png', body: icon }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page.locator('.clock-time').waitFor();
  async function records(table) {
    return page.evaluate(
      (table) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('duoyu');
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction(table).objectStore(table).getAll();
            read.onsuccess = () => {
              resolve(read.result);
              db.close();
            };
            read.onerror = () => reject(read.error);
          };
        }),
      table,
    );
  }
  // Existing wheel order and tab collections survive the schema upgrade/additional actions.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open('duoyu');
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(
            ['shortcuts', 'tabCollections'],
            'readwrite',
          );
          tx.objectStore('shortcuts').put({
            id: 'wallpaper',
            items: [
              {
                id: 'custom',
                name: 'My custom',
                url: 'https://example.com',
                icon: '/images/github.png',
              },
              { id: 'bilibili', name: '旧哔哩哔哩', icon: '/images/add.png' },
              { id: 'deepseek', name: '旧DeepSeek', icon: '/images/add.png' },
              { id: 'translate', name: '旧翻译', icon: '/images/add.png' },
              { id: 'add', name: '添加网址', icon: '/images/add.png' },
            ],
          });
          tx.objectStore('tabCollections').put({
            id: 'existing',
            name: 'Existing session',
            order: 0,
            updatedAt: 1,
            tabs: [],
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await page.locator('.clock-time').waitFor();
  const wheel = page.locator('.wallpaper-wheel');
  const showWheel = async () => {
    await page.mouse.click(800, 450, { button: 'right' });
    await expect(wheel).toHaveAttribute('aria-hidden', 'false');
  };
  await showWheel();
  assert.deepEqual(
    await wheel
      .locator('[data-item]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.item)),
    [
      'custom',
      'duoyu-canvas',
      'duoyu-memo',
      'duoyu-translate',
      'duoyu-workspace',
      'duoyu-library',
      'add',
    ],
  );
  const initialTabCount = (await page.evaluate(() => chrome.tabs.query({})))
    .length;
  for (const name of ['画布', '便签']) {
    await wheel.getByRole('menuitem', { name, exact: true }).click();
    await expect(wheel).toHaveCount(0);
    assert.equal(
      (await page.evaluate(() => chrome.tabs.query({}))).length,
      initialTabCount,
    );
    await expect(page.locator('.workspace-overlay')).toHaveCount(0);
    await showWheel();
  }
  await wheel.getByRole('menuitem', { name: '翻译', exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate(() => chrome.tabs.query({}))).some((t) =>
        (t.pendingUrl || t.url || '').startsWith('https://fanyi.baidu.com/'),
      ),
    )
    .toBe(true);
  await page.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((t) =>
      (t.pendingUrl || t.url || '').startsWith('https://fanyi.baidu.com/'),
    );
    if (tab?.id) await chrome.tabs.remove(tab.id);
  });
  await page.bringToFront();
  await expect(wheel).toHaveCount(0);
  await showWheel();
  await wheel
    .getByRole('menuitem', { name: '标签工作区', exact: true })
    .click();
  await expect(page.locator('.workspace-board')).toBeVisible();
  await expect(page.locator('.workspace-board h1')).toHaveText('标签工作区');
  await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await expect(page.locator('.workspace-overlay')).toHaveCount(0);
  await showWheel();
  await wheel.getByRole('menuitem', { name: '收藏库', exact: true }).click();
  const board = page.locator('.library-board');
  await expect(board).toBeVisible();
  await expect(page.locator('.workspace-board')).toHaveCount(0);
  await expect(page.locator('.newtab')).toHaveAttribute('inert', '');
  const form = board.getByRole('form', { name: '编辑收藏' });
  async function add(name, url) {
    await board
      .getByRole('button', { name: '＋ 添加网址', exact: true })
      .click();
    await board
      .getByRole('textbox', { name: '收藏名称', exact: true })
      .fill(name);
    await board
      .getByRole('textbox', { name: '收藏网址', exact: true })
      .fill(url);
    await board.getByRole('button', { name: '保存', exact: true }).click();
    await expect(form).toHaveCount(0);
  }
  await add('DeepSeek', 'https://example.com/deepseek');
  await add('Research', 'https://example.com/research');
  await board.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await board
    .getByRole('textbox', { name: '收藏名称', exact: true })
    .fill('AI 工具');
  await board.getByRole('button', { name: '保存', exact: true }).click();
  const tile = (name) =>
    board.locator('.library-tile').filter({
      has: page.getByRole('button', {
        name: '打开收藏 ' + name,
        exact: true,
      }),
    });
  const folder = board.locator('.library-tile').filter({
    has: page.getByRole('button', {
      name: '打开文件夹 AI 工具',
      exact: true,
    }),
  });
  await tile('DeepSeek').dragTo(folder);
  await expect(tile('DeepSeek')).toHaveCount(0);
  await board
    .getByRole('button', { name: '打开文件夹 AI 工具', exact: true })
    .click();
  await expect(tile('DeepSeek')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(folder).toBeVisible();
  await expect(board).toBeVisible();
  await board
    .getByRole('searchbox', { name: '搜索收藏', exact: true })
    .fill('deepseek');
  await expect(tile('DeepSeek')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(folder).toBeVisible();
  await board.getByRole('button', { name: '整理', exact: true }).click();
  await board
    .getByRole('button', { name: '编辑 Research', exact: true })
    .click();
  await board
    .getByRole('textbox', { name: '收藏名称', exact: true })
    .fill('Research renamed');
  await board
    .getByRole('combobox', { name: '收藏文件夹' })
    .selectOption({ label: 'AI 工具' });
  await board.getByRole('button', { name: '保存', exact: true }).click();
  await board.getByRole('button', { name: '完成', exact: true }).click();
  await board
    .getByRole('button', { name: '打开文件夹 AI 工具', exact: true })
    .click();
  await expect(tile('Research renamed')).toBeVisible();
  await tile('Research renamed').dragTo(tile('DeepSeek'));
  assert.deepEqual(
    (await records('libraryItems'))
      .filter((i) => i.kind === 'link')
      .sort((a, b) => a.order - b.order)
      .map((i) => i.name),
    ['Research renamed', 'DeepSeek'],
  );
  await page.waitForTimeout(400);
  await expect(folder).toHaveCount(0);
  await expect
    .poll(async () =>
      board
        .locator('.library-icon img')
        .evaluateAll(
          (images) =>
            images.length === 2 &&
            images.every((image) => image.complete && image.naturalWidth > 0),
        ),
    )
    .toBe(true);
  await page.screenshot({ path: 'work/library-desktop.png' });
  const before = await page.evaluate(() => chrome.tabs.query({}));
  await board
    .getByRole('button', { name: '打开收藏 DeepSeek', exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => chrome.tabs.query({}))).length)
    .toBe(before.length + 1);
  await page.bringToFront();
  await board.getByRole('button', { name: '全部收藏', exact: true }).click();
  await board.getByRole('button', { name: '整理', exact: true }).click();
  await board
    .getByRole('button', { name: '删除 AI 工具', exact: true })
    .click();
  await board.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(folder).toHaveCount(0);
  await expect(tile('DeepSeek')).toBeVisible();
  await expect(tile('Research renamed')).toBeVisible();
  await page.reload();
  await page.locator('.clock-time').waitFor();
  await showWheel();
  await wheel.getByRole('menuitem', { name: '收藏库', exact: true }).click();
  await expect(tile('DeepSeek')).toBeVisible();
  assert.equal((await records('tabCollections'))[0].name, 'Existing session');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'work/library-mobile.png' });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await board.getByRole('button', { name: '关闭收藏库', exact: true }).click();
  await expect(page.locator('.workspace-overlay')).toHaveCount(0);
  assert.equal(await page.locator('.newtab').getAttribute('inert'), null);
  assert.deepEqual(errors, []);
  console.log(
    'PASS wheel upgrade/order and both actions, isolated data, add/edit/search/folder drag/reorder, open new tab, safe folder deletion, reload, responsive and close',
  );
} finally {
  await context.close();
}
