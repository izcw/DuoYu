import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('work', { recursive: true });
const evidence = await mkdtemp(path.resolve('work/browser-compatibility-'));
const extension = path.resolve(
    process.env.TEST_EXTENSION_PATH || '.output/chrome-mv3',
  ),
  results = [];
async function checkBackupKeyboard(page) {
  const entry = page.getByRole('button', { name: '登录多鱼账号', exact: true });
  await entry.focus();
  await page.keyboard.press('Enter');
  const parent = page.getByRole('dialog', { name: '设置', exact: true });
  const tabTo = async (locator) => {
    for (let n = 0; n < 20; n++) {
      if (await locator.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press('Tab');
    }
    await expect(locator).toBeFocused();
  };
  await tabTo(parent.getByRole('button', { name: '备份与恢复', exact: true }));
  await page.keyboard.press('Enter');
  const opener = parent.getByRole('button', { name: '导入备份', exact: true });
  await tabTo(opener);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: '导入JSON文件',
    exact: true,
  });
  const close = dialog.getByRole('button', { name: '关闭', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: '取消', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  const option = dialog.getByRole('checkbox', {
    name: '同时导入设置和自定义壁纸',
    exact: true,
  });
  await tabTo(option);
  await page.keyboard.press('Space');
  await expect(option).toBeChecked();
  await expect(
    dialog.getByRole('button', { name: '导入数据', exact: true }),
  ).toBeDisabled();
  const bounds = await dialog.boundingBox(),
    viewport = page.viewportSize();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(parent).toHaveCount(0);
  await expect(entry).toBeFocused();
}
for (const channel of ['msedge', 'chrome']) {
  let context;
  let loadedId;
  try {
    context = await chromium.launchPersistentContext(
      path.join(evidence, channel),
      {
        channel,
        headless: true,
        colorScheme: 'light',
        ignoreDefaultArgs: ['--disable-extensions'],
        args:
          channel === 'chrome'
            ? ['--enable-unsafe-extension-debugging']
            : [
                `--load-extension=${extension}`,
                `--disable-extensions-except=${extension}`,
              ],
      },
    );
    if (channel === 'chrome') {
      const session = await context.browser().newBrowserCDPSession();
      loadedId = (
        await session.send('Extensions.loadUnpacked', { path: extension })
      ).id;
      await session.detach();
    }
    context.setDefaultTimeout(10000);
    await context.route('https://api.bimg.cc/**', (r) => r.abort());
    await context.route('https://api.bing.com/**', (r) =>
      r.fulfill({ json: ['compatibility', ['compatibility test']] }),
    );
    // CDP returns the unpacked ID before Chrome has necessarily registered its
    // extension process. Wait for that specific MV3 worker before navigating.
    const matchesWorker = (worker) =>
      !loadedId || new URL(worker.url()).host === loadedId;
    const worker =
      context.serviceWorkers().find(matchesWorker) ||
      (await context.waitForEvent('serviceworker', {
        predicate: matchesWorker,
        timeout: 10000,
      }));
    const id = loadedId || new URL(worker.url()).host,
      page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`chrome-extension://${id}/newtab.html`);
      await expect(page.locator('#search-input')).toBeVisible();
      await page.locator('#search-input').fill('compatibility');
      await expect(page.getByRole('option').first()).toContainText(
        'compatibility',
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: path.join(evidence, `${channel}-${width}.png`),
      });
      await checkBackupKeyboard(page);
    }
    expect(errors).toEqual([]);
    const capabilities = await page.evaluate(() => ({
      tabs: typeof chrome.tabs.query,
      tabGroups: typeof chrome.tabGroups.query,
      identity: typeof chrome.identity.launchWebAuthFlow,
    }));
    expect(
      Object.values(capabilities).every((value) => value === 'function'),
    ).toBe(true);
    const authentication = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
    );
    expect(authentication?.view?.account).toBe(null);
    const anonymousSync = await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: 'duoyu-auth',
        action: 'sync',
        path: '/api/v1/sync/snapshot',
      }),
    );
    expect(anonymousSync.status).toBe(401);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(popup.getByRole('main', { name: '多鱼' })).toBeVisible();
    const ignored = await popup.evaluate(async () => {
      const messages = [
        { type: 'duoyu-auth', action: 'status' },
        { type: 'duoyu-auth', action: 'logout' },
        { type: 'duoyu-auth', action: 'sync', path: '/api/v1/sync/snapshot' },
        { type: 'website-title', url: 'file:///invalid' },
        { type: 'website-icon', url: 'file:///invalid' },
      ];
      for (const message of messages) {
        try {
          const response = await chrome.runtime.sendMessage(message);
          if (response != null)
            throw Error('Popup received a privileged response');
        } catch (error) {
          if (
            !/message port closed|receiving end does not exist/i.test(
              error.message,
            )
          )
            throw error;
        }
      }
      return messages.length;
    });
    await popup.close();
    results.push({
      channel,
      passed: true,
      capabilities,
      anonymousSyncStatus: anonymousSync.status,
      popupMessagesIgnored: ignored,
    });
    console.log(
      `PASS ${channel}: MV3 worker, search, desktop/mobile and required extension APIs`,
    );
  } catch (error) {
    results.push({ channel, passed: false, error: error.message });
    console.log(`FAIL ${channel}: ${error.message}`);
  } finally {
    await context?.close();
  }
}
await writeFile(
  path.join(evidence, 'results.json'),
  JSON.stringify(results, null, 2),
);
console.log('Evidence: ' + evidence);
if (results.some((result) => !result.passed)) process.exitCode = 1;
