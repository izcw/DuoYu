import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

export async function reviewRouteAccess({ context, origin, evidence }) {
  const page = await context.newPage(),
    checks = [];
  const record = async (name, task) => {
    try {
      await task();
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, error: error.message });
    }
  };
  try {
    await record(
      'ordinary user opening protected management link',
      async () => {
        await page.goto(origin + '/#/manage/users');
        await expect(
          page.getByRole('heading', { name: '账号与安全', exact: true }),
        ).toBeVisible();
        assert.notEqual(new URL(page.url()).hash, '#/manage/users');
      },
    );
    await record('empty role list excludes restricted routes', async () => {
      await page.goto('about:blank');
      await page.route('**/api/user/info', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.data.roles = [];
        await route.fulfill({ response, json: body });
      });
      try {
        await page.goto(origin + '/#/manage/users');
        await expect(
          page.getByRole('heading', { name: '账号与安全', exact: true }),
        ).toBeVisible();
        assert.notEqual(new URL(page.url()).hash, '#/manage/users');
      } finally {
        await page.unroute('**/api/user/info');
      }
    });
    await record(
      'temporary identity lookup failure preserves route and session',
      async () => {
        await page.goto('about:blank');
        await page.route(
          '**/api/user/info',
          (route) =>
            route.fulfill({ status: 503, json: { msg: 'test outage' } }),
          { times: 1 },
        );
        await page.goto(origin + '/#/account/profile');
        await expect(page.locator('body')).toContainText(
          '暂时无法连接多鱼账号',
          { timeout: 5000 },
        );
        assert.equal(new URL(page.url()).hash, '#/account/profile');
        await page.reload();
        await expect(
          page.getByRole('heading', { name: '账号与安全', exact: true }),
        ).toBeVisible();
      },
    );
    await record(
      'rapid cold navigation retains last authorized destination',
      async () => {
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        await page.goto('about:blank');
        let count = 0;
        const requested = page.waitForRequest(
          (r) => new URL(r.url()).pathname === '/api/user/info',
          { timeout: 10000 },
        );
        await page.route('**/api/user/info', async (route) => {
          count++;
          await gate;
          await route.continue();
        });
        try {
          await page.goto(origin + '/#/account/profile', {
            waitUntil: 'domcontentloaded',
          });
          await requested;
          await page.evaluate(
            () =>
              new Promise((resolve) => {
                window.addEventListener(
                  'hashchange',
                  () => requestAnimationFrame(() => resolve()),
                  { once: true },
                );
                location.hash = '/account/security?action=password';
              }),
          );
        } finally {
          release();
        }
        await expect(
          page.getByRole('heading', { name: '修改密码', exact: true }),
        ).toBeVisible();
        assert.equal(
          new URL(page.url()).hash,
          '#/account/security?action=password',
        );
        assert.equal(count, 1, 'one user-info request per cold start');
      },
    );
    await record(
      'screen lock persists a one-way proof and unlocks after reload',
      async () => {
        await page.goto(origin + '/#/account/profile');
        await expect(page.locator('.layout-lock-screen')).toBeAttached();
        await page.evaluate(() =>
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: '¬',
              altKey: true,
              bubbles: true,
            }),
          ),
        );
        const setup = page.getByPlaceholder('请输入锁屏密码');
        const storedProof = () =>
          page.evaluate(() => {
            const key = Object.keys(localStorage).find((key) =>
              /^sys-v.*-user$/.test(key),
            );
            return key
              ? JSON.parse(localStorage.getItem(key)).lockPassword
              : null;
          });
        await setup.fill('local-test-screen-lock');
        await setup.press('Enter');
        await expect(page.getByPlaceholder('请输入解锁密码')).toBeVisible();
        await expect.poll(storedProof).toMatch(/^pbkdf2-sha256-v1:/);
        await page.reload();
        const unlock = page.getByPlaceholder('请输入解锁密码');
        await unlock.fill('incorrect-fixture');
        await unlock.press('Enter');
        await expect(unlock).toHaveValue('');
        await unlock.fill('local-test-screen-lock');
        await unlock.press('Enter');
        await expect(unlock).toHaveCount(0);
        await expect.poll(storedProof).toBe('');
      },
    );
  } finally {
    await page.close();
    await writeFile(
      path.join(evidence, 'route-access.json'),
      JSON.stringify(checks, null, 2),
    );
  }
  assert.ok(
    checks.every((c) => c.passed),
    'route acceptance failed: ' +
      checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(', '),
  );
}
