import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reviewIdentityCrud } from './id-crud.mjs';
import { reviewIdentityProjects } from './id-projects.mjs';
import { reviewAdminBoundaries } from './id-admin-boundaries.mjs';
import { reviewRouteAccess } from './id-route-access.mjs';

// Receives an already authenticated synthetic session in a disposable ID schema.
// No SMTP requests, production settings, or developer secrets are needed.
export async function reviewIdentityPages({
  context,
  origin,
  db,
  userId,
  clientId,
  evidence,
}) {
  const page = await context.newPage();
  const directory = path.join(evidence, 'identity-pages');
  await mkdir(directory);
  const results = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const app = encodeURIComponent(clientId),
    user = encodeURIComponent(userId);
  const pages = [
    ['account/profile', '账号与安全'],
    ['manage/overview', '欢迎回来'],
    ['manage/users', '账号管理'],
    [`manage/users/detail?id=${user}`, '账号资料'],
    ['manage/apps', '项目管理'],
    ['manage/apps/edit', '创建项目'],
    [`manage/apps/edit?id=${app}`, '编辑项目'],
    [`manage/apps/grants?id=${app}`, '准入名单'],
    [`manage/apps/blacklist?id=${app}`, '项目黑名单'],
    [`manage/apps/members?id=${app}`, '登录用户'],
    [`manage/apps/roles?id=${app}`, '项目角色'],
    [`manage/apps/roles/edit?id=${app}`, '新增角色'],
    [`manage/apps/member-role?id=${app}&user=${user}`, '修改用户项目角色'],
    ['manage/project-api', '凭证与 MCP'],
    ['manage/project-api/new', '创建开发者凭证'],
    ['manage/mail', '项目邮件'],
    ['manage/audit', '安全日志'],
    ['manage/docs', '接入文档'],
    ['manage/settings', '邮件与系统设置'],
    ['manage/health', '运行状态'],
  ];
  try {
    await reviewRouteAccess({context,origin,evidence});
    await reviewAdminBoundaries({
      context,
      origin,
      evidence,
      promote: () =>
        db.query('UPDATE users SET admin=true WHERE id=$1', [userId]),
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [route, title] of pages) {
        const name = route.replaceAll(/[^a-zA-Z0-9-]/g, '_') + '-' + width;
        await page.goto(origin + '/#/' + route);
        await page.reload();
        await expect(page.locator('.dy-page h1')).toContainText(title, {
          timeout: 15000,
        });
        await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
        if (width === 1440 && route === pages[0][0]) {
          const header = page.locator('#app-header');
          const search = header.getByRole('button', { name: '搜索', exact:true });
          await expect(search).toBeVisible();
          await search.focus();
          await page.keyboard.press('Enter');
          await expect(page.locator('.search-modal input')).toBeFocused();
          await page.keyboard.press('Escape');
          await expect(page.locator('.search-modal:visible')).toHaveCount(0);
        }
        await expect(page.locator('.dy-error:visible')).toHaveCount(0);
        await page.waitForFunction(() => {
          let element = document.querySelector('.dy-page');
          if (!element) return false;
          while (element) {
            if (Number(getComputedStyle(element).opacity) < 1) return false;
            element = element.parentElement;
          }
          return true;
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          route + ' overflow at ' + width,
        );
        if (width === 390)
          await expect(page.locator('.menu-left-open')).toHaveCount(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.screenshot({
          path: path.join(directory, name + '.png'),
          fullPage: true,
          animations: 'disabled',
        });
        results.push({ route, width, passed: true });
      }
      console.log(
        `PASS ID management/account ${pages.length} pages at ${width}px`,
      );
    }
    // Use a deterministic long but valid mailbox: random hex fixtures can be
    // just narrow enough to hide missing wrapping in proportional fonts.
    const originalEmail = (
      await db.query('SELECT email FROM users WHERE id=$1', [userId])
    ).rows[0].email;
    const longEmail = 'w'.repeat(64) + '@example.invalid';
    try {
      await db.query('UPDATE users SET email=$1 WHERE id=$2', [
        longEmail,
        userId,
      ]);
      await page.goto(
        origin + '/#/manage/apps/member-role?id=' + app + '&user=' + user,
      );
      await page.reload();
      await expect(page.locator('.dy-member-heading')).toContainText(longEmail);
      await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        'long member mailbox overflows at 390px',
      );
      await page.screenshot({
        path: path.join(directory, 'member-long-email-390.png'),
        fullPage: true,
        animations: 'disabled',
      });
      results.push({
        flow: 'long member mailbox wraps at 390px without truncation',
        passed: true,
      });
    } finally {
      await db.query('UPDATE users SET email=$1 WHERE id=$2', [
        originalEmail,
        userId,
      ]);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reviewIdentityCrud({ page, origin, db, userId, clientId, results });
    await reviewIdentityProjects({
      page,
      origin,
      db,
      userId,
      results,
      evidence,
    });
    assert.deepEqual(errors, []);
    assert.equal(
      (await db.query('SELECT count(*)::int AS count FROM mail_messages'))
        .rows[0].count,
      0,
    );
  } catch (error) {
    await writeFile(
      path.join(directory, 'failure-layout.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflowing: [...document.querySelectorAll('body *')]
            .map((element) => {
              const box = element.getBoundingClientRect(),
                style = getComputedStyle(element);
              return {
                tag: element.tagName,
                class: element.className?.toString(),
                x: box.x,
                right: box.right,
                width: box.width,
                display: style.display,
                visibility: style.visibility,
                position: style.position,
              };
            })
            .filter((box) => box.right > innerWidth + 1 && box.width > 0)
            .slice(0, 40),
        })),
        null,
        2,
      ),
    );
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
