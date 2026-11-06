import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function verifyPageIcons(page) {
  const button = (scope, name) =>
    scope.getByRole('button', { name, exact: true });
  const libraryMenu = page
    .locator('.desktop-menu')
    .filter({ has: page.locator('.library-page-menu') });
  await libraryMenu.hover();
  await button(page, '添加收藏页').click();
  const dialog = page.getByRole('dialog', { name: '添加收藏页', exact: true });
  const picker = dialog.getByRole('group', { name: '选择页面图标' });
  const name = dialog.getByLabel('收藏页名称');
  const checkGroups = async (picker) => {
    await expect(picker).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const selected = picker.locator('button[aria-pressed="true"]');
    await expect(selected).toHaveCSS('color', 'rgb(0, 0, 0)');
    assert.ok(
      await selected.evaluate((el) => el.offsetWidth > 0 && el.offsetWidth === el.offsetHeight),
      'The selected icon should have a square hit area',
    );
    await expect(picker.getByRole('searchbox')).toHaveCount(0);
    await expect(picker.getByRole('combobox')).toHaveCount(0);
    const groups = picker.getByRole('region');
    await expect(groups).toHaveCount(6);
    for (const group of await groups.all())
      assert.ok((await group.getByRole('button').count()) >= 16);
  };
  await expect(dialog).toHaveClass(/solid-dialog/);
  await expect(
    dialog.getByRole('button', { name: '关闭', exact: true }),
  ).toBeVisible();
  await checkGroups(picker);
  const pixels = await page.evaluate(async () => {
    const ids = Array.from(
      document.querySelectorAll('[data-choice]'),
      (button) => button.dataset.choice,
    );
    return Promise.all(
      ids.map(async (id) => {
        const image = new Image();
        image.src = '/images/iconpark-filled/' + id + '.svg';
        await image.decode();
        const c = document.createElement('canvas');
        c.width = c.height = 48;
        const ctx = c.getContext('2d');
        ctx.drawImage(image, 0, 0, 48, 48);
        const data = ctx.getImageData(0, 0, 48, 48).data;
        return data.some((v, i) => i % 4 === 3 && v > 0);
      }),
    );
  });
  assert.ok(pixels.every(Boolean));
  await picker.locator('.icon-scroll').hover();
  await page.mouse.wheel(0, 350);
  await expect
    .poll(() => picker.locator('.icon-scroll').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(20);
  await expect
    .poll(() =>
      picker.locator('h3, [data-choice]').evaluateAll((elements) =>
        elements.some((el) => {
          const r = el.getBoundingClientRect(),
            v = el.closest('.icon-scroll').getBoundingClientRect();
          return (
            r.bottom > v.top &&
            r.top < v.bottom &&
            Number(getComputedStyle(el).opacity) < 0.95
          );
        }),
      ),
    )
    .toBe(true);
  // Move across the short last row of the first category, keeping its column.
  const lastInGroup = picker
    .getByRole('region', { name: '常用收藏' })
    .getByRole('button')
    .last();
  await lastInGroup.focus();
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() =>
      picker.evaluate((el) =>
        el.ownerDocument.activeElement
          .closest('section')
          ?.getAttribute('aria-label'),
      ),
    )
    .toBe('办公与效率');
  await page.keyboard.press('ArrowUp');
  await expect(lastInGroup).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      picker
        .locator('[data-choice]')
        .evaluateAll((nodes) =>
          nodes.every((el) => getComputedStyle(el).transform === 'none'),
        ),
    )
    .toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await button(picker, '唱片').click();
  await name.fill('测试影集');
  await button(dialog, '添加').click();
  const row = page.locator('[data-menu-row]').filter({ hasText: '测试影集' });
  await expect(row.locator('[data-icon="RecordDisc"]')).toHaveAttribute(
    'data-theme',
    'filled',
  );
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '修改名称和图标' }).click();
  const edit = page.getByRole('dialog', { name: '编辑收藏页' });
  await expect(button(edit, '唱片')).toHaveAttribute('aria-pressed', 'true');
  await button(edit, '阅读').click();
  await button(edit, '保存').click();
  await button(page, '标签工作区').click();
  await button(page, '新建空间').click();
  const space = page.getByRole('dialog', { name: '添加空间' });
  await space.getByLabel('空间名称').fill('测试旅行');
  await checkGroups(space.getByRole('group', { name: '选择页面图标' }));
  await button(space, '指南针').focus();
  await page.keyboard.press('End');
  await expect(button(space, '护照')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(button(space, '护照')).toHaveAttribute('aria-pressed', 'true');
  await button(space, '添加').click();
  const spaceRow = page
    .locator('.workspace-board [data-menu-row]')
    .filter({ hasText: '测试旅行' });
  await expect(spaceRow.locator('[data-icon="Passport"]')).toHaveAttribute(
    'data-theme',
    'filled',
  );
  await page.reload();
  await libraryMenu.hover();
  await expect(row.locator('[data-icon="Book"]')).toBeVisible();
  await button(page, '标签工作区').click();
  await expect(spaceRow.locator('[data-icon="Passport"]')).toBeVisible();
  await page.keyboard.press('Escape');
  console.log(
    'PASS both icon dialogs, six groups with at least 16 icons, filled assets, fold/scroll, keyboard and reload persistence',
  );
}
