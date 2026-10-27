import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/grid-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1920, height: 1800 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
      '--enable-unsafe-swiftshader',
    ],
  },
);
try {
  await context.route('https://api.bimg.cc/**', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1000"><defs><pattern id="p" width="30" height="30" patternUnits="userSpaceOnUse"><rect width="30" height="30" fill="#b68c59"/><rect width="15" height="15" fill="#3f584b"/></pattern></defs><rect width="1440" height="1000" fill="url(#p)"/></svg>',
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page
    .locator('[data-library-page-id="library-demo"]')
    .waitFor({ state: 'attached' });

  await page.waitForTimeout(700);
  await expect(page.locator('.liquid-glass-canvas')).toHaveCount(0);
  async function checkSurfaces() {
    const values = await page.locator('.search-box, .desktop-card-glass').evaluateAll(els => els.filter(el => el.getBoundingClientRect().width).map(el => ({filter:getComputedStyle(el).backdropFilter, before:getComputedStyle(el,'::before').backgroundImage, background:getComputedStyle(el).backgroundImage})));
    assert.ok(values.length > 1);
    for(const value of values) { assert.match(value.filter,/blur/); assert.equal(value.before,'none'); assert.ok(!value.background.includes('url(')); }
  }
  await checkSurfaces();
  await page.mouse.move(900,400);await page.mouse.wheel(0,180);await page.waitForTimeout(800);
  await page.locator('[data-library-page-id="library-demo"] button').click();
  await page.waitForTimeout(700);
  await expect(page.locator('.desktop-library-backdrop')).toHaveClass(/visible/);
  await checkSurfaces();
  for(const label of ['自然','柔和','真实']) {
    await page.getByRole('button',{name:label,exact:true}).click();
    await checkSurfaces();
  }
  await page.screenshot({path:'work/local-backdrop.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS surfaces use local backdrop on home and collection, no original-wallpaper layers, all material modes');
} finally { await context.close(); }
