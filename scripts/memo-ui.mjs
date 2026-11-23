import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

await mkdir('work', { recursive: true });
const evidence = await mkdtemp(path.resolve('work/memo-ui-'));
const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const channel = process.env.TEST_BROWSER_CHANNEL || 'msedge';
const context = await chromium.launchPersistentContext(
  path.join(evidence, 'profile'),
  {
    channel,
    headless: true,
    colorScheme: 'light',
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args:
      channel === 'chrome'
        ? ['--enable-unsafe-extension-debugging']
        : [
            `--load-extension=${extension}`,
            `--disable-extensions-except=${extension}`,
          ],
  },
);
try {
  let id;
  if (channel === 'chrome') {
    const cdp = await context.browser().newBrowserCDPSession();
    id = (await cdp.send('Extensions.loadUnpacked', { path: extension })).id;
    await cdp.detach();
  }
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  id ||= new URL(worker.url()).host;
  await context.route(/^https?:/, (route) => route.abort());
  let wallpaperOnline = false;
  await context.route('https://api.bimg.cc/today?*', (route) => {
    if (!wallpaperOnline) return route.abort();
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900">
        <defs><linearGradient id="sky" x2="1" y2="1">
          <stop stop-color="#83acc5"/><stop offset=".55" stop-color="#698997"/><stop offset="1" stop-color="#536b78"/>
        </linearGradient></defs>
        <rect width="1440" height="900" fill="url(#sky)"/>
      </svg>`,
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const open = () =>
    page
      .getByRole('navigation', { name: '快捷 Dock' })
      .getByRole('button', { name: '便签', exact: true })
      .click();
  // Exercise the installed extension without signing into a real account.
  await page.addInitScript(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message) => {
      if (message.type === 'duoyu-auth' && message.action === 'status')
        return Promise.resolve({
          view: {
            account: JSON.parse(
              sessionStorage.getItem('memo-test-account') || 'null',
            ),
          },
        });
      if (message.type === 'duoyu-auth' && message.action === 'sync')
        return Promise.resolve({ status: 503, error: 'offline fixture' });
      return original(message);
    };
  });
  const switchAccount = async (sub) => {
    await page.evaluate(async (sub) => {
      const account = {
        issuer: 'https://memo.test',
        sub,
        name: sub,
        email: '',
        picture: '',
      };
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(account.issuer + '\0' + sub),
      );
      const key = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      sessionStorage.setItem('memo-test-account', JSON.stringify(account));
      localStorage.setItem('duoyu-sync-account', key);
    }, sub);
    await page.reload();
  };
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await open();
  const board = page.locator('.memo-board');
  const expectWallpaper = async () => {
    await expect(page.locator('.wallpaper > img.loaded')).toBeVisible();
    for (const surface of [
      page.locator('.workspace-overlay'),
      board.locator('.memo-main'),
      board.locator('.memo-toolbar'),
      board.locator('.memo-viewport'),
    ]) {
      await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      if (
        await surface.evaluate((el) =>
          el.matches('.memo-viewport:not(.is-archive)'),
        )
      )
        await expect(surface).toHaveCSS('background-image', /radial-gradient/);
      else await expect(surface).toHaveCSS('background-image', 'none');
      await expect(surface).toHaveCSS('box-shadow', 'none');
      await expect(surface).toHaveCSS('backdrop-filter', 'none');
    }
    // Compare a bare area of the wall to the same pixels of the desktop.
    const { x, y, width } = await board.locator('.memo-viewport').boundingBox();
    const clip = {
      x: Math.floor(x + width - 40),
      y: Math.ceil(y + 10),
      width: 16,
      height: 16,
    };
    const visible = await page.screenshot({
      clip,
      animations: 'disabled',
      style: '.memo-viewport { background-image: none !important; }',
    });
    const wallpaper = await page.screenshot({
      clip,
      animations: 'disabled',
      style: '.workspace-overlay { visibility: hidden !important; }',
    });
    assert.deepEqual(
      visible,
      wallpaper,
      'The empty wall must show the original wallpaper pixels',
    );
  };
  const toolbar = board.locator('.memo-toolbar');
  const searchBox = toolbar.locator('.memo-search');
  const search = searchBox.getByRole('searchbox', { name: '搜索当前页便签' });
  const clearSearch = searchBox.getByRole('button', { name: '清空便签搜索' });
  const noteMenu = board.getByRole('menu', { name: '便签操作' });
  const expectSearchToolbar = async (hasQuery = false) => {
    await expect(search).toBeInViewport({ ratio: 1 });
    await expect(
      toolbar.locator(
        'input, button, select, textarea, a[href], [tabindex="0"], [role="button"]',
      ),
    ).toHaveCount(hasQuery ? 2 : 1);
    await expect(clearSearch).toHaveCount(hasQuery ? 1 : 0);
    await expect(toolbar.locator('.memo-selection-count')).toHaveCount(0);
    const heading = await toolbar.getByRole('heading').boundingBox();
    const box = await searchBox.boundingBox();
    const bounds = await toolbar.boundingBox();
    assert(
      heading.x + heading.width <= box.x,
      'The title and search fit side by side',
    );
    assert(
      heading.y < box.y + box.height && box.y < heading.y + heading.height,
      'The search remains on the same row as the title',
    );
    assert(
      bounds.x + bounds.width - box.x - box.width <= 12,
      'The search is at the right edge of the toolbar',
    );
  };
  const memoCanvas = board.getByRole('region', { name: '便签画布' });
  const addFromCanvas = async (position = { x: 20, y: 20 }) => {
    await memoCanvas.click({ button: 'right', position });
    await noteMenu.getByRole('menuitem', { name: /新建便签/ }).click();
  };
  const cardAction = async (target, name) => {
    await target.click({ button: 'right' });
    await noteMenu.getByRole('menuitem', { name, exact: true }).click();
  };
  await expect(board.locator('h2')).toHaveCSS('color', 'rgb(34, 34, 34)');
  await expect(page.locator('.account-entry img')).toHaveCSS(
    'filter',
    'brightness(0)',
  );
  await expect(board.locator('.memo-main')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expectSearchToolbar();
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(memoCanvas).toBeFocused();
  await page.keyboard.press('Shift+F10');
  await expect(
    noteMenu.getByRole('menuitem', { name: /新建便签/ }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(noteMenu).toHaveCount(0);
  await expect(memoCanvas).toBeFocused();
  await addFromCanvas();
  await expect(page.getByRole('dialog', { name: '登录后编辑' })).toBeVisible();
  await expect(board.locator('.memo-card')).toHaveCount(0);
  wallpaperOnline = true;
  await switchAccount('memo-ui-a');
  await open();
  await expect(board.getByText('这面便签墙还是空的')).toBeVisible();
  await expectSearchToolbar();
  await board.getByRole('button', { name: '新建菜单' }).click();
  const dialog = page.getByRole('dialog', { name: '新建菜单' });
  await dialog.getByRole('textbox', { name: '菜单名称' }).fill('设计笔记');
  await dialog.getByRole('button', { name: '添加', exact: true }).click();
  await expect(board.getByRole('heading', { name: '设计笔记' })).toBeVisible();
  await addFromCanvas();
  const card = board.locator('.memo-card').first();
  const editor = card.getByRole('textbox', { name: '便签正文' });
  const preview = card.locator('.memo-preview');
  const expectMarkdown = async () => {
    await expect(preview.getByRole('heading', { level: 1 })).toHaveText(
      '本周设计评审',
    );
    await expect(preview.locator('strong')).toHaveText('交互');
    await expect(preview.getByRole('listitem')).toHaveText([
      '便签地图',
      '账号同步',
    ]);
  };
  await expect(editor).toBeFocused();
  for (const [shortcut, tag, label] of [
    ['# ', 'h1', '111'],
    ['## ', 'h2', '222'],
    ['### ', 'h3', '333'],
  ]) {
    await editor.pressSequentially(shortcut + label);
    await expect(editor.locator(tag)).toHaveText(label);
    await editor.press('Enter');
  }
  await editor.pressSequentially('*bbb*');
  await expect(editor.locator('em')).toHaveText('bbb');
  await editor.press('Enter');
  await editor.pressSequentially('- 123');
  await editor.press('Enter');
  await editor.pressSequentially('456');
  await expect(editor.locator('li')).toHaveText(['123', '456']);
  await expect(editor).toBeFocused();
  await page.screenshot({ path: path.join(evidence, 'editing.png') });
  await editor.press('Control+a');
  await editor.press('Backspace');
  await editor.pressSequentially('# 本周设计评审');
  await editor.press('Enter');
  await editor.pressSequentially('**交互**与样式');
  await editor.press('Enter');
  await editor.pressSequentially('- 便签地图');
  await editor.press('Enter');
  await editor.pressSequentially('账号同步');
  await expect(editor.locator('h1')).toHaveText('本周设计评审');
  await expect(editor.locator('strong')).toHaveText('交互');
  await expect(editor.locator('li')).toHaveCount(2);
  await expect(card.getByRole('toolbar')).toHaveCount(0);
  await expect(card.locator('.memo-format-bar, .memo-grip i')).toHaveCount(0);
  await editor.press('Tab');
  await expectMarkdown();
  await preview.getByRole('heading').click();
  await expect(editor).toBeFocused();
  await expect(editor.locator('h1')).toHaveText('本周设计评审');
  await expect(editor.locator('strong')).toHaveText('交互');
  await expect(editor.locator('li')).toHaveCount(2);
  const options = card.getByRole('button', { name: '便签操作' });
  await options.press('Enter');
  await expect(noteMenu.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(noteMenu.getByRole('menuitem', { name: '删除' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(options).toBeFocused();
  await options.press('Enter');
  await board.getByRole('menuitemradio', { name: '雾蓝' }).click();
  await expect(card).toHaveAttribute('data-color', 'sky');
  const dragBy = async (el, dx, dy, position) => {
    const box = await el.boundingBox();
    const x = box.x + (position?.x ?? box.width / 2),
      y = box.y + (position?.y ?? box.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
  };
  const before = await card.boundingBox();
  const cardTop = { x: 18, y: 10 };
  await dragBy(card, 110, 65, cardTop);
  await expect
    .poll(async () => Math.round((await card.boundingBox()).x - before.x))
    .toBe(110);
  await dragBy(card.locator('.memo-resize'), 66, 32);
  await expect
    .poll(async () =>
      Math.round((await card.boundingBox()).width - before.width),
    )
    .toBe(66);
  await board.getByRole('button', { name: '放大' }).click();
  const map = board.getByRole('group', { name: '便签缩略地图' });
  const scale = board.locator('.memo-scale');
  const reset = board.getByRole('button', { name: '恢复到 100%' });
  const overview = board.getByRole('complementary', { name: '画布导航' });
  await expect(scale).toHaveText('120%');
  await expect(reset).toHaveText('恢复 100%');
  await reset.click();
  await expect(scale).toHaveText('100%');
  await expect(overview).toHaveCSS('box-shadow', 'none');
  await expect(overview).toHaveCSS('border-top-width', '0px');
  const frame = map.locator('.map-frame');
  const mapOrigin = Number(await frame.getAttribute('x'));
  await map.press('ArrowRight');
  await expect
    .poll(async () => Number(await frame.getAttribute('x')))
    .toBeGreaterThan(mapOrigin);
  await map.press('ArrowLeft');
  await expect
    .poll(async () =>
      Math.abs(Number(await frame.getAttribute('x')) - mapOrigin),
    )
    .toBeLessThan(1);
  await map.hover();
  await page.mouse.wheel(0, -150);
  await expect
    .poll(async () => Number.parseInt(await scale.innerText(), 10))
    .toBeGreaterThan(100);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(async () => Number.parseInt(await scale.innerText(), 10))
    .toBeLessThan(100);
  await reset.click();
  await expect(scale).toHaveText('100%');
  await expect(board.getByText(/有更改待处理|待同步/)).toHaveCount(0);
  await expect(board.locator('[title*="有更改待处理"]')).toHaveCount(0);
  await page.keyboard.press('Control+f');
  await expect(search).toBeFocused();
  await search.fill('不存在的内容');
  await expect(board.getByText('没有找到匹配的便签')).toBeVisible();
  await expectSearchToolbar(true);
  await clearSearch.click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(card).toBeVisible();
  await search.fill('交互与样式');
  const result = board
    .getByRole('region', { name: '便签搜索结果' })
    .getByRole('button');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('本周设计评审');
  await expect(result).toContainText('交互与样式');
  await expect(result).not.toContainText(/#|\*\*/);
  await search.press('Enter');
  await expect(memoCanvas).toBeFocused();
  await expect(search).toHaveValue('');
  await expect(card).toHaveClass(/is-selected/);
  await expectSearchToolbar();
  await cardAction(card, '归档');
  await expect(card).toHaveCount(0);
  await board.getByRole('button', { name: '归档', exact: true }).click();
  await expectSearchToolbar();
  await expectMarkdown();
  await preview.click();
  await expect(editor).toHaveCount(0);
  await expect(overview).toHaveCount(0);
  const archive = board.locator('.memo-viewport.is-archive');
  await expect(archive).toHaveCSS('background-image', 'none');
  await page.keyboard.press('Tab');
  await archive.focus();
  await expect(archive).toBeFocused();
  await expect(archive).toHaveCSS('outline-style', 'none');
  await expect(archive).toHaveCSS('box-shadow', 'none');
  await cardAction(card, '移回便签墙');
  await expect(card).toHaveCount(0);
  await expectSearchToolbar();
  await page.reload();
  await open();
  await board.getByRole('button', { name: '设计笔记', exact: true }).click();
  await expectMarkdown();
  await preview.click();
  await expect(editor.locator('h1')).toHaveText('本周设计评审');
  await expect(editor.locator('strong')).toHaveText('交互');
  await expect(editor.locator('li')).toHaveCount(2);
  await editor.press('Tab');
  await expectMarkdown();
  await expect(card).toHaveAttribute('data-color', 'sky');
  await expectWallpaper();
  await page.screenshot({
    path: path.join(evidence, 'desktop.png'),
    animations: 'disabled',
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expectSearchToolbar();
    await expect(card).toBeInViewport();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
  await page.evaluate(() => {
    localStorage.setItem('duoyu-theme', 'dark');
    window.dispatchEvent(new Event('duoyu-theme-change'));
  });
  await expect(page.locator('html')).toHaveAttribute(
    'data-fallback-theme',
    'dark',
  );
  await expectWallpaper();
  await page.screenshot({
    path: path.join(evidence, 'narrow-dark.png'),
    animations: 'disabled',
  });
  await search.fill('设计');
  await board
    .getByRole('region', { name: '便签搜索结果' })
    .getByRole('button')
    .click();
  await expectSearchToolbar();
  await cardAction(card, '删除');
  const confirm = page.getByRole('dialog', { name: '删除便签？' });
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(card).toHaveCount(1);
  await cardAction(card, '删除');
  await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Alternate between two real editors and leave the page immediately after typing.
  await addFromCanvas();
  const firstDraftId = await board
    .locator('.memo-card:has([contenteditable=true])')
    .getAttribute('data-memo-id');
  const firstDraft = board.locator(`[data-memo-id="${firstDraftId}"]`);
  const firstDraftEditor = firstDraft.getByRole('textbox', {
    name: '便签正文',
  });
  await firstDraftEditor.fill('草稿 A ');
  await firstDraftEditor.pressSequentially('alpha-0123456789');
  await addFromCanvas({ x: 430, y: 40 });
  const otherDraftId = await board
    .locator('.memo-card:has([contenteditable=true])')
    .getAttribute('data-memo-id');
  const otherDraft = board.locator(`[data-memo-id="${otherDraftId}"]`);
  const otherEditor = otherDraft.getByRole('textbox', { name: '便签正文' });
  assert.notEqual(otherDraftId, firstDraftId);
  await otherEditor.fill('草稿 B ');
  await otherEditor.pressSequentially('beta-9876543210');
  await otherEditor.press('Escape');
  await expect(otherDraft.locator('.memo-preview')).toBeFocused();
  await firstDraft.locator('.memo-preview').press('Enter');
  await expect(firstDraftEditor).toBeFocused();
  await firstDraftEditor.press('Control+End');
  await firstDraftEditor.pressSequentially('-finished');
  const wall = board.getByRole('button', { name: '便签墙', exact: true });
  await wall.click();
  await page.reload();
  await open();
  await board.getByRole('button', { name: '设计笔记', exact: true }).click();
  await expect(firstDraft.locator('.memo-preview')).toHaveText(
    '草稿 A alpha-0123456789-finished',
  );
  await expect(otherDraft.locator('.memo-preview')).toHaveText(
    '草稿 B beta-9876543210',
  );
  await search.fill('草稿');
  await expect(result).toHaveCount(2);
  await search.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('草稿');
  await search.press('ArrowDown');
  await expect(result.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(result.last()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(result.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(result.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(result.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('草稿');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await search.fill('草稿');
  await search.press('ArrowUp');
  await expect(result.last()).toBeFocused();
  const lastDraft = (await result.last().innerText()).includes('草稿 A')
    ? firstDraft
    : otherDraft;
  await page.keyboard.press('Enter');
  await expect(lastDraft).toHaveClass(/is-selected/);
  await expect(memoCanvas).toBeFocused();
  const wallNote = (i) => ({
    id: 'wall-' + i,
    pageId: 'wall',
    title: '',
    body: '想法 ' + i,
    color: 'sage',
    x: i * 310,
    y: 20,
    width: 264,
    height: 212,
    layer: i,
    archiveOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  });
  const seedRows = (store, rows, clearOutbox = false) =>
    page.evaluate(
      ({ store, rows, clearOutbox }) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(
            'duoyu-account-' + localStorage.getItem('duoyu-sync-account'),
          );
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const stores = clearOutbox ? [store, 'syncOutbox'] : [store];
            const tx = db.transaction(stores, 'readwrite');
            if (clearOutbox) tx.objectStore('syncOutbox').clear();
            for (const row of rows) tx.objectStore(store).put(row);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => reject(tx.error);
          };
        }),
      { store, rows, clearOutbox },
    );
  // Two old-format notes far apart make the whole-wall view require less than 25% zoom.
  await seedRows('memos', [
    {
      ...wallNote(0),
      title: '旧版标题',
      body: '重点内容',
      html: '<div><b>重点</b>内容</div>',
    },
    { ...wallNote(1), x: 8000, y: 5000, body: '远处的便签' },
  ]);
  await wall.click();
  const legacy = board.locator('[data-memo-id="wall-0"]');
  const far = board.locator('[data-memo-id="wall-1"]');
  const legacyPreview = legacy.locator('.memo-preview');
  await expect(legacyPreview.getByRole('heading')).toHaveText('旧版标题');
  await expect(legacyPreview.locator('b,strong')).toHaveText('重点');
  await legacyPreview.click();
  const legacyEditor = legacy.getByRole('textbox', { name: '便签正文' });
  await expect(legacyEditor.locator('h1')).toHaveText('旧版标题');
  await expect(legacyEditor.locator('strong')).toHaveText('重点');
  await legacyEditor.press('Control+End');
  await legacyEditor.press('Enter');
  await page.keyboard.insertText('迁移后的修改');
  await legacyEditor.press('Tab');
  await expect(legacyPreview).toContainText('迁移后的修改');
  await page.reload();
  await open();
  await legacyPreview.click();
  await expect(legacyEditor).toContainText('迁移后的修改');
  await legacyEditor.press('Tab');
  await expect(far).not.toBeInViewport();
  await board.getByRole('button', { name: '查看全部便签' }).click();
  const surface = board.locator('.memo-surface');
  const camera = () =>
    surface.evaluate((node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return { scale: matrix.a, x: matrix.e, y: matrix.f };
    });
  await expect.poll(async () => (await camera()).scale).toBeLessThan(0.25);
  const fitted = await camera();
  assert(fitted.scale > 0);
  const viewport = await board.locator('.memo-viewport').boundingBox();
  const mapBox = await overview.boundingBox();
  for (const note of [legacy, far]) {
    await expect(note).toBeInViewport({ ratio: 1 });
    const box = await note.boundingBox();
    assert(
      box.x >= viewport.x && box.x + box.width <= viewport.x + viewport.width,
    );
    assert(
      box.y >= viewport.y && box.y + box.height <= viewport.y + viewport.height,
    );
    assert(
      box.x + box.width <= mapBox.x || box.y + box.height <= mapBox.y,
      'Fit all keeps both notes visible above or beside the minimap',
    );
  }
  await board.getByRole('button', { name: '设计笔记', exact: true }).click();
  await wall.click();
  assert.deepEqual(
    await camera(),
    fitted,
    'Changing pages preserves the fitted camera',
  );
  await reset.click();
  await expect.poll(async () => (await camera()).scale).toBe(1);
  await search.fill('旧版标题');
  await board
    .getByRole('region', { name: '便签搜索结果' })
    .getByRole('button')
    .click();
  await expect(legacy).toBeInViewport();
  await board.getByRole('button', { name: '设计笔记', exact: true }).click();
  await seedRows(
    'memos',
    Array.from({ length: 500 }, (_, i) => wallNote(i)),
  );
  await board.getByRole('button', { name: '便签墙', exact: true }).click();
  await expect(board.locator('.memo-total')).toHaveText('500 张');
  const mounted = await board.locator('.memo-card').count();
  assert(mounted > 0 && mounted < 10);
  await expect(board.locator('.memo-format-bar')).toHaveCount(0);
  // The whole wall stays navigable without mounting 500 Markdown documents.
  const fitAll = board.getByRole('button', { name: '查看全部便签' });
  await fitAll.click();
  await expect(board.locator('.memo-distant-card')).toHaveCount(500);
  await expect(board.locator('.memo-preview')).toHaveCount(0);
  const middle = board.locator('[data-memo-id="wall-250"]');
  await middle.click();
  await expect(middle.locator('.memo-preview')).toHaveText('想法 250');
  await expect(middle).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() => board.locator('.memo-preview').count())
    .toBeLessThan(10);
  await fitAll.click();
  await addFromCanvas();
  const newEditor = board.getByRole('textbox', { name: '便签正文' });
  await expect(newEditor).toBeFocused();
  await expect(newEditor).toBeInViewport({ ratio: 1 });
  await newEditor.fill('全览后新增');
  await newEditor.press('Escape');
  await expect(board.locator('.memo-total')).toHaveText('501 张');
  await cardAction(
    board.locator('.memo-card').filter({ hasText: '全览后新增' }),
    '删除',
  );
  await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(board.locator('.memo-total')).toHaveText('500 张');
  await search.fill('想法 499');
  await board
    .getByRole('region', { name: '便签搜索结果' })
    .getByRole('button')
    .click();
  await expect(board.locator('[data-memo-id="wall-499"]')).toBeInViewport();
  await search.fill('想法 0');
  await board
    .getByRole('region', { name: '便签搜索结果' })
    .getByRole('button')
    .click();
  await board.locator('[data-memo-id="wall-1"]').click({
    position: cardTop,
    modifiers: ['Shift'],
  });
  await expect(board.locator('.memo-card.is-selected')).toHaveCount(2);
  await expectSearchToolbar();
  await cardAction(board.locator('[data-memo-id="wall-1"]'), '归档');
  await expect(board.locator('.memo-total')).toHaveText('498 张');
  await board.getByRole('button', { name: '归档', exact: true }).click();
  await expect(board.locator('.memo-card')).toHaveCount(2);
  const firstId = await card.getAttribute('data-memo-id');
  const firstBox = await card.boundingBox(),
    secondBox = await board.locator('.memo-card').nth(1).boundingBox();
  await dragBy(
    card,
    secondBox.x - firstBox.x,
    secondBox.y - firstBox.y,
    cardTop,
  );
  await expect(board.locator('.memo-card').last()).toHaveAttribute(
    'data-memo-id',
    firstId,
  );
  await switchAccount('memo-ui-b');
  await open();
  await expect(board.locator('.memo-total')).toHaveText('0 张');
  await expect(board.getByRole('button', { name: '设计笔记' })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: '快捷 Dock' })
    .getByRole('button', { name: '标签工作区', exact: true })
    .click();
  await expect(page.locator('.workspace-overlay')).toHaveClass(
    /glass-focus-layer/,
  );
  await expect(
    page.getByRole('searchbox', { name: '搜索工作区' }),
  ).toBeVisible();
  // Account setup queues default preferences. Isolate the unresolved conflict
  // before mounting the memo wall so its pending-upload subscription starts empty.
  await seedRows(
    'syncConflicts',
    [
      {
        id: 'memo-conflict',
        createdAt: 1,
        reason: 'conflict',
        operation: { id: 'memo-conflict', createdAt: 1, rows: {} },
      },
    ],
    true,
  );
  await open();
  await expect(board.getByText('这面便签墙还是空的')).toBeVisible();
  await expectWallpaper();
  await page.getByRole('button', { name: '我的账号' }).click();
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings.getByRole('button', { name: '立即同步' }).click();
  await expect(
    settings.getByRole('region', { name: '云同步' }).getByRole('status'),
  ).toHaveText('有更改待处理');
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(board.locator('.memo-meta')).toHaveText('0 张');
  assert(
    !(await board
      .locator('.memo-total')
      .evaluate((el) => getComputedStyle(el, '::after').content.includes('·'))),
  );
  await switchAccount('memo-ui-a');
  await open();
  await expect(board.locator('.memo-total')).toHaveText('498 张');
  await board.getByRole('button', { name: '设计笔记', exact: true }).click();
  await expect(firstDraft.locator('.memo-preview')).toContainText(
    'alpha-0123456789-finished',
  );
  await expect(otherDraft.locator('.memo-preview')).toContainText(
    'beta-9876543210',
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS ${channel}: guest/account isolation, Markdown edit/preview and legacy migration, drag/resize/color, minimap wheel/reset/fit and camera persistence, search, archive/restore/reorder, reload, delete/cancel, mobile/dark, 500 notes (${mounted} cards mounted). Screenshots: ${evidence}`,
  );
} finally {
  await context.close();
}
