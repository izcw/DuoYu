import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

export async function verifyImportBoundaries({
  page,
  syncPool,
  account: serverAccount,
  evidence,
}) {
  const account = await page.evaluate(() =>
    localStorage.getItem('duoyu-sync-account'),
  );
  assert.match(account, /^[a-f0-9]{64}$/);
  const results = [];
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  for (const [index, scenario] of [
    'account-switch',
    'transaction-abort',
    'switch-during-write',
  ].entries()) {
    const title = randomUUID();
    const bytes = await readFile(`public/icons/${[16, 32, 48][index]}.png`),
      hash = createHash('sha256').update(bytes).digest('hex');
    const content = JSON.stringify({
      format: 'duoyu-backup',
      version: 1,
      tables: {
        libraryItems: [
          {
            id: title,
            name: title,
            pageId: 'home',
            kind: 'link',
            url: 'https://example.invalid/import-boundary',
            icon: 'duoyu-asset:' + hash,
          },
        ],
      },
      assets: [
        { id: hash, data: 'data:image/png;base64,' + bytes.toString('base64') },
      ],
    });
    const digest = createHash('sha256')
      .update(content + '\0false')
      .digest('hex');
    await page.getByRole('button', { name: '导入备份', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: '导入JSON文件',
      exact: true,
    });
    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: /选择JSON文件/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(content),
    });
    const submit = dialog.getByRole('button', {
      name: '导入数据',
      exact: true,
    });
    await expect(submit).toBeEnabled();
    try {
      if (scenario === 'account-switch') {
        // Control the interval before another tab's storage event reloads
        // this page. The original account's database is still open.
        await submit.evaluate((button) => {
          localStorage.setItem('duoyu-sync-account', 'b'.repeat(64));
          button.click();
        });
      } else {
        await page.evaluate(
          ({ name, scenario }) => {
            const original = IDBObjectStore.prototype.put;
            globalThis.__restorePut = () => {
              IDBObjectStore.prototype.put = original;
            };
            IDBObjectStore.prototype.put = function (value, ...args) {
              if (this.name === 'libraryItems' && value?.name === name) {
                globalThis.__injectedImportFault = scenario;
                if (scenario === 'transaction-abort') this.transaction.abort();
                else localStorage.setItem('duoyu-sync-account', 'b'.repeat(64));
              }
              return original.call(this, value, ...args);
            };
          },
          { name: title, scenario },
        );
        await submit.click();
      }
      await expect(
        dialog.getByRole('status').or(dialog.getByRole('alert')).first(),
      ).toBeVisible();
      const rows = await page.evaluate(
        async ({ account, title, hash, digest }) => {
          const request = (req) =>
            new Promise((resolve, reject) => {
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
          const db = await request(indexedDB.open('duoyu-account-' + account));
          try {
            const tx = db.transaction([
              'libraryItems',
              'syncAssets',
              'syncMeta',
              'syncOutbox',
            ]);
            const [items, asset, receipt, outbox] = await Promise.all([
              request(tx.objectStore('libraryItems').getAll()),
              request(tx.objectStore('syncAssets').get(hash)),
              request(tx.objectStore('syncMeta').get('import:' + digest)),
              request(tx.objectStore('syncOutbox').getAll()),
            ]);
            return {
              items: items.filter((x) => x.name === title).length,
              asset: !!asset,
              receipt: !!receipt,
              outbox: outbox.filter((x) => JSON.stringify(x).includes(title))
                .length,
            };
          } finally {
            db.close();
          }
        },
        { account, title, hash, digest },
      );
      const error = await dialog.getByRole('alert').allTextContents();
      const faultInjected =
        scenario === 'account-switch' ||
        (await page.evaluate(() => globalThis.__injectedImportFault)) ===
          scenario;
      results.push({
        scenario,
        rows,
        error,
        faultInjected,
        passed:
          faultInjected &&
          error.length > 0 &&
          rows.items === 0 &&
          !rows.asset &&
          !rows.receipt &&
          rows.outbox === 0,
      });
    } finally {
      await page.evaluate((key) => {
        localStorage.setItem('duoyu-sync-account', key);
        globalThis.__restorePut?.();
      }, account);
      await dialog.getByRole('button', { name: /^(完成|取消)$/ }).click();
    }
    if (results.at(-1).passed) {
      await page.getByRole('button', { name: '导入备份', exact: true }).click();
      const chooser = page.waitForEvent('filechooser');
      await dialog.getByRole('button', { name: /选择JSON文件/ }).click();
      await (
        await chooser
      ).setFiles({
        name: 'fixture.json',
        mimeType: 'application/json',
        buffer: Buffer.from(content),
      });
      await submit.click();
      await expect(dialog.getByRole('status')).toContainText('导入已保存');
      await expect
        .poll(
          async () =>
            (
              await syncPool.query(
                `SELECT count(*)::int AS n FROM sync_entities WHERE account_id=$1 AND entity_type='libraryItems' AND payload->>'name'=$2 AND NOT deleted AND EXISTS(SELECT 1 FROM sync_assets WHERE account_id=$1 AND sha256=$3)`,
                [serverAccount, title, hash],
              )
            ).rows[0].n,
          { timeout: 30000 },
        )
        .toBe(1);
      results.at(-1).retryPersisted = true;
      await dialog.getByRole('button', { name: '完成', exact: true }).click();
    }
  }
  await page.keyboard.press('Escape');
  await writeFile(
    path.join(evidence, 'import-boundaries.json'),
    JSON.stringify(results, null, 2),
  );
  assert.ok(
    results.every((x) => x.passed),
    JSON.stringify(results),
  );
  console.log(
    'PASS stale account and aborted IndexedDB import leave no items, assets, receipts or outbox',
  );
}
