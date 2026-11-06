import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// The caller supplies a real authenticated session and disposable schema.
export async function reviewIdentityCrud({
  page,
  origin,
  db,
  userId,
  clientId,
  results,
}) {
  const navigate = async (route, heading) => {
    await page.goto(origin + '/#/' + route);
    await page.reload();
    await expect(page.locator('.dy-page h1')).toHaveText(heading);
    await expect(page.locator('.el-loading-mask:visible')).toHaveCount(0);
    await expect(page.locator('.dy-error:visible')).toHaveCount(0);
  };
  const rolesRoute = 'manage/apps/roles?id=' + encodeURIComponent(clientId);
  const roles = async () =>
    (
      await db.query(
        'SELECT id,name,role_key,is_default FROM app_roles WHERE app_id=$1',
        [clientId],
      )
    ).rows;
  const memberRole = async () =>
    (
      await db.query(
        'SELECT role_id FROM app_users WHERE app_id=$1 AND user_id=$2',
        [clientId, userId],
      )
    ).rows[0].role_id;
  const initialRole = await memberRole();
  const initialDefault = (await roles()).find((role) => role.is_default);
  const originalUser = (
    await db.query('SELECT name,admin FROM users WHERE id=$1', [userId])
  ).rows[0];
  await navigate('account/profile', '账号与安全');
  const nickname = page
    .locator('.el-form-item')
    .filter({
      has: page.locator('.el-form-item__label', { hasText: /^昵称$/ }),
    })
    .getByRole('textbox');
  await nickname.fill('隔离回归新昵称');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0]
          .name,
    )
    .toBe('隔离回归新昵称');
  await page.reload();
  await expect(nickname).toHaveValue('隔离回归新昵称');
  await nickname.fill(originalUser.name);
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.query('SELECT name FROM users WHERE id=$1', [userId])).rows[0]
          .name,
    )
    .toBe(originalUser.name);
  results.push({ flow: 'profile nickname save/reload/restore', passed: true });
  console.log('PASS real profile nickname persistence');

  await navigate(rolesRoute, '项目角色');
  await page.getByRole('button', { name: '新增角色', exact: true }).click();
  await expect(page.locator('.dy-page h1')).toHaveText('新增角色');
  await page.getByPlaceholder('例如：管理员').fill('隔离编辑员');
  await page
    .getByPlaceholder('例如：admin、user、editor')
    .fill('isolated_editor');
  await page.locator('textarea').fill('临时角色回归');
  await page.locator('.el-switch').click();
  await expect(page.getByRole('switch')).toBeChecked();
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await expect(page.locator('.dy-page h1')).toHaveText('项目角色');
  const editor = (await roles()).find(
    (role) => role.role_key === 'isolated_editor',
  );
  assert.ok(editor?.is_default);
  assert.equal(
    await memberRole(),
    initialRole,
    'Changing default does not reassign existing members',
  );

  await navigate(
    `manage/apps/member-role?id=${clientId}&user=${userId}`,
    '修改用户项目角色',
  );
  await page.locator('.dy-panel .el-select__wrapper').click();
  await page
    .getByRole('option', { name: '隔离编辑员（isolated_editor）', exact: true })
    .click();
  await page.getByRole('button', { name: '保存角色', exact: true }).click();
  await page.waitForURL((url) => url.hash.split('?')[0] === '#/manage/apps/members');
  await expect.poll(memberRole).toBe(editor.id);
  assert.equal(
    (await db.query('SELECT admin FROM users WHERE id=$1', [userId])).rows[0]
      .admin,
    originalUser.admin,
    'Project membership does not change center privileges',
  );

  await navigate(
    `manage/apps/roles/edit?id=${clientId}&role=${editor.id}`,
    '编辑角色',
  );
  await page.getByPlaceholder('例如：管理员').fill('隔离维护员');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator('.dy-page h1')).toHaveText('项目角色');
  await expect
    .poll(
      async () => (await roles()).find((role) => role.id === editor.id)?.name,
    )
    .toBe('隔离维护员');
  await navigate(
    `manage/apps/roles/edit?id=${clientId}&role=${editor.id}`,
    '编辑角色',
  );
  await page.locator('.dy-panel .el-select__wrapper').click();
  await page
    .getByRole('option', { name: initialDefault.name, exact: true })
    .click();
  await page.getByRole('button', { name: '删除角色', exact: true }).click();
  await page
    .getByRole('dialog', { name: '删除角色' })
    .getByRole('button', { name: '确定', exact: true })
    .click();
  await expect(page.locator('.dy-page h1')).toHaveText('项目角色');
  await expect
    .poll(async () => (await roles()).some((role) => role.id === editor.id))
    .toBe(false);
  assert.equal(await memberRole(), initialDefault.id);
  assert.equal(
    (await roles()).find((role) => role.is_default).id,
    initialDefault.id,
  );
  results.push({
    flow: 'project role create/default/assign/rename/delete with member transfer and center privilege isolation',
    passed: true,
  });
  console.log(
    'PASS real project role CRUD, default transfer and member reassignment',
  );
}
