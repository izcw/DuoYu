import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

// Real extension worker -> Go -> Node -> PostgreSQL, then real restore UI and IndexedDB.
export async function reviewLargeAccountRestore({
  page,
  issuer,
  sub,
  evidence,
}) {
  const call = (route, body) =>
    page.evaluate(
      async ({ issuer, sub, route, body }) => {
        return await chrome.runtime.sendMessage({
          type: 'duoyu-auth',
          action: 'sync',
          account: { issuer, sub },
          path: route,
          method: body ? 'POST' : 'GET',
          ...(body ? { body } : {}),
        });
      },
      { issuer, sub, route, body },
    );
  let response = await call('/api/v1/sync/snapshot');
  assert.equal(response.status, 200);
  const epoch = response.data.epoch,
    deviceId = randomUUID(),
    space = randomUUID(),
    collection = randomUUID();
  const now = Date.now();
  const tabs = Array.from({ length: 2001 }, (_, index) => ({
    id: randomUUID(),
    collectionId: collection,
    position: index,
    title: 'Restore original ' + index,
    url: 'https://example.invalid/large/' + index,
    icon: '',
    savedAt: now,
    starred: false,
  }));
  const changes = [
    {
      table: 'workspaceSpaces',
      id: space,
      value: { id: space, name: 'Large restore fixture', order: 900 },
    },
    {
      table: 'tabCollections',
      id: collection,
      value: {
        id: collection,
        spaceId: space,
        name: 'Large restore bookmarks',
        order: 0,
        updatedAt: now,
        color: 'default',
      },
    },
    ...tabs.map((value) => ({ table: 'savedTabs', id: value.id, value })),
  ].map((change) => ({ ...change, base: null, revision: '0' }));
  async function commit(changes) {
    const result = await call('/api/v1/sync/operations', {
      id: randomUUID(),
      deviceId,
      epoch,
      changes,
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.data.status, 'applied');
    return result.data;
  }
  await commit(changes.slice(0, 2000));
  const original = await commit(changes.slice(2000));
  const originalRevision = String(original.revision);
  response = await call('/api/v1/sync/snapshot');
  assert.equal(response.status, 200);
  const originals = response.data.entities.filter(
    (e) => e.table === 'savedTabs' && e.payload.collectionId === collection,
  );
  assert.equal(originals.length, 2001);
  const updates = originals.map((e) => ({
    table: e.table,
    id: e.id,
    base: e.payload,
    value: { ...e.payload, title: 'Changed ' + e.id },
    revision: e.revision,
  }));
  await commit(updates.slice(0, 2000));
  await commit(updates.slice(2000));
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  const backups = page.getByRole('region', { name: '云端备份记录' });
  await expect(backups).toBeVisible();
  await expect(
    page.getByRole('button', { name: '立即同步', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  const localTabs = () =>
    page.evaluate(async (collectionId) => {
      const account = localStorage.getItem('duoyu-sync-account');
      if (!account) return [];
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('duoyu-account-' + account);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db
            .transaction('tabCollections')
            .objectStore('tabCollections')
            .get(collectionId);
          request.onsuccess = () => resolve(request.result?.tabs ?? []);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    }, collection);
  await expect
    .poll(
      async () =>
        (await localTabs()).filter((t) => t.title.startsWith('Changed '))
          .length,
      { timeout: 30000 },
    )
    .toBe(2001);
  await backups.getByRole('button', { name: '刷新', exact: true }).click();
  const selected = backups.locator('li').filter({
    has: page.locator('small', {
      hasText: new RegExp('版本 ' + originalRevision + '$'),
    }),
  });
  await expect(selected).toHaveCount(1);
  await selected
    .getByRole('button', { name: '恢复此备份', exact: true })
    .click();
  const confirmation = backups.getByRole('group', { name: '确认恢复备份' });
  await expect(confirmation).toBeVisible();
  const started = performance.now();
  await confirmation
    .getByRole('button', { name: '确认恢复', exact: true })
    .click();
  await expect(backups.getByRole('status')).toHaveText(
    '已恢复所选备份，其他设备将在同步后更新。',
    { timeout: 45000 },
  );
  await expect
    .poll(
      async () =>
        (await localTabs()).filter((t) =>
          t.title.startsWith('Restore original '),
        ).length,
      { timeout: 30000 },
    )
    .toBe(2001);
  response = await call('/api/v1/sync/snapshot');
  assert.equal(response.status, 200);
  const restored = response.data.entities.filter(
    (e) =>
      e.table === 'savedTabs' &&
      e.payload.collectionId === collection &&
      !e.deleted,
  );
  assert.equal(restored.length, 2001);
  assert.deepEqual(
    restored.map((e) => e.payload).sort((a, b) => a.position - b.position),
    tabs,
  );
  await page.screenshot({
    path: path.join(evidence, 'large-restore-ui.png'),
    fullPage: true,
  });
  await writeFile(
    path.join(evidence, 'large-restore.json'),
    JSON.stringify(
      {
        passed: true,
        items: 2001,
        originalRevision,
        restoredRevision: response.data.revision,
        elapsedMs: Math.round(performance.now() - started),
        scope:
          'actual restore UI, worker, Go/Node/PostgreSQL and IndexedDB; isolated synthetic data; not sustained capacity',
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS real backup restore UI restores 2001 bookmarks through all services and IndexedDB',
  );
  await page.keyboard.press('Escape');
}
