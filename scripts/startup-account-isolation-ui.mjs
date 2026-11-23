import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';

await mkdir('work', { recursive: true });
const extension = path.resolve(
  process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
);
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/startup-isolation-')),
  {
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  },
);
context.setDefaultTimeout(10000);
try {
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const account = {
    issuer: 'https://fixture.invalid',
    sub: 'startup',
    name: '启动隔离测试',
    email: '',
    picture: '',
  };
  const owner = createHash('sha256')
    .update(account.issuer + '\0' + account.sub)
    .digest('hex');
  await worker.evaluate(
    (account) => chrome.storage.session.set({ duoyuAuthSession: { account } }),
    account,
  );
  const page = await context.newPage();
  await page.addInitScript((owner) => {
    if (!sessionStorage.getItem('isolation-fixture')) {
      localStorage.setItem('duoyu-sync-account', owner);
      sessionStorage.setItem('isolation-fixture', '1');
    }
    sessionStorage.setItem(
      'fixture-loads',
      String(Number(sessionStorage.getItem('fixture-loads') || 0) + 1),
    );
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message) =>
      message.type === 'duoyu-auth' && message.action === 'status'
        ? new Promise(() => {})
        : original(message);
  }, owner);
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await expect(page.locator('.library-cell-grid').first()).toBeVisible();
  assert.equal(
    await page.evaluate(() => localStorage.getItem('duoyu-sync-account')),
    owner,
  );
  await page.evaluate(async () => {
    const changed = new Promise((resolve) => {
      const listener = (changes) => {
        if (!changes.glassMode) return;
        chrome.storage.local.onChanged.removeListener(listener);
        requestAnimationFrame(() => resolve());
      };
      chrome.storage.local.onChanged.addListener(listener);
    });
    await chrome.storage.local.set({ glassMode: 'soft' });
    await changed;
  });
  await expect(page.locator('html')).toHaveAttribute('data-glass-mode', 'real');
  await page
    .getByRole('navigation', { name: '快捷 Dock' })
    .getByRole('button', { name: '标签工作区', exact: true })
    .click();
  const board = page.locator('.workspace-board');
  await expect(board.locator('.workspace-collection')).toHaveCount(0);
  await board.getByRole('button', { name: '新建集合', exact: true }).click();
  await expect(board.locator('.workspace-collection-name')).toHaveText(
    '集合01',
  );
  await expect(board.getByRole('heading', { name: '个人空间' })).toBeVisible();
  await page.keyboard.press('Escape');
  console.log(
    'PASS signed-in empty storage creates its first visible collection',
  );
  // Reproduce the old deletion path in this isolated account only.
  await page.evaluate(
    (owner) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('duoyu-account-' + owner);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('workspaceSpaces', 'readwrite');
          tx.objectStore('workspaceSpaces').delete('default');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    owner,
  );
  await page
    .getByRole('navigation', { name: '快捷 Dock' })
    .getByRole('button', { name: '标签工作区', exact: true })
    .click();
  await expect(board.getByRole('heading', { name: '个人空间' })).toBeVisible();
  await expect(board.locator('.workspace-collection-name')).toHaveText(
    '集合01',
  );
  await page.keyboard.press('Escape');
  console.log(
    'PASS legacy collection becomes visible again when reopening the workspace',
  );
  // Initialization is still awaiting authentication. A genuine storage event
  // must switch back to the guest database without waiting for that request.
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    worker.evaluate(() =>
      chrome.storage.session.set({ duoyuAuthSession: { account: null } }),
    ),
  ]);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('duoyu-sync-account')))
    .toBe('');
  await expect
    .poll(() =>
      page.evaluate(() => Number(sessionStorage.getItem('fixture-loads'))),
    )
    .toBe(2);
  await expect(page.locator('.library-cell-grid').first()).toBeVisible();
  console.log(
    'PASS logout during stalled startup switches to guest storage and reloads',
  );
  const peer = await context.newPage();
  await peer.goto(`chrome-extension://${id}/popup.html`);
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    peer.evaluate(
      (owner) => localStorage.setItem('duoyu-sync-account', owner),
      owner,
    ),
  ]);
  await expect
    .poll(() =>
      page.evaluate(() => Number(sessionStorage.getItem('fixture-loads'))),
    )
    .toBe(3);
  await expect(page.locator('.newtab')).toHaveCount(0);
  console.log(
    'PASS cross-tab owner changes reload without opening private data before authentication',
  );
  await page.close();
  // A later logout can arrive before an earlier account-key lookup or the
  // initial status reply completes. Both completions must respect that logout.
  const observed = [];
  for (const delay of ['digest', 'status']) {
    await peer.evaluate(() => localStorage.removeItem('duoyu-sync-account'));
    const race = await context.newPage();
    await race.addInitScript((delay) => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const pendingStatus = new Promise((resolve) => {
        window.finishStatus = resolve;
      });
      window.statusRequests = 0;
      chrome.runtime.sendMessage = (message) => {
        if (message.type !== 'duoyu-auth' || message.action !== 'status')
          return send(message);
        window.statusRequests++;
        return pendingStatus;
      };
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      window.fixtureHash = digest(
        'SHA-256',
        new TextEncoder().encode('https://fixture.invalid\0old'),
      );
      crypto.subtle.digest = async (algorithm, bytes) => {
        if (
          new TextDecoder().decode(bytes) === 'https://fixture.invalid\0old'
        ) {
          if (delay === 'digest')
            await new Promise((resolve) => {
              window.finishDigest = resolve;
            });
          return window.fixtureHash;
        }
        return digest(algorithm, bytes);
      };
      chrome.storage.session.onChanged.addListener((changes) => {
        if (changes.duoyuAuthSession?.newValue?.account === null)
          window.logoutSeen = true;
      });
    }, delay);
    await race.goto(`chrome-extension://${id}/newtab.html`);
    // Both the account button and sync initialization must be waiting on the
    // old status, otherwise the test could only be exercising the badge.
    await race.waitForFunction(() => window.statusRequests >= 2);
    const old = { issuer: 'https://fixture.invalid', sub: 'old' };
    if (delay === 'digest') {
      await worker.evaluate(
        (account) =>
          chrome.storage.session.set({ duoyuAuthSession: { account } }),
        old,
      );
      await race.waitForFunction(() => !!window.finishDigest);
    }
    await worker.evaluate(
      (nonce) =>
        chrome.storage.session.set({
          duoyuAuthSession: { account: null, nonce },
        }),
      delay,
    );
    await race.waitForFunction(() => window.logoutSeen);
    await race.evaluate(() => window.fixtureHash.then(() => true));
    // Log any attempt to reinstate a superseded identity in the real marker.
    if (delay === 'status') {
      await race.evaluate(
        (account) => window.finishStatus({ view: { account } }),
        old,
      );
    } else {
      await race.evaluate(() => window.finishDigest());
    }
    // The real hash is already resolved. By the next task the awaiting
    // login handler has either discarded it or written the shared marker.
    const marker = await peer.evaluate(() =>
      localStorage.getItem('duoyu-sync-account'),
    );
    observed.push({ delay, staleLogin: !!marker });
    await race.close();
  }
  console.log('Superseded login results', JSON.stringify(observed));
  assert.ok(
    observed.every((row) => !row.staleLogin),
    'Older login reinstated after logout',
  );
} finally {
  await context.close();
}
