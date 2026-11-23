import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

await mkdir('work', { recursive: true });
const profile = await mkdtemp(path.resolve('work/memo-editor-race-'));
const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const channel = process.env.TEST_BROWSER_CHANNEL || 'msedge';
const context = await chromium.launchPersistentContext(profile, {
  channel,
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args:
    channel === 'chrome'
      ? ['--enable-unsafe-extension-debugging']
      : [
          '--load-extension=' + extension,
          '--disable-extensions-except=' + extension,
        ],
});
try {
  let id;
  if (channel === 'chrome') {
    const debuggerSession = await context.browser().newBrowserCDPSession();
    id = (
      await debuggerSession.send('Extensions.loadUnpacked', { path: extension })
    ).id;
    await debuggerSession.detach();
  }
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  id ||= new URL(worker.url()).host;
  await context.route(/^https?:/, (route) => route.abort());
  const page = await context.newPage();
  const account = {
    issuer: 'https://memo.test',
    sub: 'editor-race',
    name: '测试',
  };
  const key = createHash('sha256')
    .update(account.issuer + '\0' + account.sub)
    .digest('hex');
  await page.addInitScript(
    ({ account, key }) => {
      localStorage.setItem('duoyu-sync-account', key);
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message) => {
        if (message.type === 'duoyu-auth' && message.action === 'status') {
          return Promise.resolve({ view: { account } });
        }
        if (message.type === 'duoyu-auth' && message.action === 'sync') {
          return Promise.resolve({ status: 503, error: 'offline fixture' });
        }
        return send(message);
      };
    },
    { account, key },
  );
  await page.goto('chrome-extension://' + id + '/newtab.html');
  const open = () =>
    page
      .getByRole('navigation', { name: '快捷 Dock' })
      .getByRole('button', { name: '便签', exact: true })
      .click();
  await open();
  const board = page.locator('.memo-board');
  const sheet = board.getByRole('region', { name: '便签画布' });
  await sheet.click({ button: 'right', position: { x: 90, y: 80 } });
  await board.getByRole('menuitem', { name: /新建便签/ }).click();
  const field = board.getByRole('textbox', { name: '便签正文' });
  const preview = board.locator('.memo-preview');
  const search = board.getByRole('searchbox');
  const noteId = await board.locator('.memo-card').getAttribute('data-memo-id');
  const dbName = 'duoyu-account-' + key;
  const persisted = () =>
    page.evaluate(
      ({ dbName, noteId }) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db
              .transaction('memos')
              .objectStore('memos')
              .get(noteId);
            read.onsuccess = () => resolve(read.result?.body);
            read.onerror = () => reject(read.error);
            read.transaction.oncomplete = () => db.close();
          };
        }),
      { dbName, noteId },
    );
  await field.fill('第一版');
  await expect.poll(persisted).toBe('第一版');
  await search.focus();
  await expect(preview).toHaveText('第一版');
  await preview.click();
  // Hold a real IndexedDB writer, as can happen during sync or another tab's save.
  const holdWriter = () =>
    page.evaluate(
      (dbName) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('memos', 'readwrite');
            let hold = true;
            window.releaseMemoTestWriter = () => {
              hold = false;
            };
            const loop = () => {
              tx.objectStore('memos').count().onsuccess = () => {
                resolve();
                if (hold) loop();
              };
            };
            tx.oncomplete = () => db.close();
            loop();
          };
        }),
      dbName,
    );
  await holdWriter();
  await field.press('End');
  await page.keyboard.insertText('，甲');
  await search.focus();
  const beforeReopen = await preview.innerText();
  await preview.click();
  const reopened = await field.innerText();
  await field.press('End');
  await page.keyboard.insertText('乙');
  await search.focus();
  await page.evaluate(() => window.releaseMemoTestWriter());
  await expect.poll(persisted).toBe('第一版，甲乙');
  expect(beforeReopen).toBe('第一版，甲');
  expect(reopened).toBe('第一版，甲');
  await expect(preview).toHaveText('第一版，甲乙');

  await preview.click();
  await field.press('End');
  const input = await context.newCDPSession(page);
  await input.send('Input.imeSetComposition', {
    text: '中文',
    selectionStart: 2,
    selectionEnd: 2,
  });
  await expect(field).toHaveText('第一版，甲乙中文');
  await expect.poll(persisted).toBe('第一版，甲乙');
  await input.send('Input.insertText', { text: '中文' });
  await expect.poll(persisted).toBe('第一版，甲乙中文');
  await field.press('End');
  await input.send('Input.imeSetComposition', {
    text: '切页',
    selectionStart: 2,
    selectionEnd: 2,
  });
  await board.getByRole('button', { name: '归档', exact: true }).click();
  await expect.poll(persisted).toBe('第一版，甲乙中文切页');
  await input.detach();
  await page.reload();
  await open();
  await expect(preview).toHaveText('第一版，甲乙中文切页');

  // Simulate one failed save, retry the same source by leaving the editor.
  const retryText = '写入失败后保留';
  await preview.click();
  await page.evaluate((retryText) => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...other) {
      if (this.name === 'memos' && value.body === retryText) {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('一次测试写入失败', 'QuotaExceededError');
      }
      return original.call(this, value, ...other);
    };
  }, retryText);
  await field.fill(retryText);
  await expect(board.getByRole('alert')).toContainText('一次测试写入失败');
  await search.focus();
  await expect.poll(persisted).toBe(retryText);
  await expect(preview).toHaveText(retryText);

  // Reload while the writer is still blocked: Chromium aborts the page's
  // transactions, so all typed text must be recovered by new-tab startup.
  await preview.click();
  await holdWriter();
  const finalText = '刷新恢复，最后一个字。';
  await field.fill(finalText);
  await page.evaluate((key) => {
    localStorage.setItem('account:' + key + ':pending-memo:broken', '{');
    localStorage.setItem('account:other:pending-memo:foreign', 'other');
  }, key);
  await page.reload();
  await expect.poll(persisted).toBe(finalText);
  await open();
  await expect(preview).toHaveText(finalText);
  const checkpointState = await page.evaluate(
    (key) => ({
      current: Object.keys(localStorage).filter((k) =>
        k.startsWith('account:' + key + ':pending-memo:'),
      ),
      foreign: localStorage.getItem('account:other:pending-memo:foreign'),
    }),
    key,
  );
  expect(checkpointState).toEqual({ current: [], foreign: 'other' });

  // A different tab may have edited or deleted a document before recovery.
  // Use the same unfinished-write records produced by pagehide and preserve
  // each unsaved source in the conflict center without overwriting the row.
  const recoveryIds = await page.evaluate(
    ({ dbName, key, noteId }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('memos');
          const read = tx.objectStore('memos').get(noteId);
          read.onsuccess = () => {
            const ids = [crypto.randomUUID(), crypto.randomUUID()];
            const deletedId = crypto.randomUUID();
            for (const [index, operation] of ids.entries()) {
              const base = {
                ...read.result,
                id: index ? deletedId : noteId,
                body: '关页前的旧版本',
              };
              localStorage.setItem(
                'account:' + key + ':pending-memo:' + operation,
                JSON.stringify({
                  operation,
                  base,
                  source: '尚未提交的修改',
                  committed: null,
                  writing: '尚未提交的修改',
                }),
              );
            }
            resolve({ ids, deletedId });
          };
          tx.oncomplete = () => db.close();
        };
      }),
    { dbName, key, noteId },
  );
  await page.reload();
  await open();
  await expect(preview).toHaveText(finalText);
  const review = await page.evaluate(
    ({ dbName, ids, deletedId }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['memos', 'syncConflicts']);
          const deleted = tx.objectStore('memos').getKey(deletedId);
          const edits = ids.map((id) =>
            tx.objectStore('syncConflicts').get(id),
          );
          tx.oncomplete = () => {
            db.close();
            resolve({
              deleted: deleted.result ?? null,
              edits: edits.map(({ result }) => [
                result.reason,
                Object.values(result.operation.rows)[0].value.body,
              ]),
            });
          };
        };
      }),
    { dbName, ...recoveryIds },
  );
  expect(review).toEqual({
    deleted: null,
    edits: [
      ['field_conflict', '尚未提交的修改'],
      ['deleted_or_missing', '尚未提交的修改'],
    ],
  });
  console.log(
    'PASS blocked writes, immediate re-edit, IME, view switch, retry, reload recovery, malformed record, account isolation, concurrent edit and deletion',
  );
} finally {
  await context.close();
}
