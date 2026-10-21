import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

await mkdir('work', { recursive: true });
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/search-tests-')),
  {
    channel: process.env.TEST_BROWSER_CHANNEL || 'chromium',
    headless: true,
    hasTouch: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1440, height: 900 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  },
);
await context.route('https://api.bimg.cc/**', (route) => route.abort());
await context.route('https://www.bing.com/search?**', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<title>Search navigation test</title>',
  }),
);
const errors = [];
await context.route('https://fanyi.baidu.com/**', (route) =>
  route.fulfill({
    contentType: 'text/html',
    body: '<title>Translation</title>',
  }),
);
const passed = [];
async function run(name, handler, test) {
  const page = await context.newPage();
  const requests = [];
  const children = [];
  const capture = (child) => {
    children.push(child);
    page.searchResult = child;
  };
  context.on('page', capture);
  // Only our extension is under test; the mocked Bing destination can run browser-injected scripts.
  page.on('pageerror', (error) => {
    if (page.url().startsWith('chrome-extension://'))
      errors.push(error.message);
  });
  await page.route('https://api.bing.com/**', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query');
    requests.push(query);
    try {
      await handler(route, query);
    } catch {
      /* A superseded request may have been aborted. */
    }
  });
  try {
    await page.goto('chrome://newtab');
    await page.locator('input').waitFor();
    await test(page, requests);
    passed.push(name);
    console.log(`PASS ${name}`);
  } finally {
    context.off('page', capture);
    await Promise.all(children.map((child) => child.close()));
    await page.close();
  }
}
const reply = (route, query) =>
  route.fulfill({
    json: [
      query,
      Array.from({ length: 10 }, (_, i) => `${query} suggestion ${i}`),
    ],
  });
