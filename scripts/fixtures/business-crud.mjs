import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Called only inside auth-isolated's temporary schema, filesystem and services.
export async function reviewBusinessCrud({
  page,
  origin,
  assetOrigin,
  syncPool,
  account,
  results,
}) {
  const item = (label) =>
    page.locator('.el-form-item').filter({
      has: page.locator('.el-form-item__label', {
        hasText: new RegExp(`^${label}$`),
      }),
    });
  const nameInput = () => item('名称').getByRole('textbox');
  const query = async (name) =>
    (
      await syncPool.query(
        'SELECT id::text,name,status,payload,version::int FROM backend_catalog WHERE name=$1',
        [name],
      )
    ).rows[0];
  const status = async (label) => {
    await item('状态').locator('.el-select__wrapper').click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  const save = async (endpoint) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/admin/' + endpoint) &&
          r.request().method() === 'POST',
      ),
      page.getByRole('button', { name: '保存', exact: true }).click(),
    ]);
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const edit = async (kind, id) => {
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes(`/api/admin/catalog/${kind}/${id}?`) && r.ok(),
      ),
      page.goto(`${origin}/${kind}/${id}`),
    ]);
    await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
  };
  const remove = async (kind, name, id) => {
    await page.goto(`${origin}/${kind}`);
    const row = page
      .locator(kind === 'wallpapers' ? '.wallpaper-card' : '.el-table__row')
      .filter({ hasText: name });
    await row.hover();
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await page
      .getByRole('dialog', { name: '删除资源' })
      .getByRole('button', { name: /确定|确认/ })
      .click();
    await expect
      .poll(
        async () =>
          (
            await syncPool.query(
              'SELECT count(*)::int n FROM backend_catalog WHERE id=$1',
              [id],
            )
          ).rows[0].n,
      )
      .toBe(0);
    await expect(row).toHaveCount(0);
  };

  const widgetName = '隔离回归组件';
  await page.goto(origin + '/widgets/new');
  await nameInput().fill(widgetName);
  await item('说明').getByRole('textbox').fill('真实管理界面创建');
  const endpoint = origin + '/api/admin/catalog/widgets';
  let releaseSave;
  const hold = new Promise((resolve) => {
    releaseSave = resolve;
  });
  let saveStarted;
  const submitted = new Promise((resolve) => {
    saveStarted = resolve;
  });
  await page.route(
    endpoint,
    async (route) => {
      saveStarted();
      await hold;
      await route.continue();
    },
    { times: 1 },
  );
  let creation;
  try {
    creation = save('catalog/widgets');
    await submitted;
    // Changes made after submission would be discarded when save navigates away.
    await expect(nameInput()).toBeDisabled();
  } finally {
    releaseSave();
    if (creation) await creation;
  }
  const { id: widgetId } = await creation;
  await expect
    .poll(async () => (await query(widgetName))?.status)
    .toBe('draft');
  await edit('widgets', widgetId);
  await expect(nameInput()).toHaveValue(widgetName);
  await item('默认尺寸').getByRole('spinbutton').first().fill('4');
  await item('默认尺寸').getByRole('spinbutton').first().blur();
  await status('已发布');
  await save('catalog/widgets/' + widgetId);
  const widget = await query(widgetName);
  assert.equal(widget.status, 'published');
  assert.equal(widget.payload.width, 4);
  assert.equal(widget.version, 2);
  await remove('widgets', widgetName, widgetId);
  results.push({
    flow: 'widget create/edit/publish/delete with database verification',
    passed: true,
  });
  console.log('PASS real widget CRUD and version increment');

  const templateName = '隔离回归模板';
  await page.goto(`${origin}/templates/new?source=${account}`);
  await nameInput().fill(templateName);
  const { id: templateId } = await save('templates/capture');
  await expect
    .poll(async () => (await query(templateName))?.status)
    .toBe('draft');
  const template = await query(templateName);
  assert.equal(template.payload.format, 'duoyu-template');
  assert.equal(template.payload.source_account_id, account);
  assert.ok(
    template.payload.entities.length > 0,
    'Snapshot contains real synchronized entities',
  );
  await edit('templates', templateId);
  await status('已发布');
  await save('catalog/templates/' + templateId);
  assert.deepEqual(
    (await query(templateName)).payload,
    template.payload,
    'Publishing preserves captured data',
  );
  await remove('templates', templateName, templateId);
  results.push({
    flow: 'template capture/publish/delete preserving synchronized snapshot',
    passed: true,
  });
  console.log('PASS real template capture, publication and deletion');

  const wallpaperName = '隔离回归壁纸';
  await page.goto(origin + '/wallpapers/new');
  await nameInput().fill(wallpaperName);
  // Browser-produced valid PNG, uploaded through the actual file input.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#666666';
    ctx.fillRect(0, 0, 32, 18);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const [uploaded] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/catalog-assets') &&
        r.request().method() === 'POST',
    ),
    page.getByLabel('上传壁纸', { exact: true }).setInputFiles({
      name: 'isolated.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    }),
  ]);
  assert.equal(uploaded.status(), 200, await uploaded.text());
  const asset = await uploaded.json();
  const assetURL = new URL(asset.url);
  const publicAsset = assetOrigin + assetURL.pathname;
  await expect(
    page.locator('.wallpaper-large-preview img').first(),
  ).toBeVisible();
  const { id: wallpaperId } = await save('catalog/wallpapers');
  assert.equal((await query(wallpaperName)).payload.url, asset.url);
  assert.equal(
    (await fetch(publicAsset)).status,
    404,
    'Draft asset must not be public',
  );
  await edit('wallpapers', wallpaperId);
  await status('已发布');
  await save('catalog/wallpapers/' + wallpaperId);
  const publicImage = await fetch(publicAsset);
  assert.equal(publicImage.status, 200);
  assert.deepEqual(
    Buffer.from(await publicImage.arrayBuffer()),
    Buffer.from(png, 'base64'),
  );
  const preview = await fetch(publicAsset + '?preview=1');
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /^image\/jpeg/);
  await remove('wallpapers', wallpaperName, wallpaperId);
  assert.equal(
    (await fetch(publicAsset)).status,
    404,
    'Deleted unpublished asset must stop being public',
  );
  results.push({
    flow: 'wallpaper upload/draft privacy/publish/original+preview/delete',
    passed: true,
  });
  console.log(
    'PASS real wallpaper upload, draft privacy, public original/preview and deletion',
  );

  // Delay a real upload across SPA navigation; no document reload may hide the race.
  await page.goto(origin + '/wallpapers/new');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started;
  const received = new Promise((resolve) => {
    started = resolve;
  });
  const pattern = '**/api/admin/catalog-assets';
  let handled;
  const finished = new Promise((resolve) => {
    handled = resolve;
  });
  const interceptionErrors = [];
  const delayedUpload = async (route) => {
    try {
      started();
      await gate;
      await route.continue();
    } catch (error) {
      interceptionErrors.push(error);
    } finally {
      handled();
    }
  };
  await page.route(pattern, delayedUpload);
  try {
    await page.getByLabel('上传壁纸', { exact: true }).setInputFiles({
      name: 'late.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    await received;
    await page.getByRole('menuitem', { name: '组件管理', exact: true }).click();
    await page
      .getByRole('dialog', { name: '离开页面' })
      .getByRole('button', { name: '确定', exact: true })
      .click();
    await page.waitForURL(origin + '/widgets');
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await page.waitForURL(origin + '/widgets/new');
    await nameInput().fill('保留当前组件草稿');
    const completed = page.waitForResponse((r) =>
      r.url().endsWith('/api/admin/catalog-assets'),
    );
    release();
    await completed;
    await expect(nameInput()).toHaveValue('保留当前组件草稿');
    await expect(page.getByText('图片已上传', { exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '壁纸管理', exact: true }).click();
    await page
      .getByRole('dialog', { name: '离开页面' })
      .getByRole('button', { name: '确定', exact: true })
      .click();
    await page.waitForURL(origin + '/wallpapers');
    await page.getByRole('button', { name: '新增', exact: true }).click();
    await expect(page.locator('.wallpaper-large-preview')).toHaveCount(0);
    await expect(page.locator('.wallpaper-upload-empty')).toBeVisible();
  } finally {
    release();
    await finished;
    await page.unroute(pattern, delayedUpload);
  }
  assert.deepEqual(interceptionErrors, []);
  // A missing catalog entry must leave no editable prior data or enabled save action.
  await page.goto(origin + '/wallpapers/' + wallpaperId);
  await expect(page.locator('.el-alert--error')).toBeVisible();
  await expect(nameInput()).toHaveValue('');
  await expect(
    page.getByRole('button', { name: '保存', exact: true }),
  ).toBeDisabled();
  results.push({
    flow: 'late real upload isolated across SPA routes; missing resource disables stale save',
    passed: true,
  });
  console.log(
    'PASS real delayed upload route isolation and missing-resource save prevention',
  );
}
