import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = process.cwd();
const extensionPath = path.join(root, '.output/chrome-mv3');
const manifest = JSON.parse(
  await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'),
);
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.chrome_url_overrides.newtab, 'newtab.html');
assert.deepEqual(manifest.host_permissions, ['https://api.bing.com/*']);
await mkdir('work', { recursive: true });
const profile = await mkdtemp(path.join(root, 'work/smoke-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.TEST_BROWSER_CHANNEL || 'chromium',
  ignoreDefaultArgs: ['--disable-extensions'],
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});
try {
  const page = await context.newPage();
  const errors = [];
  let searchResult;
  context.on('page', (child) => {
    searchResult = child;
  });
  async function waitForSearch() {
    const deadline = Date.now() + 10000;
    while (
      (!searchResult || !searchResult.url().startsWith('https:')) &&
      Date.now() < deadline
    )
      await page.waitForTimeout(50);
    assert.ok(searchResult?.url().startsWith('https:'));
    assert.ok(page.url().startsWith('chrome-extension://'));
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('chrome://newtab');
  await page.locator('.clock-time').waitFor();
  await page.waitForFunction(
    () => {
      const image = document.querySelector('.wallpaper img');
      return image instanceof HTMLImageElement && image.naturalWidth > 0;
    },
    undefined,
    { timeout: 30_000 },
  );
  const metrics = await page.evaluate(() => {
    const box = document.querySelector('.search-box').getBoundingClientRect();
    const image = document.querySelector('.wallpaper img');
    return {
      width: box.width,
      height: box.height,
      clock: getComputedStyle(document.querySelector('.clock-time')).fontSize,
      date: getComputedStyle(document.querySelector('.clock-date')).fontSize,
      search: getComputedStyle(document.querySelector('input')).fontSize,
      wallpaper: [image.naturalWidth, image.naturalHeight],
    };
  });
  assert.equal(metrics.width, 500);
  assert.equal(metrics.height, 52);
  assert.equal(metrics.clock, '70px');
  assert.equal(metrics.date, '18px');
  assert.equal(metrics.search, '16px');
  assert.equal(metrics.wallpaper[0], 3840);
  const time = await page.locator('.clock-time').innerText();
  await page.waitForTimeout(1100);
  assert.notEqual(await page.locator('.clock-time').innerText(), time);
  await page.screenshot({ path: 'work/newtab-desktop.png' });
  const newtabUrl = page.url();
  let suggestionRequests = 0;
  page.on('request', (request) => {
    if (request.url().startsWith('https://api.bing.com/')) suggestionRequests++;
  });
  await page.locator('input').fill('vue');
  await page.waitForFunction(
    () => document.querySelectorAll('[role=option]').length === 10,
  );
  assert.equal(await page.locator('[role=option]').count(), 10);
  const requestsBeforeReplay = suggestionRequests;
  await page.locator('input').fill('');
  assert.equal(await page.locator('[role=option]').count(), 0);
  // Cached input must render without a network round trip.
  const cacheStart = performance.now();
  await page.locator('input').fill('vue');
  await page.locator('[role=option]').first().waitFor();
  const cacheLatencyMs = Math.round(performance.now() - cacheStart);
  assert.equal(suggestionRequests, requestsBeforeReplay);
  assert.equal(await page.locator('[role=option]').count(), 10);
  await page.screenshot({ path: 'work/search-suggestions.png' });
  const firstSuggestion = await page
    .locator('[role=option]')
    .first()
    .locator('span')
    .innerText();
  await page.locator('input').press('ArrowDown');
  assert.equal(
    await page.locator('[role=option]').first().getAttribute('aria-selected'),
    'true',
  );
  await page.locator('input').press('Enter');
  await waitForSearch();
  assert.match(new URL(searchResult.url()).hostname, /(^|\.)bing\.com$/);
  assert.equal(
    new URL(searchResult.url()).searchParams.get('q'),
    firstSuggestion,
  );
  await searchResult.close();
  searchResult = undefined;
  await page.goto(newtabUrl);
  const longQuery = '如何使用vue开发浏览器插件的新标签页';
  await page.route('https://api.bing.com/**', (route) => {
    const requested = new URL(route.request().url()).searchParams.get('query');
    return requested === longQuery
      ? route.fulfill({ status: 204 })
      : route.fulfill({
          json: [requested, ['vue 开发 chrome 插件', 'vue 新标签页开发']],
        });
  });
  await page.locator('input').fill(longQuery);
  await page
    .locator('.suggestion-kind')
    .filter({ hasText: '相关' })
    .first()
    .waitFor();
  assert.equal(
    await page.locator('[role=option]').first().locator('span').innerText(),
    longQuery,
  );
  assert.equal(await page.locator('[role=option]').count(), 3);
  await page.screenshot({ path: 'work/search-long-query.png' });
  await page.locator('input').press('Enter');
  await waitForSearch();
  assert.equal(new URL(searchResult.url()).searchParams.get('q'), longQuery);
  await page.unroute('https://api.bing.com/**');
  await searchResult.close();
  searchResult = undefined;
  await page.goto(newtabUrl);
  await page.locator('input').fill('vue');
  await page.locator('[role=option]').first().waitFor();
  await page.locator('input').press('Escape');
  assert.equal(await page.locator('[role=option]').count(), 0);
  await page.locator('input').fill('');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({ path: 'work/newtab-mobile.png' });
  await page.route('https://api.bimg.cc/**', (route) => route.abort());
  await page.reload();
  await page.locator('.wallpaper img.loaded').waitFor();
  assert.equal(await page.locator('.wallpaper-status').count(), 0);
  assert.equal(await page.locator('.clock-time').isVisible(), true);
  await page.route('https://api.bing.com/**', (route) => route.abort());
  await page.locator('input').fill('多鱼 test');
  await page.locator('button[type=submit]').click();
  await waitForSearch();
  assert.match(new URL(searchResult.url()).hostname, /(^|\.)bing\.com$/);
  assert.match(decodeURIComponent(searchResult.url()), /多鱼/);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { passed: true, metrics, cacheLatencyMs, searchUrl: searchResult.url() },
      null,
      2,
    ),
  );
} finally {
  await context.close();
}