async function waitForSearch(page) {
  await expect
    .poll(() => page.searchResult?.url())
    .toMatch(/^https:\/\/www\.bing\.com\/search/);
  assert.ok(page.url().startsWith('chrome-extension://'));
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await run(
    'translation preserves query and ten suggestions',
    reply,
    async (p) => {
      const text = '你好 & hello # /';
      await p.locator('input').fill(text);
      await expect(p.getByRole('option')).toHaveCount(10);
      await expect(p.locator('.translation-option')).toBeVisible();
      assert.equal(
        await p
          .locator('.search-suggestions')
          .evaluate((el) => getComputedStyle(el).color),
        'rgb(255, 255, 255)',
      );
      await p.locator('.translation-option').click();
      await expect
        .poll(() => p.searchResult?.url())
        .toMatch(/^https:\/\/fanyi\.baidu\.com/);
      const url = new URL(p.searchResult.url());
      assert.equal(url.searchParams.get('query'), text);
      assert.equal(url.searchParams.get('lang'), 'auto2en');
      await expect(p.locator('input')).toHaveValue(text);
    },
  );
  await run(
    'empty input and whitespace never request or navigate',
    reply,
    async (p, requests) => {
      await expect(p.getByRole('button', { name: '开始搜索' })).toBeDisabled();
      await p.locator('input').fill('   ');
      await p.locator('input').press('Enter');
      assert.equal(requests.length, 0);
      await expect(p.getByRole('option')).toHaveCount(0);
    },
  );
  await run(
    'immediate search row; keyboard selection survives incoming results',
    async (r, q) => {
      await delay(350);
      await reply(r, q);
    },
    async (p) => {
      await p.locator('input').fill('fast');
      await expect(p.getByRole('option')).toHaveCount(1);
      await p.locator('input').press('ArrowDown');
      await expect(p.getByRole('option')).toHaveCount(10);
      await expect(p.getByRole('option').first()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await p.locator('input').press('Enter');
      await waitForSearch(p);
      assert.equal(new URL(p.searchResult.url()).searchParams.get('q'), 'fast');
    },
  );
  await run(
    'normalize duplicate suggestions and safely render HTML-like text',
    (r, q) =>
      r.fulfill({
        json: [q, [' a ', 'A', '', null, '<img src=x onerror=alert(1)>', 'a']],
      }),
    async (p) => {
      await p.locator('input').fill('a');
      await expect(p.getByRole('option')).toHaveCount(2);
      await expect(p.getByRole('option').nth(1)).toContainText(
        '<img src=x onerror=alert(1)>',
      );
      assert.equal(await p.locator('.suggestion-list img').count(), 2);
    },
  );
  await run(
    'late old response cannot replace newer results',
    async (r, q) => {
      await delay(q === 'old' ? 350 : 20);
      await reply(r, q);
    },
    async (p, requests) => {
      await p.locator('input').fill('old');
      await expect.poll(() => requests.includes('old')).toBe(true);
      await p.locator('input').fill('new');
      await expect(p.getByRole('option')).toHaveCount(10);
      await delay(400);
      await expect(p.getByRole('option').nth(1)).toContainText(
        'new suggestion',
      );
    },
  );
  await run(
    'clear aborts pending requests, hides popup and retains focus',
    async (r, q) => {
      await delay(250);
      await reply(r, q);
    },
    async (p) => {
      await p.locator('input').fill('clear');
      await p.getByRole('button', { name: '清空搜索' }).click();
      await expect(p.locator('input')).toBeFocused();
      await expect(p.locator('input')).toHaveValue('');
      await delay(300);
      await expect(p.getByRole('option')).toHaveCount(0);
    },
  );
  await run(
    'IME enter confirms composition without searching',
    reply,
    async (p, requests) => {
      const input = p.locator('input');
      await input.dispatchEvent('compositionstart');
      await input.fill('中文输入');
      await input.press('Enter');
      assert.equal(requests.length, 0);
      assert.ok(p.url().startsWith('chrome-extension:'));
      await input.dispatchEvent('compositionend');
      await expect(p.getByRole('option')).toHaveCount(10);
      await input.press('Enter');
      await waitForSearch(p);
      assert.equal(
        new URL(p.searchResult.url()).searchParams.get('q'),
        '中文输入',
      );
    },
  );
  await run(
    'long-query 204 fallback and full-result cache',
    (r, q) =>
      q === '如何使用vue开发浏览器插件的新标签页'
        ? r.fulfill({ status: 204 })
        : reply(r, q),
    async (p, requests) => {
      const text = '如何使用vue开发浏览器插件的新标签页';
      await p.locator('input').fill(text);
      await expect(p.getByText('相关', { exact: true }).first()).toBeVisible();
      const count = requests.length;
      await p.getByRole('button', { name: '清空搜索' }).click();
      await p.locator('input').fill(text);
      await expect(p.getByText('相关', { exact: true }).first()).toBeVisible();
      assert.equal(requests.length, count);
      await p.locator('input').press('Enter');
      await waitForSearch(p);
      assert.equal(new URL(p.searchResult.url()).searchParams.get('q'), text);
    },
  );
  await run(
    'all-empty response keeps direct search and stops after bounded fallbacks',
    (r) => r.fulfill({ status: 204 }),
    async (p, requests) => {
      await p.locator('input').fill('没有联想内容的长句测试');
      await expect(
        p.getByRole('status').filter({ hasText: '暂无更多建议' }),
      ).toBeVisible();
      assert.equal(requests.length, 3);
      await expect(p.getByRole('option')).toHaveCount(1);
    },
  );
  await run(
    'network failure leaves direct search usable',
    (r) => r.abort(),
    async (p) => {
      await p.locator('input').fill('offline');
      await expect(p.getByText('联想暂不可用，仍可直接搜索')).toBeVisible();
      await p.getByRole('button', { name: '开始搜索' }).click();
      await waitForSearch(p);
    },
  );
  await run(
    'malformed response shows recoverable failure',
    (r) => r.fulfill({ body: 'not-json' }),
    async (p) => {
      await p.locator('input').fill('bad');
      await expect(p.getByText('联想暂不可用，仍可直接搜索')).toBeVisible();
      await expect(p.getByRole('option')).toHaveCount(1);
    },
  );
  await run(
    'deadline stops stalled request',
    async (r, q) => {
      await delay(4500);
      await reply(r, q);
    },
    async (p) => {
      await p.locator('input').fill('slow');
      await expect(p.getByText('联想暂不可用，仍可直接搜索')).toBeVisible({
        timeout: 6000,
      });
      await expect(p.getByRole('option')).toHaveCount(1);
    },
  );
  await run(
    'Escape closes; arrow reopens; last option scrolls into view',
    reply,
    async (p) => {
      await p.setViewportSize({ width: 390, height: 700 });
      await p.locator('input').fill('keyboard');
      await expect(p.getByRole('option')).toHaveCount(10);
      await p.locator('input').press('Escape');
      await expect(p.getByRole('option')).toHaveCount(0);
      await p.locator('input').press('ArrowUp');
      await expect(p.getByRole('option').last()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      assert.ok(
        await p.locator('.suggestion-list').evaluate((el) => el.scrollTop > 0),
      );
      await p.locator('input').press('Enter');
      await waitForSearch(p);
      assert.equal(
        new URL(p.searchResult.url()).searchParams.get('q'),
        'keyboard suggestion 8',
      );
    },
  );
  await run(
    'search button uses typed query instead of highlighted suggestion',
    reply,
    async (p) => {
      await p.locator('input').fill('typed');
      await expect(p.getByRole('option')).toHaveCount(10);
      await p.locator('input').press('ArrowUp');
      await p.getByRole('button', { name: '开始搜索' }).click();
      await waitForSearch(p);
      assert.equal(
        new URL(p.searchResult.url()).searchParams.get('q'),
        'typed',
      );
    },
  );
  await run(
    'outside click dismisses and touch selection works on narrow screen',
    reply,
    async (p) => {
      await p.setViewportSize({ width: 320, height: 740 });
      await p.locator('input').fill('touch');
      await expect(p.getByRole('option')).toHaveCount(10);
      await p.locator('.clock-time').click();
      await expect(p.getByRole('option')).toHaveCount(0);
      await p.locator('input').click();
      await expect(p.getByRole('option')).toHaveCount(10);
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await p.screenshot({ path: 'work/search-mobile-regression.png' });
      await p.getByRole('option').nth(2).tap();
      await waitForSearch(p);
      assert.equal(
        new URL(p.searchResult.url()).searchParams.get('q'),
        'touch suggestion 1',
      );
    },
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { passed: passed.length, pageErrors: errors.length },
      null,
      2,
    ),
  );
} finally {
  await context.close();
}
