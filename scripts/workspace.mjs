import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/workspace-')),
  {
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${ext}`,
      `--disable-extensions-except=${ext}`,
      '--enable-unsafe-swiftshader',
    ],
  },
);
try {
  const image = await readFile('public/images/duoyu.png');
  await context.route('https://api.bimg.cc/**', (r) =>
    r.fulfill({ contentType: 'image/png', body: image }),
  );
  await context.route('https://api.bing.com/**', (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('chrome://newtab');
  await expect(page.locator('html')).toHaveClass(/webgl-glass-ready/);
  await expect(page.locator('.widget-link').first()).toBeVisible();
  async function recordMotion() {
    await page.evaluate(() => {
      window.__workspaceFrames = [];
      window.__recordWorkspace = true;
      function sample() {
        if (!window.__recordWorkspace) return;
        const workspace = document.querySelector('.workspace-overlay');
        window.__workspaceFrames.push({
          workspace: workspace
            ? Number(getComputedStyle(workspace).opacity)
            : 0,
          content: Number(
            getComputedStyle(document.querySelector('.newtab')).opacity,
          ),
          canvas: Number(
            getComputedStyle(document.querySelector('.liquid-glass-canvas'))
              .opacity,
          ),
        });
        requestAnimationFrame(sample);
      }
      sample();
    });
  }
  async function verifyMotion() {
    const frames = await page.evaluate(() => {
      window.__recordWorkspace = false;
      return window.__workspaceFrames;
    });
    for (const key of ['workspace', 'content', 'canvas']) {
      assert(
        frames.some((frame) => frame[key] > 0 && frame[key] < 1),
        `${key} must fade through intermediate opacity`,
      );
    }
  }
  const workspace = page.locator('.workspace-overlay');
  const input = page.locator('.search-box input');
  await input.fill('保留搜索内容');
  await page.locator('.clock-time').click();
  await expect(workspace).toHaveCount(0);
  await page
    .locator('.widget-card')
    .first()
    .click({ position: { x: 280, y: 140 } });
  await expect(workspace).toHaveCount(0);
  await page.getByRole('button', { name: '柔和', exact: true }).click();
  await expect(workspace).toHaveCount(0);
  await page.mouse.move(40, 450);
  await page.mouse.down();
  await page.mouse.move(100, 500, { steps: 6 });
  await page.mouse.up();
  await expect(workspace).toHaveCount(0);
  await page.mouse.click(40, 450, { button: 'right' });
  await expect(
    page.locator('.wallpaper-wheel .radial-choice').first(),
  ).toBeVisible();
  await expect(workspace).toHaveCount(0);
  // Hold the left button until the wheel's exit animation has completed.
  // Its state at pointerdown must still suppress the eventual click.
  await page.mouse.move(1000, 450);
  await page.mouse.down();
  await expect(page.locator('.wallpaper-wheel')).not.toHaveClass(/is-open/);
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(workspace).toHaveCount(0);
  await page.locator('.engine-trigger').click();
  await expect(page.locator('.engine-wheel')).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  await page.mouse.move(1000, 450);
  await page.mouse.down();
  await expect(page.locator('.engine-wheel')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect(workspace).toHaveCount(0);
  await recordMotion();
  await page.mouse.click(1000, 450);
  await expect(workspace).toBeVisible();
  await expect(page.locator('.newtab')).toBeHidden();
  await expect(page.locator('.liquid-glass-canvas')).toBeHidden();
  await verifyMotion();
  await expect(workspace).toHaveCSS(
    'backdrop-filter',
    'blur(20px) saturate(1.1)',
  );
  assert.match(
    await workspace.evaluate((el) => getComputedStyle(el).backgroundImage),
    /linear-gradient/,
  );
  await expect(page.locator('.wallpaper img')).toBeVisible();
  await expect(workspace).toBeFocused();
  assert.deepEqual(await workspace.boundingBox(), {
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
  });
  await page.mouse.click(100, 500, { button: 'right' });
  await expect(workspace).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('.workspace-board :focus')).toHaveCount(1);
  await recordMotion();
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveCount(0);
  await verifyMotion();
  await expect(page.locator('.newtab')).toBeVisible();
  await expect(input).toHaveValue('保留搜索内容');
  await expect(
    page.getByRole('button', { name: '柔和', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(1000, 450);
  await expect(workspace).toBeVisible();
  await page.mouse.click(8, 450);
  await expect(workspace).toHaveCount(0);
  await expect(page.locator('.liquid-glass-canvas')).toBeVisible();
  await page.mouse.click(40, 450, { button: 'right' });
  await expect(
    page.locator('.wallpaper-wheel .radial-choice').first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.click(1000, 450);
  await expect(workspace).toBeVisible();
  await expect(page.locator('.newtab')).toBeHidden();
  assert.equal(await workspace.evaluate((el) => el.getAnimations().length), 0);
  await page.mouse.click(8, 450);
  await expect(workspace).toHaveCount(0);
  await expect(page.locator('.newtab')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS shared glass material, intermediate opacity in both directions, interrupted enter and reduced motion',
  );
  console.log(
    'PASS shortcut and engine wheels consume the closing click before workspace activation',
  );
  console.log(
    'PASS blank click workspace, full viewport, hidden components/WebGL, excluded controls and drags, click/Esc restore state, right wheel preserved',
  );
} finally {
  await context.close();
}
