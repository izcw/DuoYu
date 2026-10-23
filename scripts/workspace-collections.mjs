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
  await page.addInitScript(() => {
    window.landingChecks = [];
    let origin, released;
    document.addEventListener(
      'dragstart',
      (e) => {
        const source = e.target.closest(
          '.workspace-saved-tab, .workspace-open-tab, .workspace-browser-group, .workspace-collection',
        );
        if (source) {
          const r = source.getBoundingClientRect();
          origin = { x: e.clientX - r.left, y: e.clientY - r.top };
        }
      },
      true,
    );
    document.addEventListener(
      'drop',
      (e) => {
        released = { x: e.clientX, y: e.clientY };
      },
      true,
    );
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (
        this.classList.contains('drag-landing-preview') &&
        origin &&
        released
      ) {
        const r = this.getBoundingClientRect();
        window.landingChecks.push({
          x: Math.abs(r.left - (released.x - origin.x)),
          y: Math.abs(r.top - (released.y - origin.y)),
        });
      }
      return animate.apply(this, args);
    };
  });
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
  await expect(board.locator('.workspace-tabs .workspace-icon')).toHaveCount(0);
  await expect(board.locator('.workspace-save-controls')).toHaveCount(0);
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
  for (const name of ['集合01', '集合02']) {
    await board
      .getByRole('button', { name: '＋ 新建集合', exact: true })
      .click();
    await expect(
      board.getByRole('button', { name: `重命名 ${name}`, exact: true }),
    ).toBeVisible();
  }
  await expect(
    board.getByRole('textbox', { name: '集合名称', exact: true }),
  ).toHaveCount(0);
  for (const name of ['集合01', '集合02']) {
    await board
      .getByRole('button', { name: `删除集合 ${name}`, exact: true })
      .click();
    await board.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(
      board.getByRole('button', { name: `重命名 ${name}`, exact: true }),
    ).toHaveCount(0);
  }
  const create = async (name) => {
    await board
      .getByRole('button', { name: '＋ 新建集合', exact: true })
      .click();
    const group = board.locator('.workspace-collection').last();
    await expect(group.locator('.workspace-collection-name')).toContainText(
      '集合01',
    );
    await group
      .getByRole('button', { name: '重命名 集合01', exact: true })
      .click();
    await group
      .getByRole('textbox', { name: '重命名集合', exact: true })
      .fill(name);
    await group.getByRole('button', { name: '保存集合名称' }).click();
    await expect(group.locator('.workspace-collection-name')).toContainText(
      name,
    );
  };
  await create('项目资料');
  const first = page.locator('.workspace-collection').filter({
    has: page.getByRole('button', { name: '重命名 项目资料', exact: true }),
  });
  await expect(first).toBeVisible();
  const firstId = await first.getAttribute('data-collection-id');
  await alphaTab.dragTo(first);
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.landingChecks.length))
    .toBeGreaterThan(0);
  const landingCheck = await page.evaluate(() => window.landingChecks.at(-1));
  assert.ok(
    landingCheck.x < 2 && landingCheck.y < 2,
    `Drop must start at pointer grab offset: ${JSON.stringify(landingCheck)}`,
  );
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);

  await page.locator(`[data-browser-tab-id="${tabs[1].id}"]`).dragTo(first);
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(2);
  await alphaTab.dragTo(first);
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
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
  await first.getByRole('button', { name: '更多 Alpha', exact: true }).click();
  await first.getByLabel('移动收藏 Alpha').selectOption(secondId);
  await expect(second.locator('.workspace-saved-tab')).toHaveCount(1);
  await second
    .locator('.workspace-saved-tab')
    .dragTo(first.locator('.workspace-saved-tab').first());
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect(first.locator('.workspace-saved-tab strong')).toHaveText([
    'Alpha',
    'Beta',
  ]);
  await first
    .locator('.workspace-saved-tab')
    .nth(1)
    .dragTo(first.locator('.workspace-saved-tab').first());
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect(first.locator('.workspace-saved-tab strong')).toHaveText([
    'Beta',
    'Alpha',
  ]);
  await second
    .getByRole('button', { name: '拖动集合 稍后阅读', exact: true })
    .dragTo(first);
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
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
  await first.getByRole('button', { name: '更多 Alpha', exact: true }).click();
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
  await board.locator(`[data-browser-tab-id="${tabs[2].id}"]`).dragTo(first);
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(3);
  await page.evaluate(() => {
    window.copiedLinks = '';
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text) => {
        window.copiedLinks = text;
      },
    });
  });
  await first.getByRole('checkbox', { name: '选择标签页 Alpha' }).check();
  await first.getByRole('checkbox', { name: '选择标签页 Beta' }).check();
  await expect(board.locator('.workspace-selection')).toContainText(
    '已选择 2 项',
  );
  await board
    .getByRole('button', { name: '复制所选链接', exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.copiedLinks)).split('\n').length,
    2,
  );
  await board.getByRole('button', { name: '标记所选', exact: true }).click();
  await expect(
    first.getByRole('button', { name: '标记收藏 Alpha', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    first.getByRole('button', { name: '标记收藏 Beta', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await board.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(board.locator('.workspace-selection')).toHaveCount(0);
  await first
    .getByRole('button', { name: '复制链接 Alpha', exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.copiedLinks),
    'https://example.com/workspace-fixture/Alpha',
  );
  await first.getByRole('button', { name: '更多 Alpha', exact: true }).click();
  await first.getByRole('button', { name: '修改', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '修改标签页' });
  await editor.getByLabel('网址', { exact: true }).fill('javascript:alert(1)');
  await editor.getByRole('button', { name: '保存修改' }).click();
  await expect(editor.getByRole('alert')).toContainText('http');
  await editor.getByLabel('名称', { exact: true }).fill('Alpha edited');
  await editor
    .getByLabel('网址', { exact: true })
    .fill('https://example.com/edited');
  await editor.getByRole('button', { name: '保存修改' }).click();
  await expect(
    first.getByRole('button', { name: '更多 Alpha edited', exact: true }),
  ).toBeVisible();
  await first
    .getByRole('button', { name: '更多 Alpha edited', exact: true })
    .click();
  await first.getByRole('button', { name: '修改', exact: true }).click();
  await editor.getByLabel('名称', { exact: true }).fill('Alpha');
  await editor
    .getByLabel('网址', { exact: true })
    .fill('https://example.com/workspace-fixture/Alpha');
  await editor.getByRole('button', { name: '保存修改' }).click();
  await expect(editor).toHaveCount(0);

  await board.getByRole('button', { name: '列表', exact: true }).click();
  await expect(board).toHaveClass(/is-list-view/);
  await board.getByRole('button', { name: '收起全部', exact: true }).click();
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(0);
  await board.getByRole('button', { name: '展开全部', exact: true }).click();
  await expect(first.locator('.workspace-saved-tab')).toHaveCount(3);
  await board.getByRole('button', { name: '网格', exact: true }).click();
  await expect(board).not.toHaveClass(/is-list-view/);
  await expect(
    board.getByText('保存一组标签，随时继续', { exact: true }),
  ).toHaveCount(0);
  await expect(board.locator('.workspace-tabs-footer')).toHaveCount(0);
  await page.screenshot({ path: 'work/workspace-collections-desktop.png' });
  await page.evaluate((id) => chrome.tabs.remove(id), tabs[1].id);
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
  await expect(
    first.getByRole('button', { name: '标记收藏 Alpha', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
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
  const scope = board.locator('.workspace-tab-scope');
  await expect(scope.locator('button')).toHaveCount(2);
  await scope.getByRole('button', { name: '窗口 2', exact: true }).click();
  await expect(board.locator('.workspace-open-tab strong')).toHaveText([
    'OtherWindow',
  ]);
  const third = await page.evaluate(() =>
    chrome.windows.create({ url: 'about:blank', focused: false }),
  );
  await expect(scope.locator('button')).toHaveCount(3);
  await scope.getByRole('button', { name: '窗口 3', exact: true }).click();
  await page.evaluate((id) => chrome.windows.remove(id), third.id);
  await expect(scope.locator('button')).toHaveCount(2);
  await expect(
    scope.getByRole('button', { name: '窗口 1（当前）' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await scope.getByRole('button', { name: '窗口 2', exact: true }).click();
  await page.evaluate((id) => chrome.windows.remove(id), remote.id);
  await expect(scope.locator('button')).toHaveCount(1);
  const nativeGroup = await page.evaluate(
    async (ids) => {
      const id = await chrome.tabs.group({ tabIds: ids });
      await chrome.tabGroups.update(id, { title: '项目调研', color: 'blue' });
      return id;
    },
    [tabs[0].id, tabs[2].id],
  );
  const grouped = board.locator(`[data-group-id="${nativeGroup}"]`);
  await expect(grouped.locator('.workspace-open-tab')).toHaveCount(2);
  const beforeMemberOrder = await page.evaluate(
    async (id) =>
      (await chrome.tabs.query({ groupId: id }))
        .sort((a, b) => a.index - b.index)
        .map((tab) => tab.id),
    nativeGroup,
  );
  const memberSource = grouped.locator(
    `[data-browser-tab-id="${beforeMemberOrder[0]}"]`,
  );
  const memberTarget = grouped.locator(
    `[data-browser-tab-id="${beforeMemberOrder[1]}"]`,
  );
  const memberBounds = await memberSource.boundingBox();
  await page.mouse.move(
    memberBounds.x + 60,
    memberBounds.y + memberBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    memberBounds.x + 75,
    memberBounds.y + memberBounds.height / 2,
    { steps: 5 },
  );
  await expect(memberSource).toHaveClass(/is-drag-source/);
  await expect(grouped).not.toHaveClass(/is-drag-source/);
  await page.waitForTimeout(220);
  const memberTargetBounds = await memberTarget.boundingBox();
  await page.mouse.move(
    memberTargetBounds.x + 60,
    memberTargetBounds.y + memberTargetBounds.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(board.locator('.drag-landing-preview')).toHaveCount(0);

  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await chrome.tabs.query({ groupId: id }))
            .sort((a, b) => a.index - b.index)
            .map((tab) => tab.id),
        nativeGroup,
      ),
    )
    .toEqual([...beforeMemberOrder].reverse());
  const sortingPage = await context.newPage();
  await sortingPage.goto('https://example.com/workspace-fixture/SortGroup');
  const sortingGroup = await page.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      url: 'https://example.com/workspace-fixture/SortGroup',
    });
    const id = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(id, { title: '排序测试', color: 'red' });
    return id;
  });
  await page.bringToFront();
  const sortingSection = board.locator(`[data-group-id="${sortingGroup}"]`);
  await sortingSection
    .getByRole('button', { name: '拖动群组 排序测试' })
    .dragTo(grouped, { targetPosition: { x: 40, y: 5 } });
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        async ([a, b]) => {
          const first = await chrome.tabs.query({ groupId: a });
          const second = await chrome.tabs.query({ groupId: b });
          return (
            Math.max(...first.map((t) => t.index)) <
            Math.min(...second.map((t) => t.index))
          );
        },
        [sortingGroup, nativeGroup],
      ),
    )
    .toBe(true);
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await page.waitForTimeout(250);
  const targetHeight = (await grouped.boundingBox()).height;
  await sortingSection
    .getByRole('button', { name: '拖动群组 排序测试' })
    .dragTo(grouped, { targetPosition: { x: 40, y: targetHeight - 4 } });
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        async ([a, b]) => {
          const first = await chrome.tabs.query({ groupId: a });
          const second = await chrome.tabs.query({ groupId: b });
          return (
            Math.min(...first.map((t) => t.index)) >
            Math.max(...second.map((t) => t.index))
          );
        },
        [sortingGroup, nativeGroup],
      ),
    )
    .toBe(true);
  const loosePages = [];
  for (const name of ['LooseA', 'LooseB']) {
    const fixture = await context.newPage();
    await fixture.goto(`https://example.com/workspace-fixture/${name}`);
    loosePages.push(fixture);
  }
  await page.bringToFront();
  const looseTabs = await page.evaluate(async () => {
    const all = await chrome.tabs.query({});
    return ['LooseA', 'LooseB'].map((name) =>
      all.find((t) => t.url?.endsWith('/' + name)),
    );
  });
  const looseRow = board.locator(`[data-browser-tab-id="${looseTabs[0].id}"]`);
  await expect(looseRow).toBeVisible();
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await page.waitForTimeout(250);
  await sortingSection
    .getByRole('button', { name: '拖动群组 排序测试' })
    .dragTo(looseRow, { targetPosition: { x: 40, y: 28 } });
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        async ([groupId, a, b]) => {
          const group = await chrome.tabs.query({ groupId });
          const left = await chrome.tabs.get(a),
            right = await chrome.tabs.get(b);
          return (
            left.index < group[0].index && group.at(-1).index < right.index
          );
        },
        [sortingGroup, looseTabs[0].id, looseTabs[1].id],
      ),
    )
    .toBe(true);
  const visualOrder = await board
    .locator('.workspace-open-tab')
    .evaluateAll((els) => els.map((el) => Number(el.dataset.browserTabId)));
  assert.ok(
    visualOrder.indexOf(looseTabs[0].id) < visualOrder.indexOf(looseTabs[1].id),
  );
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await page.waitForTimeout(250);
  const lastLooseRow = board.locator(
    `[data-browser-tab-id="${looseTabs[1].id}"]`,
  );
  await sortingSection
    .getByRole('button', { name: '拖动群组 排序测试' })
    .dragTo(lastLooseRow, { targetPosition: { x: 40, y: 28 } });
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        async ([groupId, id]) => {
          const group = await chrome.tabs.query({ groupId });
          return group[0].index > (await chrome.tabs.get(id)).index;
        },
        [sortingGroup, looseTabs[1].id],
      ),
    )
    .toBe(true);
  for (const fixture of loosePages) await fixture.close();
  await sortingPage.close();
  await expect(sortingSection).toHaveCount(0);

  await expect(grouped).toHaveAttribute('data-group-color', 'blue');
  await expect(grouped.locator('.workspace-window-label')).toContainText(
    '项目调研',
  );
  await expect(grouped.locator('.workspace-open-tab')).toHaveCount(2);
  await grouped
    .getByRole('button', { name: '折叠群组 项目调研', exact: true })
    .click();
  await expect(grouped.locator('.workspace-open-tab')).toHaveCount(0);
  assert.equal(
    (await page.evaluate((id) => chrome.tabGroups.get(id), nativeGroup))
      .collapsed,
    true,
  );
  await page.evaluate(
    (id) => chrome.tabGroups.update(id, { collapsed: false }),
    nativeGroup,
  );
  await expect(grouped.locator('.workspace-open-tab')).toHaveCount(2);
  await page.evaluate(
    (id) => chrome.tabGroups.update(id, { collapsed: true }),
    nativeGroup,
  );
  await expect(grouped.locator('.workspace-open-tab')).toHaveCount(0);
  await grouped
    .getByRole('button', { name: '保存群组 项目调研 为集合', exact: true })
    .click();
  const savedNativeGroup = board.locator('.workspace-collection').filter({
    has: page.getByRole('button', { name: '重命名 项目调研', exact: true }),
  });
  await expect(
    savedNativeGroup.locator('.workspace-saved-tab strong'),
  ).toHaveText(['Gamma', 'Alpha']);
  await savedNativeGroup
    .getByRole('button', { name: '删除集合 项目调研', exact: true })
    .click();
  await board.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(savedNativeGroup).toHaveCount(0);
  await grouped
    .getByRole('button', { name: '折叠群组 项目调研', exact: true })
    .click();
  await expect(grouped.locator('.workspace-open-tab')).toHaveCount(2);

  await page.evaluate(
    (id) => chrome.tabGroups.update(id, { title: '参考资料', color: 'green' }),
    nativeGroup,
  );
  await expect(grouped).toHaveAttribute('data-group-color', 'green');
  await expect(grouped.locator('.workspace-window-label')).toContainText(
    '参考资料',
  );
  await page.evaluate(
    (ids) => chrome.tabs.ungroup(ids),
    [tabs[0].id, tabs[2].id],
  );
  await expect(grouped).toHaveCount(0);
  const checkAlpha = board.getByRole('checkbox', {
    name: '选择打开的标签页 Alpha',
    exact: true,
  });
  const checkGamma = board.getByRole('checkbox', {
    name: '选择打开的标签页 Gamma',
    exact: true,
  });
  await checkAlpha.check();
  await checkGamma.check();
  const batch = board.getByLabel('所选浏览器标签页操作');
  await expect(batch).toContainText('已选择 2 项');
  await batch.getByRole('button', { name: '新建群组', exact: true }).click();
  await expect(batch).toHaveCount(0);
  await expect(
    board.locator('.workspace-window-label').filter({ hasText: '群组01' }),
  ).toBeVisible();
  const actualGrouped = await page.evaluate(
    (ids) => Promise.all(ids.map((id) => chrome.tabs.get(id))),
    [tabs[0].id, tabs[2].id],
  );
  assert.equal(actualGrouped[0].groupId, actualGrouped[1].groupId);
  assert.notEqual(actualGrouped[0].groupId, -1);
  await checkAlpha.check();
  await checkGamma.check();
  await batch.getByRole('button', { name: '取消群组', exact: true }).click();
  await expect(
    board.locator('.workspace-window-label').filter({ hasText: '群组01' }),
  ).toHaveCount(0);
  const closing = [];
  for (const name of ['CloseOne', 'CloseTwo']) {
    const fixture = await context.newPage();
    await fixture.goto(`https://example.com/workspace-fixture/${name}`);
    closing.push(fixture);
  }
  await page.bringToFront();
  await board
    .getByRole('checkbox', { name: '选择打开的标签页 CloseOne', exact: true })
    .check();
  await board
    .getByRole('checkbox', { name: '选择打开的标签页 CloseTwo', exact: true })
    .check();
  await batch.getByRole('button', { name: '删除所选', exact: true }).click();
  await expect.poll(() => closing.every((p) => p.isClosed())).toBe(true);
  await expect(batch).toHaveCount(0);
  await expect(checkAlpha).toBeVisible();
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
  await board.getByRole('button', { name: '＋ 新建空间', exact: true }).click();
  await board
    .getByRole('textbox', { name: '空间名称', exact: true })
    .fill('工作项目');
  await board.getByRole('button', { name: '保存空间', exact: true }).click();
  await expect(board.locator('h1')).toHaveText('工作项目');
  await expect(board.locator('.workspace-collection')).toHaveCount(0);
  await create('项目会话');
  await alphaTab.dragTo(board.locator('.workspace-collection').first());
  await expect(page.locator('.drag-landing-preview')).toHaveCount(0);
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(1);
  await board.getByRole('button', { name: '重命名空间', exact: true }).click();
  await board
    .getByRole('textbox', { name: '空间名称', exact: true })
    .fill('开发空间');
  await board.getByRole('button', { name: '保存空间', exact: true }).click();
  await expect(board.locator('h1')).toHaveText('开发空间');
  await page.reload();
  await page.locator('.clock-time').waitFor();
  await page.mouse.click(1000, 450);
  await expect(board.locator('h1')).toHaveText('开发空间');
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(1);
  await board
    .locator('.workspace-space')
    .filter({ hasText: '个人空间' })
    .click();
  await expect(
    board.getByRole('button', { name: '重命名 项目资料', exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole('button', { name: '重命名 项目会话', exact: true }),
  ).toHaveCount(0);
  await board
    .locator('.workspace-space')
    .filter({ hasText: '开发空间' })
    .click();
  await board
    .getByRole('button', { name: '标记收藏 Alpha', exact: true })
    .click();
  await expect(
    board.getByRole('button', { name: '标记收藏 Alpha', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await board.locator('.workspace-space').filter({ hasText: '标记' }).click();
  await expect(board.locator('h1')).toHaveText('标记');
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(3);
  await expect(board.locator('.workspace-collection-name')).toContainText([
    '个人空间 / 项目资料',
    '开发空间 / 项目会话',
  ]);
  await expect(
    board.getByRole('button', { name: '删除空间', exact: true }),
  ).toHaveCount(0);
  await expect(
    board.getByRole('button', { name: '＋ 新建集合', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.locator('.clock-time').waitFor();
  await page.mouse.click(1000, 450);
  await expect(board.locator('h1')).toHaveText('标记');
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(3);
  const markedProject = board
    .locator('.workspace-collection')
    .filter({ hasText: '开发空间 / 项目会话' });
  await markedProject
    .getByRole('button', { name: '标记收藏 Alpha', exact: true })
    .click();
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(2);
  await board
    .locator('.workspace-space')
    .filter({ hasText: '开发空间' })
    .click();
  await expect(board.locator('.workspace-saved-tab')).toHaveCount(1);
  await expect(
    board.getByRole('button', { name: '标记收藏 Alpha', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await board.getByRole('button', { name: '删除空间', exact: true }).click();
  await board
    .getByRole('button', { name: '确认删除空间', exact: true })
    .click();
  await expect(board.locator('h1')).toHaveText('个人空间');
  await expect(
    board.getByRole('button', { name: '重命名 项目会话', exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole('button', { name: '删除空间', exact: true }),
  ).toBeDisabled();
  const dockGrid = board.locator('.dock-icon-grid');
  await expect(dockGrid.locator('[data-link-id]')).toHaveCount(5);
  const homeBox = await dockGrid.locator('[data-link-id="home"]').boundingBox();
  const canvasBox = await dockGrid
    .locator('[data-link-id="canvas"]')
    .boundingBox();
  await page.mouse.move(homeBox.x + homeBox.width / 2, homeBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + 18, {
    steps: 12,
  });
  await expect(board).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(() =>
      dockGrid
        .locator('[data-link-id]')
        .evaluateAll((items) => items.map((item) => item.dataset.linkId)),
    )
    .toEqual(['library', 'memo', 'translate', 'canvas', 'home']);
  await page.reload();
  await page.locator('.clock-time').waitFor();
  await page.mouse.click(1000, 450);
  await expect
    .poll(() =>
      dockGrid
        .locator('[data-link-id]')
        .evaluateAll((items) => items.map((item) => item.dataset.linkId)),
    )
    .toEqual(['library', 'memo', 'translate', 'canvas', 'home']);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: 'work/workspace-collections-mobile.png' });
  const dock = board.getByRole('navigation', { name: '工作区快捷入口' });
  await expect(
    dock.getByRole('link', { name: '翻译', exact: true }),
  ).toHaveAttribute('href', 'https://fanyi.baidu.com/');
  await dock.getByRole('button', { name: '笔记', exact: true }).click();
  await expect(board.getByRole('status')).toContainText('笔记功能即将上线');
  await dock.getByRole('button', { name: '首页', exact: true }).click();
  await expect(page.locator('.workspace-overlay')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.mouse.click(1000, 450);
  await dock.getByRole('button', { name: '收藏库', exact: true }).click();
  await expect(page.locator('.library-board')).toBeVisible();
  await expect(board).toHaveCount(0);
  await expect(page.locator('html')).toHaveClass(/workspace-active/);
  await page.keyboard.press('Escape');

  await expect(page.locator('.workspace-overlay')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS real browser tabs, drag save/dedup, cross-collection move/order, collection reorder/rename/delete/undo, search, multi-selection, favorite persistence, copy, edit validation, open all, reload persistence, live cross-page updates, windows, activate, responsive layout',
  );
} finally {
  await context.close();
}
