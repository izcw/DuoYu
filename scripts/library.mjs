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
  await page.addInitScript(() => {
    window.pageSlides = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('.bottom-widgets, .desktop-library > .library-board'))
        window.pageSlides.push(frames[0].transform);
      return animate.call(this, frames, options);
    };
  });
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
    await page.waitForTimeout(400);
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
  await expect(page.locator('.workspace-board h1')).toHaveText('个人空间');
  const focusMaterial = (element) => {
    const css = getComputedStyle(element);
    return {
      blur: css.backdropFilter,
      fill: css.backgroundColor,
      shadow: css.boxShadow,
    };
  };
  const workspaceMaterial = await page
    .locator('.workspace-overlay')
    .evaluate(focusMaterial);
  await page.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await expect(page.locator('.workspace-overlay')).toHaveCount(0);
  await showWheel();
  await wheel.getByRole('menuitem', { name: '收藏库', exact: true }).click();
  const board = page.locator('.library-board');
  await expect(board).toBeVisible();
  await expect(page.locator('.workspace-board')).toHaveCount(0);
  await expect(page.locator('.newtab')).toHaveAttribute('inert', '');
  const form = board.getByRole('form', { name: '编辑收藏' });
  async function contextAction(name) {
    await board
      .locator('.library-scroll')
      .click({ button: 'right', position: { x: 8, y: 8 } });
    await page
      .getByRole('menu', { name: '收藏页菜单' })
      .getByRole('menuitem', { name, exact: true })
      .click();
  }
  async function add(name, url) {
    await contextAction('＋ 添加网址');
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
  await contextAction('新建文件夹');
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
  await contextAction('整理');
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
  await contextAction('完成整理');
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
  await board.getByRole('button', { name: '返回收藏页', exact: true }).click();
  await contextAction('整理');
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator('[data-library-page-id]')
    .first()
    .waitFor({ state: 'attached' });
  await page.mouse.move(1200, 400);
  await page.mouse.wheel(0, 180);
  const menu = page.getByRole('navigation', { name: '收藏页面' });
  const embedded = page.locator('.desktop-library .library-board');
  await expect(
    embedded.getByRole('button', { name: '打开收藏 DeepSeek', exact: true }),
  ).toBeVisible();
  await menu.getByRole('button', { name: '添加收藏页' }).click();
  await expect(
    menu.getByRole('button', { name: '重命名 收藏页 1', exact: true }),
  ).toBeVisible();
  await expect(embedded.locator('.library-tile')).toHaveCount(0);
  await menu.getByRole('button', { name: '重命名 收藏页 1' }).click();
  await menu.getByRole('textbox', { name: '收藏页名称' }).fill('研究');
  await menu.getByRole('button', { name: '保存', exact: true }).click();
  await expect(
    menu.getByRole('button', { name: '重命名 研究', exact: true }),
  ).toBeVisible();
  await menu.getByRole('button', { name: '添加收藏页' }).click();
  await expect(menu.locator('[data-library-page-id]')).toHaveCount(3);
  const menuOrder = await menu
    .locator('[data-library-page-id]')
    .evaluateAll((es) => es.map((e) => e.dataset.libraryPageId));
  await menu
    .locator(`[data-library-page-id="${menuOrder[2]}"]`)
    .dragTo(menu.locator(`[data-library-page-id="${menuOrder[0]}"]`));
  await expect
    .poll(async () =>
      (await records('libraryPages'))
        .sort((a, b) => a.order - b.order)
        .map((p) => p.id),
    )
    .toEqual([menuOrder[2], menuOrder[0], menuOrder[1]]);
  await page.reload();
  await page
    .locator('[data-library-page-id]')
    .first()
    .waitFor({ state: 'attached' });
  await page.mouse.move(1200, 400);
  await page.mouse.wheel(0, 180);
  await expect(menu.locator('[data-library-page-id]').first()).toHaveAttribute(
    'data-library-page-id',
    menuOrder[2],
  );
  await menu
    .getByRole('button', { name: '删除页面 常用收藏', exact: true })
    .click();
  await expect(menu.locator('[data-library-page-id]')).toHaveCount(2);
  await expect(
    embedded.getByRole('button', { name: '打开收藏 DeepSeek', exact: true }),
  ).toBeVisible();
  assert.equal(
    (await records('libraryItems')).filter((i) => i.kind === 'link').length,
    2,
  );
  await expect(
    embedded.locator('.library-toolbar, .library-footer'),
  ).toHaveCount(0);
  await expect(
    embedded.getByRole('button', { name: '＋ 添加网址', exact: true }),
  ).toHaveCount(0);
  await embedded
    .locator('.library-scroll')
    .click({ button: 'right', position: { x: 8, y: 8 } });
  await expect(page.getByRole('menu', { name: '收藏页菜单' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '收藏页菜单' })).toHaveCount(0);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '1',
  );
  await page.screenshot({ path: 'work/library-pages.png' });
  await menu.getByRole('button', { name: '首页', exact: true }).click();
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '0',
  );
  await expect(page.locator('.library-page-menu')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect(page.locator('.desktop-pagination')).toHaveCount(0);
  const searchStyle = () =>
    page.locator('.search-form').evaluate((el) => {
      const style = getComputedStyle(el),
        r = el.getBoundingClientRect();
      return {
        width: r.width,
        height: r.height,
        x: r.x,
        y: r.y,
        background: style.background,
        border: style.border,
        filter: style.backdropFilter,
      };
    });
  await page.waitForTimeout(700);
  await expect(page.locator('.clock-time')).toHaveCSS('font-size', '70px');
  const originalSearch = await searchStyle();
  const orderedPages = await page
    .locator('.library-page-menu [data-library-page-id]')
    .evaluateAll((es) => es.map((el) => el.dataset.libraryPageId));
  for (const id of orderedPages) {
    await page.waitForTimeout(700);
    await page.mouse.move(1300, 400);
    await page.mouse.wheel(0, 180);
    await expect(
      page.locator(`[data-library-page-id="${id}"] .library-page-choice`),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.locator(`[data-library-page-id="${id}"] .library-page-choice`),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() => window.pageSlides.at(-1)),
      'translateY(40vh)',
    );
    const { y: movedY, ...movedStyle } = await searchStyle();
    const { y: originalY, ...homeStyle } = originalSearch;
    assert.deepEqual(movedStyle, homeStyle);
    assert(movedY < originalY - 50);
    await expect(page.locator('.clock-time')).toHaveCSS('font-size', '42px');
    const panelBounds = await page.locator('.start-panel').boundingBox();
    const contentBounds = await page.locator('.desktop-library').boundingBox();
    assert(
      Math.abs(contentBounds.y - panelBounds.y - panelBounds.height - 24) < 2,
    );
    await expect(page.locator('html')).toHaveClass(/webgl-glass-ready/);
    const gpu = page.locator('.liquid-glass-canvas');
    await expect(gpu).toHaveCSS('opacity', '1');
    await expect(gpu).toHaveCSS('visibility', 'visible');
    const bounds = await gpu.boundingBox();
    const search = await page.locator('.search-box').boundingBox();
    assert(
      bounds.y <= search.y &&
        bounds.y + bounds.height >= search.y + search.height,
    );
    assert(
      bounds.height < 160,
      'Hidden widget cards must not remain in the shared canvas',
    );
  }
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, 180);
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '0',
  );
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, -180);
  await expect(
    page.locator(
      `[data-library-page-id="${orderedPages.at(-1)}"] .library-page-choice`,
    ),
  ).toHaveAttribute('aria-current', 'page');
  assert.deepEqual(
    await page.locator('.desktop-library-backdrop').evaluate(focusMaterial),
    workspaceMaterial,
  );
  await expect(page.locator('.desktop-library-backdrop')).toHaveClass(
    /visible/,
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'work/library-cycle.png' });
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await expect(page.locator('.desktop-pages')).toHaveAttribute(
    'data-desktop-page',
    '0',
  );
  await page.waitForTimeout(600);
  const beforeQuiet = await page.locator('.start-panel').boundingBox();
  await page.getByRole('button', { name: '隐藏首页组件', exact: true }).click();
  await expect(page.locator('.bottom-widgets')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await page.waitForTimeout(600);
  assert(
    (await page.locator('.start-panel').boundingBox()).y > beforeQuiet.y + 40,
  );
  await expect(page.locator('.liquid-glass-canvas')).toHaveCSS(
    'visibility',
    'visible',
  );
  await page.getByRole('button', { name: '显示首页组件', exact: true }).click();
  await expect(page.locator('.bottom-widgets')).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  await page.waitForTimeout(600);
  assert(
    Math.abs(
      (await page.locator('.start-panel').boundingBox()).y - beforeQuiet.y,
    ) < 1,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS wheel upgrade/order and both actions, isolated data, add/edit/search/folder drag/reorder, open new tab, safe folder deletion, reload, responsive and close',
  );
} finally {
  await context.close();
}
