import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('work', { recursive: true });
const ext = path.resolve('.output/chrome-mv3');
const c = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/crud-audit-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
  },
);
c.setDefaultTimeout(12000);
try {
  const p = await c.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await c.route('https://api.bimg.cc/**', (r) => r.abort());
  await p.goto('chrome://newtab');
  await p.locator('.library-cell-grid').first().waitFor();
  await p.mouse.move(2, 450);
  await p.getByRole('button', { name: '体验桌面', exact: true }).click();
  const widget = p.locator('[data-library-id="demo-calendar"]');
  await widget.waitFor();
  await p.waitForTimeout(800);
  const id = await widget.getAttribute('data-library-id');
  const position = () =>
    widget.evaluate((e) => [
      e.getAttribute('gs-x') || '0',
      e.getAttribute('gs-y') || '0',
    ]);
  const before = await position();
  const box = await widget.locator('.widget-card').boundingBox();
  await p.mouse.move(box.x + 20, box.y + 20);
  await p.mouse.down();
  await p.waitForTimeout(600);
  await p.mouse.move(box.x + 700, box.y + 220, { steps: 25 });
  await p.waitForTimeout(400);
  await p.mouse.up();
  await expect.poll(position).not.toEqual(before);
  const after = await position();
  await p.waitForTimeout(700);
  await p.reload();
  await p.locator('.desktop-menu').waitFor();
  await p.mouse.move(2, 450);
  await p.getByRole('button', { name: '体验桌面', exact: true }).click();
  await widget.waitFor();
  await p.waitForTimeout(800);
  expect(await widget.getAttribute('data-library-id')).toBe(id);
  expect(await position()).toEqual(after);
  await p
    .getByRole('navigation', { name: '快捷 Dock' })
    .getByRole('button', { name: '首页', exact: true })
    .click();
  await p.getByRole('button', { name: '展开 常用工具', exact: true }).click();
  const folder = p.getByRole('dialog', { name: '常用工具', exact: true });
  await folder.waitFor();
  const link = folder.locator('.folder-link').first();
  await link.click({ button: 'right' });
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = p.getByRole('dialog', { name: '编辑网址', exact: true });
  await editor.waitFor();
  await editor
    .locator('input[type="file"]')
    .setInputFiles('public/icons/128.png');
  const preview = editor.locator('.upload-option').first();
  await preview
    .getByRole('button', { name: '删除此图片', exact: true })
    .waitFor();
  await preview.locator('button').first().click();
  await p.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await link.click({ button: 'right' });
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  await editor.waitFor();
  await expect(
    editor.getByRole('button', { name: '删除此图片', exact: true }),
  ).toHaveCount(2);
  await editor
    .getByRole('button', { name: '删除此图片', exact: true })
    .first()
    .click();
  await expect(
    editor.getByRole('button', { name: '删除此图片', exact: true }),
  ).toHaveCount(0);
  await p.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    'PASS physical widget drag and reload, folder link upload save/reopen/delete, no runtime errors',
  );
} finally {
  await c.close();
}
