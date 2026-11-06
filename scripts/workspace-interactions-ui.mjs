import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
await mkdir('work', { recursive: true });
const ext = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  await mkdtemp(path.resolve('work/workspace-interactions-')),
  {
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--load-extension=${ext}`, `--disable-extensions-except=${ext}`],
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
  const input = page.locator('#search-input');
  await input.fill('保留搜索内容');
  const workspace = page.locator('.workspace-overlay');
  const entry = page
    .getByRole('navigation', { name: '快捷 Dock' })
    .getByRole('button', { name: '标签工作区', exact: true });
  await page.getByRole('button', { name: '柔和', exact: true }).click();
  await expect(workspace).toHaveCount(0);
  // Current renderer uses CSS glass; the old WebGL canvas is not mounted.
  async function recordMotion() {
    await page.evaluate(() => {
      window.workspaceFrames = [];
      window.recordWorkspace = true;
      function sample() {
        if (!window.recordWorkspace) return;
        const overlay = document.querySelector('.workspace-overlay');
        window.workspaceFrames.push({
          workspace: overlay ? Number(getComputedStyle(overlay).opacity) : 0,
          content: Number(
            getComputedStyle(document.querySelector('.newtab')).opacity,
          ),
        });
        requestAnimationFrame(sample);
      }
      sample();
    });
  }
  async function verifyMotion() {
    const frames = await page.evaluate(() => {
      window.recordWorkspace = false;
      return window.workspaceFrames;
    });
    for (const key of ['workspace', 'content'])
      assert.ok(
        frames.some((frame) => frame[key] > 0 && frame[key] < 1),
        `${key} must fade through intermediate opacity`,
      );
  }
  await entry.focus();
  await recordMotion();
  await entry.press('Enter');
  await expect(workspace).toBeVisible();
  await expect(page.locator('.newtab')).toHaveCSS('visibility', 'hidden');
  await expect(workspace).toHaveCSS('opacity', '1');
  await verifyMotion();
  await expect(workspace).toHaveCSS('backdrop-filter', 'blur(52px)');
  await expect(page.locator('.newtab')).toHaveAttribute('inert', '');
  await expect(workspace).toBeFocused();
  await page.keyboard.press('Control+f');
  await expect(
    page.getByRole('searchbox', { name: '搜索工作区' }),
  ).toBeFocused();
  assert.deepEqual(await workspace.boundingBox(), {
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
  });
  await expect(page.locator('.account-entry')).toBeVisible();
  await expect(page.locator('.desktop-dock')).toBeVisible();
  const controls = workspace.locator(
    'button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled), a:visible[href], [tabindex="0"]:visible',
  );
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await recordMotion();
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveCount(0);
  await expect(page.locator('.newtab')).toHaveCSS('opacity', '1');
  await verifyMotion();
  await expect(entry).toBeFocused();
  await expect(input).toHaveValue('保留搜索内容');
  await expect(
    page.getByRole('button', { name: '柔和', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await entry.click();
  await expect(workspace).toBeVisible();
  await page
    .getByRole('searchbox', { name: '搜索工作区' })
    .click({ button: 'right' });
  await expect(workspace).toBeVisible();
  await page.mouse.click(1435, 80);
  await expect(workspace).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await entry.click();
  await expect(workspace).toHaveCSS('opacity', '1');
  assert.equal(await workspace.evaluate((el) => el.getAnimations().length), 0);
  await page.keyboard.press('Escape');
  await expect(workspace).toHaveCount(0);
  await expect(page.locator('.newtab')).toHaveCSS('visibility', 'visible');
  assert.deepEqual(errors, []);
  console.log(
    'PASS current Dock keyboard entry, CSS glass, bidirectional fades, background inertness, focus trap/restore, preserved search/style, margin/Escape close and reduced motion',
  );
} finally {
  await context.close();
}
