import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/collections-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${ext}`,
      `--disable-extensions-except=${ext}`,
      '--enable-unsafe-swiftshader',
    ],
  },
);
try {
  await context.route('https://api.bimg.cc/**', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#33495d"/><stop offset="1" stop-color="#796461"/></linearGradient></defs><path fill="url(#a)" d="M0 0h1920v1080H0z"/></svg>',
    }),
  );
  await context.route('https://example.com/workspace-fixture/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: `<title>${r.request().url().split('/').at(-1)}</title><p>Fixture</p>`,
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page.locator('.clock-time').waitFor();
  const owner = await page.evaluate(() => chrome.tabs.getCurrent());
  const tabs = [];
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    const fixture = await context.newPage();
    const url = `https://example.com/workspace-fixture/${name}`;
    await fixture.goto(url);
    tabs.push(
      await page.evaluate(
        async (url) => (await chrome.tabs.query({ url }))[0],
        url,
      ),
    );
  }
  await page.bringToFront();
  await page.mouse.click(1000, 450);
  const board = page.locator('.workspace-board');
  await expect(board).toBeVisible();
  await expect(
    board.getByRole('button', { name: '保存标签页 Alpha', exact: true }),
  ).toBeEnabled();
  const alphaTab = board.locator(`[data-browser-tab-id="${tabs[0].id}"]`);
  await expect(alphaTab.locator('strong')).toHaveText('Alpha');
  await expect
    .poll(() =>
      alphaTab
        .locator('.workspace-favicon img')
        .evaluateAll(
          (images) =>
            images.length === 1 &&
            images[0].complete &&
            images[0].naturalWidth > 0,
        ),
    )
    .toBe(true);
  const alphaPage = context.pages().find((p) => p.url().endsWith('/Alpha'));
  await alphaPage.evaluate(() => {
    document.title = 'Updated title';
  });
  await expect(alphaTab.locator('strong')).toHaveText('Updated title');
  await alphaPage.evaluate(() => {
    document.title = 'Alpha';
  });
  await expect(alphaTab.locator('strong')).toHaveText('Alpha');
  const create = async (name) => {
    await board
      .getByRole('button', { name: '＋ 新建集合', exact: true })
      .click();
    await board
      .getByRole('textbox', { name: '集合名称', exact: true })
      .fill(name);
    await board.getByRole('button', { name: '创建', exact: true }).click();
  };
  await create('项目资料');
  const first = page.locator('.workspace-collection').filter({
    has: page.getByRole('button', { name: '重命名 项目资料', exact: true }),
  });
  await expect(first).toBeVisible();
  const firstId = await first.getAttribute('data-collection-id');
  await board
    .getByRole('button', { name: '保存标签页 Alpha', exact: true })
    .click();
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(1);
  await page.locator(`[data-browser-tab-id="${tabs[1].id}"]`).dragTo(first);
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(2);
  await board
    .getByRole('button', { name: '保存标签页 Alpha', exact: true })
    .click();
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(2);
  assert.equal(
    (await page.evaluate(() => chrome.tabs.query({}))).filter((t) =>
      t.url?.includes('workspace-fixture'),
    ).length,
    3,
  );
  await create('稍后阅读');
  const second = page.locator('.workspace-collection').filter({
    has: page.getByRole('button', { name: '重命名 稍后阅读', exact: true }),
  });
  const secondId = await second.getAttribute('data-collection-id');
  await first.getByLabel('移动收藏 Alpha').selectOption(secondId);
  await expect(second.locator('.workspace-saved-tab')).toHaveCount(1);
  await second
    .locator('.workspace-saved-tab')
    .dragTo(first.locator('.workspace-saved-tab').first());
  await expect(first.locator('.workspace-saved-tab strong')).toHaveText([
    'Alpha',
    'Beta',
  ]);
  await first
    .locator('.workspace-saved-tab')
    .nth(1)
    .dragTo(first.locator('.workspace-saved-tab').first());
  await expect(first.locator('.workspace-saved-tab strong')).toHaveText([
    'Beta',
    'Alpha',
  ]);
  await second
    .getByRole('button', { name: '拖动集合 稍后阅读', exact: true })
    .dragTo(first);
  await expect(page.locator('.workspace-collection').first()).toHaveAttribute(
    'data-collection-id',
    secondId,
  );
  await second
    .getByRole('button', { name: '重命名 稍后阅读', exact: true })
    .click();
  await board
    .getByRole('textbox', { name: '重命名集合', exact: true })
    .fill('灵感收藏');
  await board
    .getByRole('button', { name: '保存集合名称', exact: true })
    .click();
  await expect(
    board.getByRole('button', { name: '重命名 灵感收藏', exact: true }),
  ).toBeVisible();
  await board.getByRole('searchbox', { name: '搜索工作区' }).fill('Alpha');
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(1);
  await expect(board.locator('.workspace-open-tab')).toHaveCount(1);
  await board.getByRole('button', { name: '清空工作区搜索' }).click();
  await first
    .getByRole('button', { name: '移除收藏 Alpha', exact: true })
    .click();
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(1);
  await board.getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(first.locator('.workspace-saved-tab strong')).toHaveText([
    'Beta',
    'Alpha',
  ]);
  await board
    .getByRole('button', { name: '删除集合 灵感收藏', exact: true })
    .click();
  await board.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(board.locator('.workspace-collection')).toHaveCount(1);
  await board.getByRole('button', { name: '撤销删除', exact: true }).click();
  await expect(board.locator('.workspace-collection')).toHaveCount(2);
  await board.getByLabel('保存到集合').selectOption(firstId);
  await board.getByRole('button', { name: '全部保存', exact: true }).click();
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(3);
  await page.screenshot({ path: 'work/workspace-collections-desktop.png' });
  await board
    .getByRole('button', { name: '关闭标签页 Beta', exact: true })
    .click();
  await expect(
    page.locator(`[data-browser-tab-id="${tabs[1].id}"]`),
  ).toHaveCount(0);
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(3);
  const before = (await page.evaluate(() => chrome.tabs.query({}))).length;
  await board
    .getByRole('button', {
      name: '打开集合 项目资料 的全部标签页',
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => chrome.tabs.query({}))).length)
    .toBe(before + 3);
  await page.reload();
  await page.locator('.clock-time').waitFor();
  await page.mouse.click(1000, 450);
  await expect(first.locator('.workspace-saved-tab strong')).toHaveText([
    'Beta',
    'Alpha',
    'Gamma',
  ]);
  await expect(page.locator('.workspace-collection').first()).toHaveAttribute(
    'data-collection-id',
    secondId,
  );
  // A second new-tab page must see the same persisted collections and live edits.
  const peer = await context.newPage();
  await peer.goto(page.url());
  await peer.locator('.clock-time').waitFor();
  await peer.mouse.click(1000, 450);
  await expect(peer.locator('.workspace-saved-tab')).toHaveCount(3);
  await create('跨页同步');
  await expect(
    peer.getByRole('button', { name: '重命名 跨页同步', exact: true }),
  ).toBeVisible();
  await peer.close();
  // External browser events update the visible list without reopening the workspace.
  const otherPage = await context.newPage();
  await otherPage.goto('https://example.com/workspace-fixture/OtherWindow');
  const remote = await page.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      url: 'https://example.com/workspace-fixture/OtherWindow',
    });
    return chrome.windows.create({ tabId: tab.id, focused: false });
  });
  await page.bringToFront();
  await board.getByRole('button', { name: '所有窗口', exact: true }).click();
  await expect(
    board.getByRole('button', { name: '保存标签页 OtherWindow', exact: true }),
  ).toBeVisible();
  await board.getByRole('button', { name: '当前窗口', exact: true }).click();
  await expect(
    board.getByRole('button', { name: '保存标签页 OtherWindow', exact: true }),
  ).toHaveCount(0);
  await page.evaluate((id) => chrome.windows.remove(id), remote.id);
  await page
    .locator(`[data-browser-tab-id="${tabs[0].id}"] .workspace-link`)
    .click();
  assert.equal(
    (await page.evaluate((id) => chrome.tabs.get(id), tabs[0].id)).active,
    true,
  );
  await page.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    owner.id,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: 'work/workspace-collections-mobile.png' });
  await board.getByRole('button', { name: '关闭工作区', exact: true }).click();
  await expect(page.locator('.workspace-overlay')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS real browser tabs, drag save/dedup, cross-collection move/order, collection reorder/rename/delete/undo, search, save all, close/open all, reload persistence, live cross-page updates, windows, activate, responsive layout',
  );
} finally {
  await context.close();
}
