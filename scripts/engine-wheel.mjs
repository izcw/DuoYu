import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/engine-tests-')),
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
await context.route('https://api.bimg.cc/**', (r) => r.abort());
await context.route('https://api.bing.com/**', (r) =>
  r.fulfill({ json: ['test', ['test one', 'test two']] }),
);
await context.route(
  /https:\/\/(www\.(bing|google|baidu)\.com|github\.com|yandex\.com)\/(search|s)\/?\?/,
  (r) =>
    r.fulfill({
      body: '<title>Search target</title>',
      contentType: 'text/html',
    }),
);
const errors = [];
const page = await context.newPage();
page.on('pageerror', (error) => {
  if (page.url().startsWith('chrome-extension:')) errors.push(error.message);
});
const trigger = page.locator('.engine-trigger');
async function opened() {
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(470);
  const box = await page.locator('.search-box').boundingBox();
  const selector = await page.locator('.engine-selector').boundingBox();
  assert.equal(selector.width, box.height);
  assert.equal(selector.height, box.height);
  assert.equal(await page.locator('.engine-arc').count(), 0);
  assert.equal(
    await page
      .locator('.engine-wheel')
      .evaluate((el) => getComputedStyle(el).clipPath),
    'none',
  );
  const marker = await page
    .locator('.engine-wheel .radial-marker span')
    .boundingBox();
  const selected = await page.locator('[aria-checked=true]').boundingBox();
  const cx = selector.x + selector.width / 2;
  const cy = selector.y + selector.height / 2;
  const dx = selected.x + selected.width / 2 - cx;
  const dy = selected.y + selected.height / 2 - cy;
  const mx = marker.x + marker.width / 2 - cx;
  const my = marker.y + marker.height / 2 - cy;
  assert.ok(
    Math.abs(dx * my - dy * mx) < 1,
    'Marker must align with the inward radius',
  );
  assert.ok(
    Math.hypot(mx, my) < Math.hypot(dx, dy),
    'Marker must sit between icon and selector',
  );
  for (const option of await page.getByRole('menuitemradio').all()) {
    const rect = await option.boundingBox();
    assert.ok(
      rect.x + rect.width <= box.x,
      `Engine overlaps search box: ${JSON.stringify({ rect, box })}`,
    );
  }
}
async function searchAndCheck(host, key) {
  const text = '多鱼 & vue #插件';
  // Observe the requested URL before a provider may redirect to consent/CAPTCHA.
  // The native method still runs, so each assertion also requires a real new tab.
  await page.evaluate(() => {
    if (window.__observingTabs) return;
    window.__observingTabs = true;
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = (properties, ...rest) => {
      window.__requestedSearch = properties.url;
      return create(properties, ...rest);
    };
  });
  await page.locator('input').fill(text);
  const created = context.waitForEvent('page');
  await page.locator('input').press('Enter');
  const target = await created;
  const requested = new URL(
    await page.evaluate(() => window.__requestedSearch),
  );
  assert.equal(requested.hostname, host);
  assert.equal(requested.searchParams.get(key), text);
  assert.ok(page.url().startsWith('chrome-extension:'));
  await expect(page.locator('input')).toHaveValue(text);
  await target.close();
}
try {
  await page.goto('chrome://newtab');
  await trigger.waitFor();
  await expect(page.locator('input')).toBeFocused();
  // This checks DOM focus in headless Chromium only. It cannot verify whether
  // a visible browser's omnibox retains keyboard focus after Ctrl+T.
  const createdTab = context.waitForEvent('page');
  await page.evaluate(() => chrome.tabs.create({ active: true }));
  const freshTab = await createdTab;
  await freshTab.locator('input').waitFor();
  await expect(freshTab.locator('input')).toBeFocused();
  assert.equal(await freshTab.evaluate(() => document.hasFocus()), true);
  await freshTab.keyboard.type('new tab focus');
  await expect(freshTab.locator('input')).toHaveValue('new tab focus');
  await freshTab.reload();
  await expect(freshTab.locator('input')).toBeFocused();
  await freshTab.keyboard.type('refresh focus');
  await expect(freshTab.locator('input')).toHaveValue('refresh focus');
  await freshTab.close();
  await expect(trigger).toHaveAttribute(
    'aria-label',
    '切换搜索引擎，当前 Bing',
  );
  await searchAndCheck('www.bing.com', 'q');
  await opened();
  await expect(page.getByRole('menuitemradio')).toHaveCount(5);
  assert.deepEqual(
    await page
      .getByRole('menuitemradio')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute('aria-label')),
      ),
    ['Bing', 'Google', '百度', 'GitHub', 'Yandex'],
  );
  const orderedRects = await Promise.all(
    (await page.getByRole('menuitemradio').all()).map((item) =>
      item.boundingBox(),
    ),
  );
  assert.ok(
    orderedRects.every((rect, i) => i === 0 || rect.y > orderedRects[i - 1].y),
  );
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.screenshot({ path: 'work/engine-wheel-desktop.png' });
  await page
    .getByRole('menuitemradio', { name: 'Google', exact: true })
    .click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(60);
  const closing = await page
    .locator('.engine-wheel .radial-choice')
    .first()
    .evaluate((el) => ({
      opacity: +getComputedStyle(el.parentElement).opacity,
      visibility: getComputedStyle(el).visibility,
    }));
  assert.ok(
    closing.opacity > 0 && closing.opacity < 1,
    JSON.stringify(closing),
  );
  assert.equal(closing.visibility, 'visible');
  await expect(page.locator('.engine-wheel')).toBeHidden();
  await expect(trigger).toHaveAttribute(
    'aria-label',
    '切换搜索引擎，当前 Google',
  );
  await searchAndCheck('www.google.com', 'q');
  await page.reload();
  await expect(page.locator('input')).toBeFocused();
  await expect(trigger).toHaveAttribute(
    'aria-label',
    '切换搜索引擎，当前 Google',
  );
  for (const [name, host, key] of [
    ['百度', 'www.baidu.com', 'wd'],
    ['GitHub', 'github.com', 'q'],
    ['Yandex', 'yandex.com', 'text'],
  ]) {
    await opened();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    await expect(page.locator('.engine-wheel')).toBeHidden();
    await searchAndCheck(host, key);
  }
  // Hold the pivot, drag to an option, and release without clicking that option.
  const pivot = await trigger.boundingBox();
  // Off-center movement inside the trigger must not preview or select an engine.
  await page.mouse.move(
    pivot.x + pivot.width / 2 - 8,
    pivot.y + pivot.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(400);
  await expect(page.locator('.engine-wheel .radial-marker')).toHaveAttribute(
    'data-target',
    'yandex',
  );
  await page.mouse.move(
    pivot.x + pivot.width / 2,
    pivot.y + pivot.height / 2 - 12,
  );
  await expect(page.locator('.engine-wheel .radial-marker')).toHaveAttribute(
    'data-target',
    'yandex',
  );
  await expect(page.locator('.drag-hovered')).toHaveCount(0);
  await page.mouse.up();
  await expect(trigger).toHaveAttribute(
    'aria-label',
    '切换搜索引擎，当前 Yandex',
  );
  await expect(page.locator('.engine-wheel')).toBeHidden();
  await page.mouse.move(pivot.x + pivot.width / 2, pivot.y + pivot.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const google = page.getByRole('menuitemradio', {
    name: 'Google',
    exact: true,
  });
  const googleRect = await google.boundingBox();
  await page.mouse.move(
    (pivot.x + pivot.width / 2) * 0.45 +
      (googleRect.x + googleRect.width / 2) * 0.55,
    (pivot.y + pivot.height / 2) * 0.45 +
      (googleRect.y + googleRect.height / 2) * 0.55,
  );
  await expect(google).toHaveClass(/is-marked/);
  assert.equal(
    await page
      .locator('.engine-wheel .radial-marker span')
      .evaluate((el) => el.parentElement.dataset.target),
    'google',
  );
  await page.mouse.up();
  await expect(trigger).toHaveAttribute(
    'aria-label',
    '切换搜索引擎，当前 Google',
  );
  await expect(page.locator('.engine-wheel')).toBeHidden();
  // Even outside the icon hit boxes, releasing selects the nearest engine.
  await page.mouse.move(pivot.x + pivot.width / 2, pivot.y + pivot.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  const nearestName = await page.getByRole('menuitemradio').evaluateAll(
    (items) =>
      items
        .map((item) => {
          const rect = item.getBoundingClientRect();
          return {
            name: item.getAttribute('aria-label'),
            distance: Math.hypot(
              rect.x + rect.width / 2 - 10,
              rect.y + rect.height / 2 - 10,
            ),
          };
        })
        .sort((a, b) => a.distance - b.distance)[0].name,
  );
  await page.mouse.move(10, 10);
  await expect(
    page.getByRole('menuitemradio', { name: nearestName, exact: true }),
  ).toHaveClass(/is-marked/);
  await page.mouse.up();
  await expect(page.locator('.engine-wheel')).toBeHidden();
  await expect(trigger).toHaveAttribute(
    'aria-label',
    `切换搜索引擎，当前 ${nearestName}`,
  );
  // Rapid toggles reverse transitions rather than leaving an invisible overlay.
  await trigger.click();
  await page.waitForTimeout(70);
  await trigger.click();
  await page.waitForTimeout(70);
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(470);
  await trigger.press('Escape');
  await expect(page.locator('.engine-wheel')).toBeHidden();
  await trigger.press('ArrowDown');
  await expect(
    page.getByRole('menuitemradio', { name: 'Bing', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('End');
  await expect(
    page.getByRole('menuitem', { name: '添加搜索引擎', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.engine-wheel .radial-marker')).toHaveAttribute(
    'data-target',
    'add',
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.engine-wheel')).toBeHidden();
  // The same persistent dot follows an arc, including the add action.
  await trigger.click();
  await page.waitForTimeout(200);
  await page.locator('.engine-wheel .radial-marker span').evaluate((el) => {
    window.__markerNode = el;
  });
  const add = page.getByRole('menuitem', { name: '添加搜索引擎', exact: true });
  await add.hover();
  await page.waitForTimeout(50);
  const arc = await page.evaluate(() => {
    const marker = document.querySelector('.engine-wheel .radial-marker span');
    const m = marker.getBoundingClientRect();
    const pivot = document
      .querySelector('.engine-selector')
      .getBoundingClientRect();
    return {
      same: marker === window.__markerNode,
      radius: Math.hypot(
        m.x + m.width / 2 - pivot.x - pivot.width / 2,
        m.y + m.height / 2 - pivot.y - pivot.height / 2,
      ),
      target: marker.parentElement.dataset.target,
    };
  });
  assert.equal(arc.same, true);
  assert.equal(arc.target, 'add');
  assert.ok(Math.abs(arc.radius - 96) < 1);
  await add.click();
  await expect(page.locator('.engine-wheel')).toBeHidden();
  await page.setViewportSize({ width: 320, height: 740 });
  await opened();
  for (const option of await page.getByRole('menuitemradio').all()) {
    const rect = await option.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 320);
  }
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: 'work/engine-wheel-mobile.png' });
  await page.getByRole('menuitemradio', { name: 'Bing', exact: true }).tap();
  await expect(trigger).toHaveAttribute(
    'aria-label',
    '切换搜索引擎，当前 Bing',
  );
  await expect(page.locator('.engine-wheel')).toBeHidden();
  await opened();
  await page.locator('.clock-time').click();
  await expect(page.locator('.engine-wheel')).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await opened();
  await trigger.click();
  await expect(page.locator('.engine-wheel')).toBeHidden();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        engines: 5,
        newTabs: true,
        reverseAnimation: closing,
        persistence: true,
        keyboard: true,
        mobile: true,
        reducedMotion: true,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
}
