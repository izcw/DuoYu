import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/webgl-')),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${ext}`,
      `--disable-extensions-except=${ext}`,
      '--enable-unsafe-swiftshader',
    ],
  },
);
try {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#e6c56a"/><stop offset=".45" stop-color="#719840"/><stop offset="1" stop-color="#0d4240"/></linearGradient></defs><path fill="url(#g)" d="M0 0h1920v1080H0z"/><g fill="none" stroke="#c0d37a" stroke-width="16"><path d="M-100 900Q600 350 2000 850"/><path d="M-100 960Q600 410 2000 910"/><path d="M-100 1020Q600 470 2000 970"/><path d="M-100 1080Q600 530 2000 1030"/></g></svg>';
  const stripes =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><pattern id="p" width="67" height="13" patternUnits="userSpaceOnUse"><rect width="67" height="13" fill="#292731"/><path d="M0 2h67M0 9h67" stroke="#aa8876" stroke-width="1.3"/><path d="M0 5h40M48 12h19" stroke="#6a6878" stroke-width="2"/></pattern></defs><rect width="1920" height="1080" fill="url(#p)"/></svg>';
  await context.route('https://api.bimg.cc/**', (r) =>
    r.fulfill({
      contentType: 'image/svg+xml',
      body: process.env.GLASS_TEXTURE === 'stripes' ? stripes : svg,
    }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await page.locator('.widget-link').first().waitFor();
  await expect(page.locator('html')).toHaveClass(/webgl-glass-ready/);
  await expect(page.locator('.wallpaper img')).toHaveClass(/loaded/);
  await page.waitForTimeout(1000);
  const canvas = page.locator('.liquid-glass-canvas');
  const count = await canvas.getAttribute('data-frames');
  await page.waitForTimeout(500);
  assert.equal(
    await canvas.getAttribute('data-frames'),
    count,
    'Idle must not render',
  );
  const screens = [];
  for (const [mode, name] of [
    ['real', '真实'],
    ['natural', '自然'],
    ['soft', '柔和'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(
      page.getByRole('button', { name, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(400);
    screens.push(
      await page.locator('.bottom-widget-grid').screenshot({
        path: `work/webgl-${process.env.GLASS_TEXTURE || 'landscape'}-${mode}.png`,
      }),
    );
  }
  assert(!screens[0].equals(screens[1]) && !screens[1].equals(screens[2]));
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await chrome.storage.local.get('glassMode')).glassMode,
      ),
    )
    .toBe('soft');
  // Record every rendered selection, including the very first DOM insertion.
  await page.addInitScript(() => {
    window.__glassSelections = [];
    new MutationObserver(() => {
      const selected = document.querySelector(
        '.glass-mode-switch [aria-pressed="true"]',
      );
      if (selected)
        window.__glassSelections.push({
          label: selected.textContent.trim(),
          material: document.documentElement.dataset.glassMode,
        });
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-pressed'],
    });
  });
  // Hold cached Blob decoding across refresh to expose the startup race.
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    let released = false;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    window.__releaseWallpaper = () => {
      released = true;
      release();
    };
    HTMLImageElement.prototype.decode = async function () {
      if (this.src.startsWith('blob:') && !released) {
        window.__wallpaperWaiting = true;
        await gate;
      }
      return decode.call(this);
    };
  });
  await page.reload();
  await page.waitForFunction(() => window.__wallpaperWaiting);
  await page.locator('.liquid-glass-canvas').waitFor({ state: 'attached' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-wallpaper-preview',
    'ready',
  );
  await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
  });
  await expect(page.locator('html')).not.toHaveClass(/webgl-glass-ready/);
  await expect(canvas).toHaveCSS('visibility', 'hidden');
  assert.equal(
    await canvas.getAttribute('data-frames'),
    null,
    'No synthetic GPU frame before wallpaper',
  );
  assert.notEqual(
    await page
      .locator('.search-box')
      .evaluate((el) => getComputedStyle(el).backdropFilter),
    'none',
  );
  await page.evaluate(() => window.__releaseWallpaper());
  await expect(page.locator('html')).toHaveClass(/webgl-glass-ready/);
  await expect(canvas).toHaveCSS('visibility', 'visible');
  await expect(page.locator('.search-box')).toHaveCSS(
    'backdrop-filter',
    'none',
  );
  console.log(
    'PASS delayed cached wallpaper keeps CSS glass over preview until first real GPU frame',
  );
  await page.locator('.widget-link').first().waitFor();
  await expect(
    page.getByRole('button', { name: '柔和', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(900);
  const selections = await page.evaluate(() => window.__glassSelections);
  assert(selections.length > 0);
  assert(
    selections.every(
      ({ label, material }) => label === '柔和' && material === 'soft',
    ),
    'Saved selection and material must match from the first render',
  );
  console.log(
    'PASS saved glass selection and material render correctly from first DOM insertion',
  );
  console.log(
    'PASS WebGL compiled, wallpaper uploaded, three distinct modes, saved preference, zero idle frames',
  );
  const allocation = await canvas.evaluate((c) => ({
    pixels: c.width * c.height,
    full: innerWidth * innerHeight * devicePixelRatio ** 2,
    dpr: c.width / parseFloat(c.style.width),
  }));
  assert(Math.abs(allocation.dpr - 2) < 0.01, 'Keep native DPR');
  const bounds = await page.locator('[data-liquid-card]').evaluateAll((els) => {
    const rects = els.map((el) => el.getBoundingClientRect());
    const left = Math.max(
      0,
      Math.floor(Math.min(...rects.map((r) => r.left)) / 64) * 64,
    );
    const top = Math.max(
      0,
      Math.floor(Math.min(...rects.map((r) => r.top)) / 64) * 64,
    );
    const right = Math.min(
      innerWidth,
      Math.ceil(Math.max(...rects.map((r) => r.right)) / 64) * 64,
    );
    const bottom = Math.min(
      innerHeight,
      Math.ceil(Math.max(...rects.map((r) => r.bottom)) / 64) * 64,
    );
    return (right - left) * (bottom - top) * devicePixelRatio ** 2;
  });
  assert.equal(allocation.pixels, bounds, 'Crop to the search and card bounds');
  assert(
    allocation.pixels < allocation.full,
    'Do not allocate a full-screen surface',
  );
  await expect(page.locator('.search-box')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(page.locator('.search-box')).toHaveCSS(
    'border-top-left-radius',
    '26px',
  );
  const unchanged = await canvas.getAttribute('data-frames');
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(800, 400, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(
    await canvas.getAttribute('data-frames'),
    unchanged,
    'Unrelated pointer movement must not redraw glass',
  );
  const perf = await page.evaluate(async () => {
    const gaps = [];
    const card = document.querySelector(
      '.bottom-widget-grid > .grid-stack-item',
    );
    const canvas = document.querySelector('.liquid-glass-canvas');
    const frames = Number(canvas.dataset.frames);
    let previous = performance.now();
    for (let i = 0; i < 40; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      gaps.push(now - previous);
      previous = now;
      card.style.transform = `translateY(${-20 * Math.sin(i / 12)}px)`;
    }
    card.style.transform = '';
    return {
      median: gaps.sort((a, b) => a - b)[20],
      p95: gaps[38],
      draws: Number(canvas.dataset.frames) - frames,
    };
  });
  assert(perf.draws > 25, 'Measure actual moving-card draws');
  console.log('Native DPR and cropped allocation', allocation);
  console.log('Frame intervals (headless/software GPU)', perf);
  await page.waitForTimeout(600);
  const stopped = await canvas.getAttribute('data-frames');
  await page.waitForTimeout(400);
  assert.equal(await canvas.getAttribute('data-frames'), stopped);
  await page.evaluate(() => {
    const c = document.querySelector('.liquid-glass-canvas');
    c.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
  });
  await expect(page.locator('html')).not.toHaveClass(/webgl-glass-ready/);
  await expect(page.locator('.widget-link').first()).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS stops after movement and gracefully falls back after context loss',
  );
} finally {
  await context.close();
}
