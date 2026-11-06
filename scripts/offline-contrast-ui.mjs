import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('work', { recursive: true });
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/offline-contrast-')),
  {
    channel: 'msedge',
    headless: true,
    colorScheme: 'light',
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
  },
);
try {
  let online = false;
  const picture = await readFile('public/images/duoyu.png');
  await context.route('https://api.bimg.cc/**', (r) =>
    online ? r.fulfill({ contentType: 'image/png', body: picture }) : r.abort(),
  );
  const page = await context.newPage();
  await page.goto('chrome://newtab');
  const clock = page.locator('.clock-time');
  const input = page.locator('#search-input');
  await expect(clock).toHaveCSS('color', 'rgb(34, 34, 34)');
  await expect(input).toHaveCSS('color', 'rgb(34, 34, 34)');
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.account-entry img')).toHaveCSS(
    'filter',
    'brightness(0)',
  );
  await expect(page.locator('.newtab .tile-caption').first()).toHaveCSS(
    'color',
    'rgb(34, 34, 34)',
  );
  await page.screenshot({ path: 'work/offline-light-desktop.png' });
  await page.getByRole('button', { name: '标签工作区', exact: true }).click();
  await expect(page.locator('.workspace-board')).toHaveCSS(
    'color',
    'rgb(255, 255, 255)',
  );
  await page.keyboard.press('Escape');
  await expect(clock).toHaveCSS('color', 'rgb(34, 34, 34)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(clock).toHaveCSS('color', 'rgb(243, 241, 255)');
  await expect(input).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(clock).toHaveCSS('color', 'rgb(34, 34, 34)');
  online = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('html')).toHaveAttribute(
    'data-desktop-wallpaper',
    'ready',
  );
  await expect(clock).toHaveCSS('color', 'rgb(243, 241, 255)');
  await expect(input).toHaveCSS('color', 'rgb(255, 255, 255)');
  console.log(
    'PASS offline light foreground/icons, unchanged pure white/black fallback, workspace contrast, live system theme changes and wallpaper recovery',
  );
} finally {
  await context.close();
}
