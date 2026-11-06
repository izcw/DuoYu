import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reviewBusinessCrud } from './business-crud.mjs';

export async function reviewBusinessPages({
  context,
  origin,
  assetOrigin,
  syncPool,
  account,
  evidence,
}) {
  const page = await context.newPage();
  const directory = path.join(evidence, 'business-pages');
  await mkdir(directory);
  const results = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pages = [
    ['/', '概览'],
    ['/users', '用户管理'],
    [`/users/${account}`, '用户管理'],
    [`/users/${account}/settings`, '用户管理'],
    ['/templates', '模板管理'],
    ['/templates/new', '模板管理'],
    ['/widgets', '组件管理'],
    ['/widgets/new', '组件管理'],
    ['/wallpapers', '壁纸管理'],
    ['/wallpapers/new', '壁纸管理'],
    ['/backups', '同步与备份'],
    ['/settings', '存储设置'],
    ['/audit', '操作记录'],
  ];
  try {
    await page.goto(origin);
    await page
      .getByRole('link', { name: '登录 DuoYu ID', exact: true })
      .click();
    await expect(page.locator('#legal-accept')).not.toBeChecked();
    await page.locator('#legal-accept').check();
    await page.locator('#continue').click();
    await page.waitForURL(origin + '/');
    await expect(
      page.getByRole('heading', { name: '概览', exact: true }),
    ).toBeVisible();
    console.log(
      'PASS real OIDC backend administrator login and encrypted session',
    );
    const me = origin + '/api/admin/me';
    await page.route(me, route => route.fulfill({status: 503, body: 'gateway unavailable'}), {times: 1});
    await page.goto(origin + '/users');
    await expect(page.getByRole('alert')).toContainText('503');
    await expect(page.getByRole('link', { name: '登录 DuoYu ID' })).toHaveCount(0);
    await page.getByRole('button', {name: '重试'}).click();
    await expect(page.getByRole('heading', {name: '用户管理', exact: true})).toBeVisible();
    assert.equal(new URL(page.url()).pathname, '/users');
    results.push({name:'Temporary session error retries on original page', passed:true});
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [route, title] of pages) {
        await page.goto(origin + route);
        await expect(page.locator('h1')).toContainText(title);
        await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
        await expect(page.locator('.el-alert--error:visible')).toHaveCount(0);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `${route} overflow at ${width}`,
        );
        await expect(page.locator('.mobile-menu-open')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.screenshot({
          path: path.join(
            directory,
            (route.replaceAll('/', '_') || 'home') + '-' + width + '.png',
          ),
          fullPage: true,
          animations: 'disabled',
        });
        results.push({ route, width, passed: true });
      }
      console.log(
        `PASS business management ${pages.length} pages at ${width}px`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/admin/users/${account}/settings`) &&
          response.ok(),
      ),
      page.goto(origin + `/users/${account}/settings`),
    ]);
    const quota = page.getByRole('spinbutton');
    await expect(quota).toBeDisabled();
    await page.getByText('单独设置', { exact: true }).click();
    await quota.fill('0');
    await quota.blur();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await syncPool.query(
              'SELECT quota_bytes::text FROM backend_users WHERE account_id=$1',
              [account],
            )
          ).rows[0].quota_bytes,
      )
      .toBe('0');
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().includes(`/api/admin/users/${account}/settings`) &&
          response.ok(),
      ),
      page.goto(origin + `/users/${account}/settings`),
    ]);
    await expect(quota).toHaveValue('0');
    await page.getByText('跟随默认', { exact: true }).click();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await syncPool.query(
              'SELECT quota_bytes FROM backend_users WHERE account_id=$1',
              [account],
            )
          ).rows[0].quota_bytes,
      )
      .toBe(null);
    // Exercise the HTTP CSRF gate with an authenticated cookie and no token.
    assert.equal(
      await page.evaluate(
        async () =>
          (
            await fetch('/api/admin/settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ quota_mb: 1 }),
            })
          ).status,
      ),
      403,
    );
    console.log(
      'PASS real zero-quota save/reload, inherited-quota restore and CSRF rejection',
    );
    await reviewBusinessCrud({
      page,
      origin,
      assetOrigin,
      syncPool,
      account,
      results,
    });
    // Exercise queue admission and UI feedback without executing a backup.
    // This dedicated connection holds the same worker lock as runJob.
    const workerGuard = await syncPool.connect();
    try {
      await workerGuard.query('SELECT pg_advisory_lock(52615261)');
      await page.goto(origin + '/backups');
      await page.getByRole('tab', { name: '系统备份', exact: true }).click();
      const submitJob = async (label) => {
        const response = page.waitForResponse(
          (res) =>
            res.url().endsWith('/api/admin/jobs') &&
            res.request().method() === 'POST',
        );
        await page.getByRole('button', { name: label, exact: true }).click();
        return (await response).status();
      };
      assert.equal(await submitJob('创建全量备份'), 202);
      await expect(page.getByText('任务已排队', { exact: true })).toBeVisible();
      assert.equal(await submitJob('创建全量备份'), 409);
      await expect(page.locator('.el-message--error').last()).toContainText(
        '同类任务正在运行',
      );
      await workerGuard.query(`CREATE FUNCTION reject_queue_ui() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'isolated admission failure'; END $$;
        CREATE TRIGGER reject_queue_ui BEFORE INSERT ON backend_jobs FOR EACH ROW EXECUTE FUNCTION reject_queue_ui()`);
      assert.equal(await submitJob('创建增量备份'), 500);
      await workerGuard.query('DROP TRIGGER reject_queue_ui ON backend_jobs');
      assert.equal(await submitJob('创建增量备份'), 202);
      assert.deepEqual(
        (
          await workerGuard.query(
            'SELECT kind,status FROM backend_jobs ORDER BY kind',
          )
        ).rows,
        [
          { kind: 'backup-full', status: 'queued' },
          { kind: 'backup-incremental', status: 'queued' },
        ],
      );
      results.push({
        flow: 'Backup queue, duplicate feedback and retry after database failure',
        passed: true,
      });
      console.log(
        'PASS actual backup management UI admission, duplicate rejection and retry after database failure',
      );
    } finally {
      try {
        await workerGuard.query(
          "DELETE FROM backend_jobs WHERE kind IN ('backup-full','backup-incremental')",
        );
      } finally {
        await workerGuard.query('SELECT pg_advisory_unlock(52615261)');
        workerGuard.release();
      }
    }
    // Exercise the real UI against a database write failure, not a mocked HTTP response.
    await page.goto(origin + '/');
    await expect(
      page.getByRole('button', { name: '管理员账号菜单' }),
    ).toBeVisible();
    const oldCookie = (await context.cookies(origin)).find(
      (c) => c.name === 'duoyu_admin',
    );
    assert.ok(oldCookie);
    await syncPool.query(`CREATE FUNCTION reject_browser_logout() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'isolated logout deletion failure'; END $$;
      CREATE TRIGGER reject_browser_logout BEFORE DELETE ON backend_sessions
      FOR EACH ROW EXECUTE FUNCTION reject_browser_logout();`);
    const logout = async () => {
      await page.getByRole('button', { name: '管理员账号菜单' }).click();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith('/auth/logout') && r.request().method() === 'POST',
      );
      await page
        .getByRole('menuitem', { name: '退出管理系统', exact: true })
        .click();
      return await response;
    };
    try {
      assert.equal((await logout()).status(), 500);
      await expect(page.locator('.el-message--error')).toContainText(
        '退出失败',
      );
      await expect(
        page.getByRole('button', { name: '管理员账号菜单' }),
      ).toBeVisible();
      assert.equal(
        (await context.cookies(origin)).find((c) => c.name === 'duoyu_admin')
          ?.value,
        oldCookie.value,
      );
      assert.equal(
        await page.evaluate(async () => (await fetch('/api/admin/me')).status),
        200,
      );
    } finally {
      await syncPool.query(
        'DROP TRIGGER IF EXISTS reject_browser_logout ON backend_sessions; DROP FUNCTION IF EXISTS reject_browser_logout();',
      );
    }
    assert.equal((await logout()).status(), 200);
    await expect(
      page.getByRole('link', { name: '登录 DuoYu ID', exact: true }),
    ).toBeVisible();
    assert.equal(
      (await context.cookies(origin)).some((c) => c.name === 'duoyu_admin'),
      false,
    );
    assert.equal(
      (
        await context.request.get(origin + '/api/admin/me', {
          // This fixture uses an isolated loopback certificate, like the browser context.
          ignoreHTTPSErrors: true,
          headers: { Cookie: 'duoyu_admin=' + oldCookie.value },
        })
      ).status(),
      401,
    );
    results.push({
      flow: 'real logout database failure, UI retry, durable session deletion and old cookie rejection',
      passed: true,
    });
    console.log(
      'PASS actual logout DB failure feedback, retry and old-cookie rejection',
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({
      path: path.join(directory, 'failure.png'),
      fullPage: true,
    });
    await writeFile(
      path.join(directory, 'failure.txt'),
      await page.locator('body').innerText(),
    );
    throw error;
  } finally {
    await writeFile(
      path.join(directory, 'results.json'),
      JSON.stringify({ results, errors }, null, 2),
    );
    await page.close();
  }
}
