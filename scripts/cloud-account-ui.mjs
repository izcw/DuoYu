import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import pg from '../../DuoYu-Backend/server/sync/node_modules/pg/lib/index.js';
import {
  createSyncServer,
  accountId,
} from '../../DuoYu-Backend/server/sync/src/http.mjs';
import { applyOperation } from '../../DuoYu-Backend/server/sync/src/store.mjs';
const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 55432,
  user: 'duoyu',
  password: 'duoyu_dev_only',
  database: 'duoyu_sync_test',
});
await pool.query(
  await readFile(
    new URL('../../DuoYu-Backend/server/sync/schema.sql', import.meta.url),
    'utf8',
  ),
);
const profile = {
  issuer: 'https://ui.test',
  sub: randomUUID(),
  name: '同步测试',
  email: 'ui@example.invalid',
  picture: '',
};
const account = { ...profile, id: accountId(profile.issuer, profile.sub) };
const epoch = (
  await pool.query('SELECT epoch::text FROM sync_generation WHERE singleton')
).rows[0].epoch;
const pageData = { id: 'p', name: '测试页', order: 0 };
const item = {
  id: 'i',
  kind: 'link',
  pageId: 'home',
  parent: '',
  name: 'Original title',
  url: 'https://example.com',
  icon:
    'duoyu-icon:' +
    JSON.stringify({
      mode: 'text',
      text: '示例',
      material: 'glass',
      color: '#63adcf',
    }),
  width: 1,
  height: 1,
  gridX: 0,
  gridY: 0,
  order: 0,
};
const operation = (changes) => ({
  id: randomUUID(),
  deviceId: randomUUID(),
  epoch,
  changes,
});
const change = (table, id, base, value, revision = '0') => ({
  table,
  id,
  base,
  value,
  revision,
});
const created = await applyOperation(
  pool,
  account,
  operation([
    change('libraryPages', 'p', null, pageData),
    change('libraryItems', 'i', null, item),
    change('libraryItems', 'folder', null, {
      ...item,
      id: 'folder',
      kind: 'folder',
      name: '常用网站',
      gridX: 2,
      gridY: 0,
      width: 3,
      height: 2,
    }),
    change('libraryItems', 'child', null, {
      ...item,
      id: 'child',
      name: '文件夹图标',
      parent: 'folder',
      gridX: undefined,
      gridY: undefined,
    }),
    change('libraryItems', 'calendar', null, {
      ...item,
      id: 'calendar',
      kind: 'widget',
      widget: 'calendar',
      name: '日历',
      gridX: 6,
      gridY: 0,
      width: 3,
      height: 3,
    }),
    change('libraryItems', 'weather', null, {
      ...item,
      id: 'weather',
      kind: 'widget',
      widget: 'weather',
      name: '天气',
      gridX: 10,
      gridY: 0,
      width: 2,
      height: 2,
    }),
    change('libraryItems', 'note', null, {
      ...item,
      id: 'note',
      kind: 'widget',
      widget: 'note',
      name: '便笺',
      text: '共享桌面组件样式',
      gridX: 2,
      gridY: 2,
      width: 3,
      height: 2,
    }),
  ]),
);
await applyOperation(
  pool,
  account,
  operation([
    change(
      'libraryItems',
      'i',
      item,
      { ...item, name: 'Cloud title', url: 'https://cloud.example.com' },
      created.revision,
    ),
  ]),
);
await applyOperation(
  pool,
  account,
  operation([
    change(
      'libraryItems',
      'i',
      item,
      { ...item, name: 'Local title' },
      created.revision,
    ),
  ]),
);
const origins = [];
const server = createSyncServer({
  pool,
  origins,
  authenticate: async () => account,
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('work', { recursive: true });
const extensionPath = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/cloud-ui-account-')),
  {
    headless: true,
    channel: 'msedge',
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  },
);
try {
  await context.route('https://api.bimg.cc/today*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#668897"/><stop offset="1" stop-color="#b9a791"/></linearGradient></defs><path fill="url(#a)" d="M0 0h1440v900H0z"/></svg>',
    }),
  );
  await context.addInitScript(
    ({ account, origin }) => {
      if (
        location.protocol !== 'chrome-extension:' ||
        !globalThis.chrome?.runtime
      )
        return;
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (message) => {
        if (message.type !== 'duoyu-auth') return original(message);
        if (message.action === 'status') return { view: { account } };
        if (message.action !== 'sync') return { error: 'Test only' };
        const r = await fetch(origin + message.path, {
          method: message.method,
          headers:
            message.method === 'POST'
              ? {
                  'Content-Type': message.binary
                    ? message.mediaType
                    : 'application/json',
                }
              : {},
          body:
            message.method === 'POST'
              ? message.binary
                ? Uint8Array.from(atob(message.body), (c) => c.charCodeAt(0))
                : JSON.stringify(message.body)
              : undefined,
        });
        return { status: r.status, data: await r.json() };
      };
    },
    { account: profile, origin },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  origins.push(`chrome-extension://${id}`);
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await page.locator('.account-entry').waitFor({ timeout: 30000 });
  await page.locator('.account-entry').click();
  await page
    .getByText(/最近同步：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    .waitFor();
  assert.equal(
    await page.getByText('导入本机数据到空账号', { exact: true }).count(),
    0,
  );
  assert.equal(await page.getByText(/导出冲突副本/).count(), 0);
  assert.equal((await pool.query(
    "SELECT 1 FROM sync_entities WHERE account_id=$1 AND entity_type='shortcuts' AND entity_id='wallpaper'",
    [account.id],
  )).rowCount, 0, 'opening a fresh profile must not upload the display defaults');
  const syncButton = page.getByRole('button', { name: '立即同步', exact: true });
  const currentHead = async () => (await pool.query(
    'SELECT head_revision::text AS revision FROM sync_accounts WHERE id=$1', [account.id],
  )).rows[0].revision;
  const previousHead = await currentHead();
  await syncButton.click();
  await expect(syncButton).toBeEnabled();
  const manualHead = await currentHead();
  assert.equal(BigInt(manualHead), BigInt(previousHead) + 1n);
  await expect(page.locator('.account-backups li').first()).toContainText('版本 ' + manualHead);
  console.log('PASS manual sync button adds one cloud backup and refreshes the visible list');
  const previewRevision = (
    await pool.query(
      'SELECT head_revision::text FROM sync_accounts WHERE id=$1',
      [account.id],
    )
  ).rows[0].head_revision;
  await page.getByRole('button', { name: /处理同步更改/ }).click();
  const localPanel = page.locator('.version-panel[data-version="local"]'),
    cloudPanel = page.locator('.version-panel[data-version="cloud"]');
  await localPanel
    .getByRole('heading', { name: '本机版本', exact: true })
    .waitFor();
  await localPanel
    .locator('.tile-caption')
    .filter({ hasText: 'Local title' })
    .waitFor();
  await cloudPanel
    .locator('.tile-caption')
    .filter({ hasText: 'Cloud title' })
    .waitFor();
  assert.equal(await page.getByText('修改前', { exact: true }).count(), 0);
  assert.equal(
    await localPanel.locator('.library-preview [data-kind="folder"]').count(),
    1,
  );
  assert.equal(await localPanel.locator('.cell-widget').count(), 3);
  assert.equal(await localPanel.locator('.folder-cells .cell-icon').count(), 1);
  assert(
    await localPanel.locator('.library-preview').evaluate((el) => el.inert),
  );
  assert.equal(await page.getByLabel('缩放', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('预览页面', { exact: true }).count(), 0);
  const previewBounds = await localPanel
    .locator('.preview-viewport')
    .boundingBox();
  const labelBounds = await localPanel
    .locator('.tile-caption')
    .filter({ hasText: 'Local title' })
    .boundingBox();
  assert(
    labelBounds.y >= previewBounds.y &&
      labelBounds.y < previewBounds.y + previewBounds.height,
    'preview content must be visible inside its viewport',
  );
  await page.screenshot({ path: 'work/cloud-conflict-center.png' });
  assert.equal(
    (
      await pool.query(
        'SELECT head_revision::text FROM sync_accounts WHERE id=$1',
        [account.id],
      )
    ).rows[0].head_revision,
    previewRevision,
    'opening and zooming previews must not commit desktop writes',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'mobile conflict dialog must not overflow the browser',
  );
  assert(
    await page.evaluate(
      () => !!document.elementFromPoint(160, 790)?.closest('.base-dialog'),
    ),
    'the Dock must not cover or intercept the conflict modal',
  );
  await page.screenshot({ path: 'work/cloud-conflict-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '应用本机版本', exact: true }).click();
  await page
    .getByText('没有需要处理的更改。', { exact: true })
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      console.log('UI errors:', await page.locator('.error').allTextContents());
      await page.screenshot({ path: 'work/cloud-account-error.png' });
      throw error;
    });
  assert.equal(
    (
      await pool.query(
        'SELECT payload FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
        [account.id, 'i'],
      )
    ).rows[0].payload.name,
    'Local title',
  );
  const localSaved = (
    await pool.query(
      'SELECT payload,revision::text FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
      [account.id, 'i'],
    )
  ).rows[0];
  assert.equal(
    localSaved.payload.url,
    item.url,
    'whole local version must match the preview, including unchanged local fields',
  );
  await applyOperation(
    pool,
    account,
    operation([
      change(
        'libraryItems',
        'i',
        localSaved.payload,
        { ...localSaved.payload, name: 'Cloud winner' },
        localSaved.revision,
      ),
    ]),
  );
  await applyOperation(
    pool,
    account,
    operation([
      change(
        'libraryItems',
        'i',
        localSaved.payload,
        { ...localSaved.payload, name: 'Local rejected' },
        localSaved.revision,
      ),
    ]),
  );
  await page.getByRole('button', { name: '刷新预览', exact: true }).click();
  await cloudPanel
    .locator('.tile-caption')
    .filter({ hasText: 'Cloud winner' })
    .waitFor();
  await page.getByRole('button', { name: '应用云端版本', exact: true }).click();
  await page.getByText('没有需要处理的更改。', { exact: true }).waitFor();
  assert.equal(
    (
      await pool.query(
        'SELECT payload FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
        [account.id, 'i'],
      )
    ).rows[0].payload.name,
    'Cloud winner',
  );
  const beforeLayout = (
    await pool.query(
      'SELECT payload,revision::text FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
      [account.id, 'i'],
    )
  ).rows[0];
  await applyOperation(
    pool,
    account,
    operation([
      change('libraryItems', 'new-cloud', null, {
        ...item,
        id: 'new-cloud',
        name: '云端新增',
        gridX: 1,
      }),
    ]),
  );
  await applyOperation(
    pool,
    account,
    operation([
      change(
        'libraryItems',
        'i',
        beforeLayout.payload,
        { ...beforeLayout.payload, gridX: 1 },
        beforeLayout.revision,
      ),
    ]),
  );
  await page.getByRole('button', { name: '刷新预览', exact: true }).click();
  await expect(page.getByLabel('冲突菜单')).toBeVisible();
  await localPanel
    .locator('[data-library-id="i"].conflict-highlight')
    .waitFor();
  await page.getByRole('button', { name: '应用本机版本', exact: true }).click();
  await page.getByText('没有需要处理的更改。', { exact: true }).waitFor();
  const placement = (
    await pool.query(
      "SELECT entity_id,payload FROM sync_entities WHERE account_id=$1 AND entity_id IN ('i','new-cloud')",
      [account.id],
    )
  ).rows;
  assert.equal(placement.find((r) => r.entity_id === 'i').payload.gridX, 1);
  assert.equal(
    placement.find((r) => r.entity_id === 'new-cloud').payload.gridX,
    0,
    'displaced cloud tile must move exactly as previewed',
  );
  await page
    .getByRole('dialog', { name: '处理同步更改', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  const backup = {
    format: 'duoyu-backup',
    version: 1,
    tables: {
      libraryPages: [{ id: 'p', name: 'Import page', order: 0 }],
      libraryItems: [
        { ...item, id: 'import', name: 'Imported bookmark', pageId: 'p' },
      ],
    },
  };
  // Delay the actual File.text read across close/reopen. The reopened dialog
  // must not expose an import action for the previous file.
  await page.evaluate(() => {
    const original = File.prototype.text;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    window.__releaseImportRead = () => {
      File.prototype.text = original;
      release();
    };
    File.prototype.text = async function () {
      await gate;
      return original.call(this);
    };
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page
    .getByRole('dialog', { name: '导入JSON文件', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await page.evaluate(() => window.__releaseImportRead());
  await page.waitForTimeout(150);
  assert.equal(
    await page
      .getByRole('button', { name: '导入数据', exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await page.locator('.import-summary').count(), 0);
  await page.locator('input[type=file]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '导入数据', exact: true }).waitFor();
  await page.screenshot({ path: 'work/cloud-json-import.png' });
  await page.getByRole('button', { name: '导入数据', exact: true }).click();
  await page
    .getByText(/导入已保存/)
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      console.log(
        'Import UI errors:',
        await page.locator('.error').allTextContents(),
      );
      await page.screenshot({ path: 'work/cloud-import-error.png' });
      throw error;
    });
  for (let n = 0; n < 40; n++) {
    if (
      (
        await pool.query(
          "SELECT 1 FROM sync_entities WHERE account_id=$1 AND payload->>'name'='Imported bookmark'",
          [account.id],
        )
      ).rowCount
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(
    (
      await pool.query(
        "SELECT 1 FROM sync_entities WHERE account_id=$1 AND payload->>'name'='Imported bookmark'",
        [account.id],
      )
    ).rowCount,
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  const workspacePage = await context.newPage();
  const linkPage = await context.newPage();
  try {
    const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7"/></svg>');
    await linkPage.route('https://workspace.example.invalid/link', route =>
      route.fulfill({ contentType: 'text/html; charset=utf-8',
        body: '<title>Undo fixture</title><link rel="icon" href="' + svg + '">' }));
    await linkPage.goto('https://workspace.example.invalid/link');
    await workspacePage.goto(`chrome-extension://${id}/newtab.html`);
    await expect.poll(() => workspacePage.evaluate(async () =>
      (await chrome.tabs.query({ url: 'https://workspace.example.invalid/link' }))[0]?.favIconUrl,
    )).toMatch(/^data:image\/svg\+xml,/);
    await workspacePage.bringToFront();
    const button = (name) => workspacePage.getByRole('button', { name, exact: true }).first();
    await button('标签工作区').click();
    const list = workspacePage.locator('.workspace-collections');
    await expect(list).toHaveAttribute('aria-busy', 'false');
    const groups = list.locator('[data-collection-id]');
    await expect(groups).toHaveCount(0);
    await list.evaluate(list => {
      const counts = [];
      let frame;
      const sample = () => {
        const count = list.querySelectorAll('[data-collection-id]').length;
        if (count !== counts.at(-1)) counts.push(count);
        frame = requestAnimationFrame(sample);
      };
      sample();
      window.finishCollectionCounts = () => { cancelAnimationFrame(frame); return counts; };
    });
    await workspacePage.getByRole('searchbox', { name: '搜索工作区' }).fill('无匹配结果');
    await button('新建集合').click();
    await expect(groups).toHaveCount(1);
    const collectionId = await groups.first().getAttribute('data-collection-id');
    const deletedOnServer = async (type, key) => (await pool.query(
      'SELECT deleted FROM sync_entities WHERE account_id=$1 AND entity_type=$2 AND entity_id=$3',
      [account.id, type, key],
    )).rows[0]?.deleted;
    const groupDeleted = () => deletedOnServer('tabCollections', collectionId);
    await expect.poll(groupDeleted, { timeout: 15000 }).toBe(false);
    await workspacePage.locator('.workspace-open-tab').filter({ hasText: 'Undo fixture' }).dragTo(groups.first());
    const card = groups.first().locator('[data-saved-id]');
    await expect(card).toHaveCount(1);
    const tabId = await card.getAttribute('data-saved-id');
    const cardDeleted = () => deletedOnServer('savedTabs', tabId);
    await expect.poll(cardDeleted, { timeout: 15000 }).toBe(false);
    await button('更多集合操作').click();
    await button('删除集合').click();
    await button('确认删除').click();
    await expect(groups).toHaveCount(0);
    await expect.poll(groupDeleted, { timeout: 15000 }).toBe(true);
    await expect.poll(cardDeleted).toBe(true);
    await button('撤销删除').click();
    await expect(groups).toHaveCount(1);
    await expect.poll(groupDeleted, { timeout: 15000 }).toBe(false);
    await expect.poll(cardDeleted).toBe(false);
    await expect(card).toHaveAttribute('data-saved-id', tabId);
    assert.deepEqual(await workspacePage.evaluate(() => window.finishCollectionCounts()), [0, 1, 0, 1]);
    await card.hover();
    await button('更多 Undo fixture').click();
    await button('移除收藏 Undo fixture').click();
    await expect.poll(cardDeleted, { timeout: 15000 }).toBe(true);
    await button('撤销删除').click();
    await expect.poll(cardDeleted, { timeout: 15000 }).toBe(false);
    await expect(card).toHaveAttribute('data-saved-id', tabId);
    console.log('PASS synchronized collection and link deletion and undo retain IDs without extra list changes');

    // An older client could store the inline icon directly in the cloud row.
    const readTab = async () => (await pool.query(
      "SELECT payload, revision::text FROM sync_entities WHERE account_id=$1 AND entity_type='savedTabs' AND entity_id=$2",
      [account.id, tabId],
    )).rows[0];
    const oldTab = await readTab();
    const seeded = await applyOperation(pool, account, operation([
      change('savedTabs', tabId, oldTab.payload, { ...oldTab.payload, icon: svg }, oldTab.revision),
    ]));
    assert.equal(seeded.status, 'applied');
    await workspacePage.reload();
    await button('标签工作区').click();
    await expect(card.locator('img[src^="data:image/svg+xml"]')).toHaveCount(1);
    await button('更多集合操作').click();
    await button('删除集合').click();
    await button('确认删除').click();
    await expect.poll(cardDeleted, { timeout: 15000 }).toBe(true);
    await button('撤销删除').click();
    await expect.poll(cardDeleted, { timeout: 15000 }).toBe(false);
    assert.deepEqual((await readTab()).payload, { ...oldTab.payload, icon: svg });

    // Old clients quarantined the entire captured collection on a single inline favicon.
    const group = { id: randomUUID(), name: '旧版收藏', spaceId: 'default', order: 2, updatedAt: 1 };
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF7sAAAAASUVORK5CYII=';
    const hash = createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex');
    let iconPosts = 0;
    server.on('request', req => {
      if (req.method === 'POST' && req.url === '/api/v1/assets/' + hash) iconPosts++;
    });
    const tabs = Array.from({ length: 18 }, (_, i) => ({
      id: randomUUID(), title: '收藏 ' + i, savedAt: 1, url: 'https://workspace.example.invalid/' + i,
      icon: i === 1 ? 'data:image/x-icon;base64,AAABAA==' : i === 0 ? svg : 'data:image/png;base64,' + png,
    }));
    const later = { ...tabs[0], icon: '', position: 0, collectionId: group.id };
    const rejected = await applyOperation(pool, account, operation([
      change('savedTabs', later.id, later, { ...later, starred: true }),
    ]));
    assert.equal(rejected.code, 'deleted_or_missing');
    await workspacePage.evaluate(async ({ group, tabs }) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('duoyu-account-' + localStorage.getItem('duoyu-sync-account'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        const tx = db.transaction('syncConflicts', 'readwrite');
        const id = crypto.randomUUID();
        const createdAt = Date.now() - 60000;
        tx.objectStore('syncConflicts').put({
          id, createdAt, state: 'blocked', reason: '图片格式不支持，请使用PNG、JPEG、WebP或GIF',
          operation: { id, createdAt, rows: { ['tabCollections:' + group.id]: {
            table: 'tabCollections', id: group.id, base: null, value: { ...group, tabs },
          } } },
        });
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, { group, tabs });
    await workspacePage.reload();
    await workspacePage.locator('.account-entry').click();
    await workspacePage.getByRole('button', { name: /处理同步更改/ }).click();
    await expect(workspacePage.locator('.conflict-list')).toContainText('19 项相关更改');
    await workspacePage.getByRole('button', { name: '应用本机版本', exact: true }).click();
    await expect(workspacePage.getByText('没有需要处理的更改。', { exact: true })).toBeVisible();
    const restored = (await pool.query(
      "SELECT payload FROM sync_entities WHERE account_id=$1 AND entity_type='savedTabs' AND payload->>'collectionId'=$2 AND NOT deleted",
      [account.id, group.id],
    )).rows.map(r => r.payload).sort((a, b) => a.position - b.position);
    assert.deepEqual(restored, tabs.map((tab, i) => ({ ...tab, position: i, collectionId: group.id, icon: i < 2 ? '' : 'duoyu-asset:' + hash,
      ...(i === 0 ? { starred: true } : {}) })));
    assert.equal(iconPosts, 1, '16 links sharing a PNG must cause one asset request');
    console.log('PASS applying an old 19-change workspace preview preserves all links, order and subsequent edits');
  } finally {
    if (!linkPage.isClosed()) await linkPage.close();
    await workspacePage.close();
  }
  console.log(
    'PASS real extension UI: shared desktop icon/folder/widgets and wallpaper previews, full local/cloud selection, JSON import and PostgreSQL persistence',
  );
} finally {
  await context.close();
  await new Promise((r) => server.close(r));
  for (const table of [
    'sync_user_backups',
    'sync_assets',
    'sync_asset_deletions',
    'sync_conflicts',
    'sync_receipts',
    'sync_changes',
    'sync_entities',
  ])
    await pool.query('DELETE FROM ' + table + ' WHERE account_id=$1', [
      account.id,
    ]);
  await pool.query('DELETE FROM sync_accounts WHERE id=$1', [account.id]);
  await pool.end();
}
