import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import path from 'node:path';

export async function reviewIdentityProjects({
  page,
  origin,
  db,
  userId,
  results,
  evidence,
}) {
  const navigate = async (route, heading) => {
    await page.goto(origin + '/#/' + route);
    // A hash-only goto can observe the departing page during its transition.
    // Reload to establish a fresh document before asserting editable data.
    await page.reload();
    await expect(page.locator('.dy-page h1')).toHaveText(heading);
    await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
    await expect(page.locator('.dy-error:visible')).toHaveCount(0);
  };
  const submit = async (endpoint, method, button) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(endpoint) && r.request().method() === method,
      ),
      page.getByRole('button', { name: button, exact: true }).click(),
    ]);
    assert.ok(response.ok(), `Management write returned ${response.status()}`);
    return (await response.json()).data;
  };
  const projectName = '隔离项目配置回归';
  await navigate('manage/apps/edit', '创建项目');
  await page.getByPlaceholder('输入便于识别的名称').fill(projectName);
  await page.getByRole('radio', { name: '公共客户端', exact: true }).click();
  await page
    .getByPlaceholder('https://app.example.com/auth/callback', { exact: true })
    .fill(origin + '/fixture-callback');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    context.fillStyle = '#444444';
    context.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const [upload] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/project-logos') &&
        r.request().method() === 'POST',
    ),
    page.locator('.dy-logo-editor input[type=file]').setInputFiles({
      name: 'isolated-logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    }),
  ]);
  assert.ok(upload.ok());
  await expect(
    page.getByRole('button', { name: '替换 Logo', exact: true }),
  ).toBeEnabled();
  const created = await submit('/api/admin/apps', 'POST', '创建');
  const app = created.id;
  assert.ok(app);
  await page.waitForURL(origin + '/#/manage/apps');
  const project = async () =>
    (
      await db.query(
        'SELECT name,logo,public,platform,restricted,enabled,refresh_enabled,persistent_login FROM apps WHERE id=$1',
        [app],
      )
    ).rows[0];
  assert.equal((await project()).public, true);
  assert.equal((await project()).platform, 'spa');
  assert.match((await project()).logo, /^\/project-logos\//);
  await navigate('manage/apps/edit?id=' + app, '编辑项目');
  await expect(
    page.getByRole('radio', { name: '公共客户端', exact: true }),
  ).toBeDisabled();
  await page
    .getByPlaceholder('输入便于识别的名称')
    .fill(projectName + '已更新');
  await page
    .locator('.dy-listitem')
    .filter({ hasText: '限制准入' })
    .locator('.el-switch')
    .click();
  const persistent = page.getByRole('switch', { name: '长期登录' });
  await expect(persistent).toBeDisabled();
  await page.getByRole('switch', { name: '允许会话续期' }).press('Space');
  await persistent.press('Space');
  await submit('/api/admin/apps/' + app, 'PUT', '保存修改');
  await page.waitForURL(origin + '/#/manage/apps');
  assert.equal((await project()).restricted, true);
  assert.equal((await project()).persistent_login, true);
  await navigate('manage/apps/edit?id=' + app, '编辑项目');
  await expect(persistent).toBeChecked();
  const endpoint = '/api/admin/apps/' + app;
  const legacySave = async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const payload = route.request().postDataJSON();
    delete payload.persistent_login;
    await route.continue({ postData: JSON.stringify(payload) });
  };
  await page.route('**' + endpoint, legacySave);
  try {
    await page
      .getByPlaceholder('输入便于识别的名称')
      .fill(projectName + '兼容更新');
    await submit(endpoint, 'PUT', '保存修改');
    await page.waitForURL(origin + '/#/manage/apps');
    assert.equal(
      (await project()).persistent_login,
      true,
      'Older editor must preserve the saved login policy',
    );
  } finally {
    await page.unroute('**' + endpoint, legacySave);
  }
  await navigate('manage/apps/edit?id=' + app, '编辑项目');
  await persistent.press('Space');
  await page
    .getByPlaceholder('输入便于识别的名称')
    .fill(projectName + '已更新');
  await submit(endpoint, 'PUT', '保存修改');
  await page.waitForURL(origin + '/#/manage/apps');
  assert.equal((await project()).persistent_login, false);
  for (const [label, section] of [
    ['角色配置', 'roles'],
    ['准入名单', 'grants'],
    ['黑名单', 'blacklist'],
    ['登录用户', 'members'],
  ]) {
    await navigate('manage/apps/edit?id=' + app, '编辑项目');
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForURL(origin + '/#/manage/apps/' + section + '?id=' + app);
    await expect(page.locator('.dy-error:visible')).toHaveCount(0);
  }
  const email = (
    await db.query('SELECT email FROM users WHERE id=$1', [userId])
  ).rows[0].email;
  await navigate('manage/apps/grants?id=' + app, '项目准入名单');
  await page.locator('textarea').fill(email + '\n' + email);
  await submit('/api/admin/apps/' + app + '/grants', 'PUT', '保存名单');
  await page.waitForURL(origin + '/#/manage/apps');
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM grants WHERE app_id=$1 AND user_id=$2',
        [app, userId],
      )
    ).rows[0].n,
    1,
  );
  await navigate('manage/apps/grants?id=' + app, '项目准入名单');
  await expect(page.locator('textarea')).toHaveValue(email);
  await page.locator('textarea').fill('');
  await submit('/api/admin/apps/' + app + '/grants', 'PUT', '保存名单');
  await page.waitForURL(origin + '/#/manage/apps');
  assert.equal(
    (
      await db.query('SELECT count(*)::int n FROM grants WHERE app_id=$1', [
        app,
      ])
    ).rows[0].n,
    0,
  );
  await navigate('manage/apps/blacklist?id=' + app, '项目黑名单');
  await page.locator('textarea').fill('unregistered-fixture@example.invalid');
  await submit('/api/admin/apps/' + app + '/blacklist', 'PUT', '保存名单');
  await page.waitForURL(origin + '/#/manage/apps');
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app_blacklist WHERE app_id=$1',
        [app],
      )
    ).rows[0].n,
    1,
  );
  await navigate('manage/apps/blacklist?id=' + app, '项目黑名单');
  await expect(page.locator('textarea')).toHaveValue(
    'unregistered-fixture@example.invalid',
  );
  await page.locator('textarea').fill('');
  await submit('/api/admin/apps/' + app + '/blacklist', 'PUT', '保存名单');
  await page.waitForURL(origin + '/#/manage/apps');
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int n FROM app_blacklist WHERE app_id=$1',
        [app],
      )
    ).rows[0].n,
    0,
  );
  results.push({
    flow: 'project local logo/create/edit/immutable client type/restricted grants dedup+clear/unregistered blacklist save+clear',
    passed: true,
  });
  console.log(
    'PASS real project configuration, logo upload, grants and blacklist persistence',
  );

  const keyName = '隔离开发者凭证';
  await navigate('manage/project-api/new', '创建开发者凭证');
  await page.getByPlaceholder('例如：本地项目接入 AI').fill(keyName);
  await page.locator('.dy-panel .el-select__wrapper').click();
  await page
    .getByRole('option', { name: projectName + '已更新', exact: true })
    .click();
  await page.keyboard.press('Escape');
  const key = await submit('/api/admin/developer-keys', 'POST', '创建凭证');
  let token = key.secret;
  assert.ok(token);
  const http = async () =>
    fetch(origin + '/api/management/projects/' + app, {
      headers: { Authorization: 'Bearer ' + token },
    });
  assert.equal((await http()).status, 200);
  const rpc = async (method, params = {}) => {
    const response = await fetch(origin + '/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  };
  assert.equal(
    (
      await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'isolated-review', version: '1' },
      })
    ).serverInfo.name,
    'duoyu-id',
  );
  assert.ok(
    (await rpc('tools/list')).tools.some(
      (tool) => tool.name === 'update_project',
    ),
  );
  await page
    .getByRole('button', { name: '已保存，返回列表', exact: true })
    .click();
  await page.waitForURL(origin + '/#/manage/project-api');
  await navigate('manage/project-api/edit?id=' + key.id, '编辑开发者凭证');
  await page
    .locator('label.el-checkbox')
    .filter({ hasText: '修改项目及角色/准入' })
    .click();
  await submit('/api/admin/developer-keys/' + key.id, 'PUT', '保存修改');
  await page.waitForURL(origin + '/#/manage/project-api');
  assert.equal(
    (await rpc('tools/list')).tools.some(
      (tool) => tool.name === 'update_project',
    ),
    false,
  );
  assert.equal(
    (await http()).status,
    200,
    'Read scope remains available after removing update',
  );
  const row = page.locator('.el-table__row').filter({ hasText: keyName });
  await row.getByRole('button', { name: '轮换', exact: true }).click();
  const [rotated] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/developer-keys/' + key.id + '/rotate') &&
        r.request().method() === 'POST',
    ),
    page
      .getByRole('dialog', { name: '轮换凭证' })
      .getByRole('button', { name: '确定', exact: true })
      .click(),
  ]);
  assert.ok(rotated.ok());
  assert.equal(
    (await http()).status,
    401,
    'Old developer token must stop working after zero-overlap rotation',
  );
  token = (await rotated.json()).data.secret;
  assert.equal((await http()).status, 200);
  await page
    .getByRole('button', { name: '已保存，返回列表', exact: true })
    .click();
  await row.getByRole('button', { name: '撤销', exact: true }).click();
  await page
    .getByRole('dialog', { name: '撤销凭证' })
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect.poll(async () => (await http()).status).toBe(401);
  await expect(row.getByText('已撤销', { exact: true })).toBeVisible();
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM mail_messages')).rows[0].n,
    0,
  );
  results.push({
    flow: 'developer key create/scoped HTTP+MCP/permission removal/rotation/revocation without email calls',
    passed: true,
  });
  console.log(
    'PASS real scoped developer HTTP/MCP access, immediate permission changes, rotation and revocation',
  );
  await navigate('manage/settings', '邮件与系统设置');
  const registration = async () =>
    (await db.query("SELECT value FROM settings WHERE key='registration'"))
      .rows[0].value;
  const initialRegistration = await registration();
  const toggle = page
    .locator('.dy-listitem')
    .filter({ hasText: '开放注册' })
    .locator('.el-switch');
  for (const expected of [
    initialRegistration === 'true' ? 'false' : 'true',
    initialRegistration,
  ]) {
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/admin/settings') &&
          r.request().method() === 'PUT',
      ),
      toggle.click(),
    ]);
    assert.ok(saved.ok());
    assert.equal(await registration(), expected);
    await expect(
      page.getByRole('switch', { name: '开放注册' }),
    ).toHaveAttribute('aria-checked', expected);
  }
  const previewFrame = page.frameLocator('iframe[title="验证码邮件预览"]');
  await expect(previewFrame.locator('body')).toContainText('123456');
  const previewRoute = '**/api/admin/mail-preview**';
  let interrupted = false;
  const failPreview = async (route) => {
    if (
      !interrupted &&
      new URL(route.request().url()).searchParams.get('purpose') === 'reset'
    ) {
      interrupted = true;
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'fixture unavailable',
      });
    } else await route.continue();
  };
  await page.route(previewRoute, failPreview);
  try {
    await page.locator('.dy-heading .el-select__wrapper').click();
    await page.getByRole('option', { name: '重置密码', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: '模板加载失败' }),
    ).toBeVisible();
    await expect(
      page.locator('iframe[title="验证码邮件预览"]'),
    ).toHaveAttribute('srcdoc', '');
    await page.getByRole('button', { name: '重试预览', exact: true }).click();
    await expect(previewFrame.locator('body')).toContainText('123456');
    await expect(page.locator('.dy-error:visible')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      )
      .toBe(false);
    await page
      .locator('iframe[title="验证码邮件预览"]')
      .scrollIntoViewIfNeeded();
    await expect(
      previewFrame.getByText('123456', { exact: true }),
    ).toBeVisible();
    await page.locator('iframe[title="验证码邮件预览"]').screenshot({
      path: path.join(evidence, 'id-preview-retry-frame.png'),
      animations: 'disabled',
    });
    await page.screenshot({
      path: path.join(evidence, 'id-preview-retry-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  } finally {
    await page.unroute(previewRoute, failPreview);
  }
  assert.equal(
    (await db.query('SELECT count(*)::int n FROM mail_messages')).rows[0].n,
    0,
  );
  results.push({
    flow: 'registration toggle/restore, real sandboxed mail preview, injected503 clear+retry and mobile layout; no SMTP',
    passed: true,
  });
  console.log(
    'PASS isolated registration changes and mail preview failure/retry without sending mail',
  );
}
