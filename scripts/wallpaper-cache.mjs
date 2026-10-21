import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const profile = await mkdtemp(path.resolve('work/wallpaper-tests-'));
const extension = path.resolve('.output/chrome-mv3');
const image = await readFile('public/images/duoyu.png');
let requests = 0;
let mode = 'image';
let context;
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: process.env.TEST_BROWSER_CHANNEL || 'chromium',
    headless: true,
    timezoneId: 'Asia/Shanghai',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await context.route('https://api.bimg.cc/**', async (r) => {
    requests++;
    if (mode === 'offline') return r.abort();
    if (mode === 'corrupt')
      return r.fulfill({ contentType: 'image/png', body: 'broken' });
    return r.fulfill({ contentType: 'image/png', body: image });
  });
}
async function record(page, action = 'read') {
  return page.evaluate(
    (action) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('duoyu');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('wallpapers', 'readwrite');
          const table = tx.objectStore('wallpapers');
          let value;
          const get = table.get('daily');
          get.onsuccess = () => {
            value = get.result;
            if (action === 'stale' && value) {
              value.sourceUrl = 'yesterday';
              table.put(value);
            }
            if (action === 'clear') table.clear();
            if (action === 'corrupt' && value) {
              value.blob = new Blob(['bad'], { type: 'image/png' });
              table.put(value);
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve(
              value
                ? {
                    sourceUrl: value.sourceUrl,
                    size: value.blob.size,
                    savedAt: value.savedAt,
                  }
                : null,
            );
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    action,
  );
}
async function loaded(page) {
  await expect(page.locator('.wallpaper img.loaded')).toBeVisible();
  assert.equal(
    await page.locator('.wallpaper img').evaluate((el) => el.naturalWidth),
    700,
  );
  await expect(page.locator('.wallpaper-status')).toHaveCount(0);
}
try {
  await launch();
  let page = await context.newPage();
  await page.goto('chrome://newtab');
  await loaded(page);
  assert.equal((await record(page)).size, image.length);
  assert.equal(requests, 1);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('duoyu:wallpaper-preview')),
    )
    .toBeTruthy();
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('#app')) return;
      window.__previewBeforeApp =
        document.documentElement.dataset.wallpaperPreview === 'ready';
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await loaded(page);
  assert.equal(requests, 1);
  assert.equal(await page.evaluate(() => window.__previewBeforeApp), true);
  await expect(page.locator('.wallpaper img')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  await expect(page.locator('.wallpaper')).toHaveCSS(
    'background-image',
    'none',
  );
  console.log(
    'PASS startup preview exists before app mount; cached image has no fade through fallback',
  );
  await page.evaluate(() =>
    localStorage.setItem('duoyu:wallpaper-preview', '{broken'),
  );
  await page.reload();
  await loaded(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage
          .getItem('duoyu:wallpaper-preview')
          ?.startsWith('{"version":'),
      ),
    )
    .toBe(true);
  assert.equal(requests, 1);
  console.log(
    'PASS malformed preview recovers without re-downloading wallpaper',
  );
  console.log('PASS persisted Blob and same-day cache hit');
  mode = 'offline';
  await context.close();
  await launch();
  page = await context.newPage();
  await page.goto('chrome://newtab');
  await loaded(page);
  assert.equal(requests, 1);
  console.log('PASS browser restart offline');
  await record(page, 'stale');
  await page.reload();
  await loaded(page);
  await expect.poll(() => requests).toBe(2);
  assert.equal((await record(page)).sourceUrl, 'yesterday');
  console.log('PASS stale cache survives offline update');
  mode = 'corrupt';
  await page.reload();
  await loaded(page);
  await expect.poll(() => requests).toBe(3);
  await page.waitForTimeout(200);
  assert.equal((await record(page)).sourceUrl, 'yesterday');
  console.log('PASS corrupt download cannot replace good cache');
  mode = 'image';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await record(page)).sourceUrl)
    .not.toBe('yesterday');
  console.log('PASS reconnect updates cache');
  await record(page, 'clear');
  mode = 'offline';
  await page.evaluate(() => localStorage.removeItem('duoyu:wallpaper-preview'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.locator('.wallpaper-status')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute(
    'data-fallback-theme',
    'light',
  );
  await expect(page.locator('.wallpaper')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.wallpaper-shade')).toHaveCSS('opacity', '0');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-fallback-theme',
    'dark',
  );
  await expect(page.locator('.wallpaper')).toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.wallpaper')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  console.log(
    'PASS offline fallback follows system light/dark changes without colored shade',
  );
  const timed = await context.newPage();
  await timed.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      original(
        query.includes('prefers-color-scheme')
          ? '(unknown-color-scheme: unavailable)'
          : query,
      );
  });
  await timed.clock.install({ time: new Date('2026-10-21T06:59:59+08:00') });
  await timed.goto('chrome://newtab');
  await expect(timed.locator('html')).toHaveAttribute(
    'data-fallback-theme',
    'dark',
  );
  await timed.clock.fastForward(2000);
  await expect(timed.locator('html')).toHaveAttribute(
    'data-fallback-theme',
    'light',
  );
  await timed.clock.fastForward(12 * 60 * 60 * 1000);
  await expect(timed.locator('html')).toHaveAttribute(
    'data-fallback-theme',
    'dark',
  );
  await timed.close();
  console.log(
    'PASS unsupported system preference switches by local time at 07:00 and 19:00',
  );
  mode = 'image';
  requests = 0;
  const second = await context.newPage();
  await Promise.all([page.reload(), second.goto('chrome://newtab')]);
  await Promise.all([loaded(page), loaded(second)]);
  assert.equal(requests, 1);
  console.log('PASS concurrent tabs share one download');
  await second.close();
  await record(page, 'corrupt');
  await page.reload();
  await loaded(page);
  assert.equal((await record(page)).size, image.length);
  console.log('PASS corrupt stored image recovers');
} finally {
  await context?.close();
}
