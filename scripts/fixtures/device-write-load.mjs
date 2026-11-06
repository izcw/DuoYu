import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { openGridMenu } from '../ui-helpers.mjs';

async function createLink(page, label) {
  await openGridMenu(page, page.locator('.library-cell-grid').first());
  await page.getByRole('menuitem', { name: '添加网址', exact: true }).click();
  await page
    .getByLabel('收藏网址', { exact: true })
    .fill('https://example.invalid/' + label);
  await page.getByLabel('收藏名称', { exact: true }).fill(label);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const tile = page
    .locator('.grid-stack-item')
    .filter({
      has: page.getByRole('button', { name: '打开收藏 ' + label, exact: true }),
    });
  await expect(tile).toBeVisible();
  return await tile.getAttribute('data-library-id');
}

async function rename(page, id, name) {
  const tile = page.locator(`[data-library-id="${id}"]`);
  await tile.click({ button: 'right' });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('收藏名称', { exact: true }).fill(name);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(tile.locator('.cell-link')).toHaveAccessibleName(
    '打开收藏 ' + name,
  );
}

async function syncPage(page) {
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  const sync = page.getByRole('button', { name: '立即同步', exact: true });
  await sync.click();
  await expect(sync).toBeEnabled({ timeout: 30_000 });
  await page.keyboard.press('Escape');
}

export async function measureDeviceWrites({
  page,
  extension,
  extensionId,
  pin,
  origin,
  signIn,
  syncPool,
  account,
  evidence,
}) {
  const peer = await chromium.launchPersistentContext(
    path.join(evidence, 'write-load-peer'),
    {
      channel: 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--ignore-certificate-errors-spki-list=${pin}`,
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
      ],
    },
  );
  const samples = [];
  let passed = false,
    offlineVerified = false;
  try {
    peer.setDefaultTimeout(15_000);
    for (const route of [
      '**/api/auth/code',
      '**/api/service/mail',
      'https://api.bimg.cc/**',
    ])
      await peer.route(route, (r) => r.abort());
    const ids = [
      await createLink(page, 'device-A-0'),
      await createLink(page, 'device-B-0'),
    ];
    const readNames = async () =>
      (
        await syncPool.query(
          "SELECT entity_id,payload->>'name' AS name FROM sync_entities WHERE account_id=$1 AND entity_type='libraryItems' AND entity_id=ANY($2::text[]) AND NOT deleted",
          [account, ids],
        )
      ).rows;
    const cloudName = async (i) =>
      (await readNames()).find((row) => row.entity_id === ids[i])?.name;
    await expect.poll(readNames, { timeout: 30_000 }).toHaveLength(2);
    const second = await peer.newPage();
    await second.goto(`chrome-extension://${extensionId}/newtab.html`);
    await signIn(peer, second, origin);
    const pages = [page, second];
    await expect(
      second.locator(`[data-library-id="${ids[1]}"] .cell-link`),
    ).toHaveAccessibleName('打开收藏 device-B-0', { timeout: 30_000 });
    const started = performance.now();
    for (let round = 1; performance.now() - started < 300_000; round++) {
      const began = performance.now(),
        nameA = 'device-A-' + round,
        nameB = 'device-B-' + round;
      if (round === 3) await peer.setOffline(true);
      await Promise.all([
        rename(page, ids[0], nameA),
        rename(second, ids[1], nameB),
      ]);
      await expect.poll(() => cloudName(0), { timeout: 30_000 }).toBe(nameA);
      if (round === 3) {
        // Only the peer is disconnected. Its UI already shows the write, while
        // the authenticated server still holds its previous revision.
        await delay(2000);
        assert.equal(await cloudName(1), 'device-B-2');
        await peer.setOffline(false);
        await syncPage(second);
        offlineVerified = true;
      }
      await expect.poll(() => cloudName(1), { timeout: 30_000 }).toBe(nameB);
      const committedMs = Math.round(performance.now() - began);
      await Promise.all(pages.map(syncPage));
      for (const p of pages) {
        await expect(
          p.locator(`[data-library-id="${ids[0]}"] .cell-link`),
        ).toHaveAccessibleName('打开收藏 ' + nameA);
        await expect(
          p.locator(`[data-library-id="${ids[1]}"] .cell-link`),
        ).toHaveAccessibleName('打开收藏 ' + nameB);
      }
      samples.push({
        round,
        committedMs,
        convergedMs: Math.round(performance.now() - began),
        offline: round === 3,
      });
      if (round % 4 === 0)
        console.log(
          `Two browser profiles: ${round * 2} edits persisted and visible on both`,
        );
      await delay(
        Math.max(
          0,
          Math.min(
            15_000 - (performance.now() - began),
            300_000 - (performance.now() - started),
          ),
        ),
      );
    }
    const pendingConflicts = (
      await syncPool.query(
        'SELECT count(*)::int AS n FROM sync_conflicts WHERE account_id=$1 AND resolved_at IS NULL',
        [account],
      )
    ).rows[0].n;
    assert.equal(pendingConflicts, 0);
    assert.ok(offlineVerified);
    passed = true;
  } finally {
    try {
      await peer.close();
    } finally {
      await writeFile(
        path.join(evidence, 'device-write-load.json'),
        JSON.stringify(
          {
            passed,
            offlineVerified,
            edits: samples.length * 2,
            samples,
            scope:
              'Two independent browser profiles, same synthetic account, separate items, overlapping UI writes, one peer disconnected and reconnected',
          },
          null,
          2,
        ),
      );
    }
  }
  console.log(
    `PASS two profiles converged after ${samples.length * 2} UI edits, including an offline write`,
  );
}
