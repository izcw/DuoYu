import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';

export async function verifyImportLayout({
  page,
  syncPool,
  account,
  evidence,
}) {
  const prefix = randomUUID(),
    main = prefix + '-main',
    other = prefix + '-other';
  const items = Array.from({ length: 1200 }, (_, i) => ({
    id: String(i),
    kind: i === 1199 ? 'folder' : 'link',
    name: `${prefix}:${i}`,
    pageId: main,
    width: i === 1199 ? 3 : 1,
    height: 1,
    url: i === 1199 ? '' : 'https://example.invalid/' + i,
  }));
  items.push({
    id: 'child',
    name: prefix + ':child',
    pageId: main,
    parent: '1199',
    kind: 'link',
    url: 'https://example.invalid/child',
  });
  items.push({
    id: 'other',
    name: prefix + ':other',
    pageId: other,
    kind: 'link',
    url: 'https://example.invalid/other',
  });
  const file = {
    format: 'duoyu-backup',
    version: 1,
    tables: {
      libraryPages: [
        { id: main, name: main },
        { id: other, name: other },
      ],
      libraryItems: items,
    },
  };
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await page.getByRole('button', { name: '备份与恢复', exact: true }).click();
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: '导入JSON文件',
    exact: true,
  });
  const pick = async (data) => {
    const chooser = page.waitForEvent('filechooser');
    await dialog.locator('.file-picker').click();
    await (
      await chooser
    ).setFiles({
      name: randomUUID() + '.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await expect(
      dialog.locator('.import-summary').or(dialog.getByRole('alert')).first(),
    ).toBeVisible();
  };
  const started = performance.now();
  await pick(file);
  const previewMs = Math.round(performance.now() - started);
  const errors = await dialog.getByRole('alert').allTextContents();
  assert.deepEqual(
    errors,
    [],
    `Valid 1,202-item import was refused: ${errors.join(' ')}`,
  );
  const counts = dialog.locator('.import-summary > div');
  await expect(counts.filter({ hasText: '页面' }).locator('strong')).toHaveText(
    '11',
  );
  await expect(
    counts.filter({ hasText: '图标与组件' }).locator('strong'),
  ).toHaveText('1202');
  await dialog.getByRole('button', { name: '导入数据', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('导入已保存');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  const rows = async () =>
    (
      await syncPool.query(
        "SELECT payload FROM sync_entities WHERE account_id=$1 AND entity_type='libraryItems' AND payload->>'name' LIKE $2 AND NOT deleted",
        [account, prefix + ':%'],
      )
    ).rows.map((r) => r.payload);
  await expect
    .poll(async () => (await rows()).length, { timeout: 45000 })
    .toBe(1202);
  const data = await rows(),
    folder = data.find((r) => r.kind === 'folder'),
    child = data.find((r) => r.name === prefix + ':child');
  assert.equal(child.parent, folder.id);
  assert.equal(child.pageId, folder.pageId);
  const groups = new Map();
  for (const row of data.filter((r) => !r.parent)) {
    const cells = groups.get(row.pageId) ?? new Set();
    groups.set(row.pageId, cells);
    assert.ok(
      row.gridX >= 0 && row.gridX < 16 && row.gridY >= 0 && row.gridY < 8,
    );
    for (let dy = 0; dy < row.height; dy++)
      for (let dx = 0; dx < row.width; dx++) {
        assert.ok(row.gridX + dx < 16 && row.gridY + dy < 8);
        const key = (row.gridY + dy) * 16 + row.gridX + dx;
        assert.ok(!cells.has(key));
        cells.add(key);
      }
  }
  assert.deepEqual(
    [...groups.values()].map((v) => v.size).sort((a, b) => a - b),
    [1, 50, ...Array(9).fill(128)],
  );
  const otherId = data.find((r) => r.name === prefix + ':other').pageId;
  assert.equal(
    (
      await syncPool.query(
        "SELECT payload->>'name' AS name FROM sync_entities WHERE account_id=$1 AND entity_type='libraryPages' AND entity_id=$2",
        [account, otherId],
      )
    ).rows[0].name,
    other,
  );
  await page.getByRole('button', { name: '导入备份', exact: true }).click();
  await pick({
    ...file,
    tables: {
      ...file.tables,
      libraryItems: Array.from({ length: 2000 }, (_, i) => ({
        ...items[0],
        id: String(i),
      })),
    },
  });
  await expect(dialog.getByRole('alert')).toContainText('单次导入最多2000条');
  await expect(
    dialog.getByRole('button', { name: '导入数据', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.keyboard.press('Escape');
  await writeFile(
    path.join(evidence, 'import-layout.json'),
    JSON.stringify(
      {
        passed: true,
        items: 1202,
        pages: groups.size,
        previewMs,
        folderRetained: true,
        sourcePagesIsolated: true,
        overLimitRejected: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS actual 1202-item import uses 11 bounded pages, syncs every item, preserves folder and rejects >2000 changes',
  );
}
