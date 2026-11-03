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
  await p.goto('chrome://newtab');
  const icon = p.locator('.preview-icons button:has(img)').first();
  await icon.waitFor();
  await icon.scrollIntoViewIfNeeded();
  const geometry = el => {
    const box = el.getBoundingClientRect(), img = el.querySelector('img').getBoundingClientRect();
    return [box.width, box.height, img.width, img.height, img.x-box.x, img.y-box.y];
  };
  const before = await icon.evaluate(geometry);
  const rect = await icon.boundingBox();
  const x = rect.x + rect.width/2, y = rect.y + rect.height/2;
  await p.mouse.move(x,y);
  await p.mouse.down();
  await p.mouse.move(x+8,y+2,{steps:3});
  const ghost = p.locator('.drag-landing-preview');
  await ghost.waitFor();
  const after = await ghost.evaluate(geometry);
  for(let i=0;i<before.length;i++) expect(Math.abs(after[i]-before[i])).toBeLessThan(1);
  await p.mouse.up();
  await expect(ghost).toHaveCount(0);
  console.log('PASS folder drag preserves image dimensions and offset');
  await p.getByRole('button', { name: '展开 常用工具', exact: true }).click();
  const folder = p.getByRole('dialog', { name: '常用工具', exact: true });
  await folder.waitFor();
  await folder.locator('.folder-link').first().click({ button: 'right' });
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = p.getByRole('dialog', { name: '编辑网址', exact: true });
  await editor.waitFor();
  const field = p.getByLabel('收藏名称', { exact: true });
  await expect(field).toBeVisible();
  const above = await field.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return (
      document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e
    );
  });
  expect(above).toBe(true);
  await field.fill('文件夹编辑回归');
  await p.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(folder).toBeVisible();
  await expect(folder).toContainText('文件夹编辑回归');
  await folder.locator('.folder-link').first().click({ button: 'right' });
  await p.getByRole('button', { name: '编辑', exact: true }).click();
  await editor.waitFor();
  await p.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(folder).toBeVisible();
  console.log(
    'PASS folder context edit is topmost, editable, saves into folder, Escape closes editor only',
  );
} finally {
  await c.close();
}
