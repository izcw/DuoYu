import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { openGridMenu } from '../ui-helpers.mjs';

export async function verifyLegacyImport({
  legacy,
  page,
  syncPool,
  account,
  evidence,
}) {
  const ext = path.resolve(legacy);
  const context = await chromium.launchPersistentContext(
    path.join(evidence, 'legacy-profile'),
    {
      channel: 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
    },
  );
  const filename = path.join(evidence, 'legacy-guest.json');
  const title = '旧版游客导出验证';
  const url = 'https://example.invalid/legacy-guest';
  let legacyId;
  try {
    await context.route('https://**/*', (route) => route.abort());
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    legacyId = new URL(worker.url()).hostname;
    assert.notEqual(legacyId, new URL(page.url()).hostname);
    const old = await context.newPage();
    await old.goto(`chrome-extension://${legacyId}/newtab.html`);
    await openGridMenu(old, old.locator('.library-cell-grid').first());
    await old.getByRole('menuitem', { name: '添加网址', exact: true }).click();
    await old.getByLabel('收藏网址', { exact: true }).fill(url);
    await old.getByLabel('收藏名称', { exact: true }).fill(title);
    await old.getByRole('button', { name: '保存', exact: true }).click();
    await expect(
      old.locator(`.cell-link[aria-label="打开收藏 ${title}"]`),
    ).toBeVisible();
    await old
      .getByRole('button', { name: '登录多鱼账号', exact: true })
      .click();
    await old.getByRole('button', { name: '备份与恢复', exact: true }).click();
    const download = old.waitForEvent('download');
    await old.getByRole('button', { name: '导出备份', exact: true }).click();
    await (await download).saveAs(filename);
    const backup = JSON.parse(await readFile(filename));
    assert.equal(
      backup.tables.libraryItems.filter(
        (item) => item.name === title && item.url === url,
      ).length,
      1,
    );
  } finally {
    await context.close();
  }

  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  const importFile = async () => {
    await page.getByRole('button', { name: '导入备份', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: '导入JSON文件',
      exact: true,
    });
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: /选择JSON文件/ }).click();
    await (await chooser).setFiles(filename);
    await dialog.getByRole('button', { name: '导入数据', exact: true }).click();
    return dialog;
  };
  const first = await importFile();
  await expect(first.getByRole('status')).toContainText('导入已保存');
  await first.getByRole('button', { name: '完成', exact: true }).click();
  const persisted = async () =>
    (
      await syncPool.query(
        "SELECT count(*)::int AS n FROM sync_entities WHERE account_id=$1 AND entity_type='libraryItems' AND NOT deleted AND payload->>'name'=$2 AND payload->>'url'=$3",
        [account, title, url],
      )
    ).rows[0].n;
  await expect.poll(persisted, { timeout: 30000 }).toBe(1);
  const second = await importFile();
  await expect(second.getByRole('alert')).toContainText('这个文件已经导入过了');
  assert.equal(await persisted(), 1);
  await second.getByRole('button', { name: '取消', exact: true }).click();
  await page.keyboard.press('Escape');
  await writeFile(
    path.join(evidence, 'distribution-migration.json'),
    JSON.stringify(
      {
        passed: true,
        legacyId,
        newId: new URL(page.url()).hostname,
        exportedGuestBookmark: 1,
        persistedAccountBookmark: 1,
        duplicateRejected: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS legacy guest export, new account UI import, sync persistence and duplicate rejection',
  );
}
