import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

await mkdir('work', { recursive: true });
const evidence = await mkdtemp(path.resolve('work/workspace-stability-'));
const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext(
  path.join(evidence, 'profile'),
  {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  },
);
context.setDefaultTimeout(10000);
const samples = [],
  durations = [],
  errors = [];
let completed = false;
try {
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  await context.route('https://api.bing.com/**', (r) => r.abort());
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('chrome://newtab');
  const entry = page
    .getByRole('navigation', { name: '快捷 Dock' })
    .getByRole('button', { name: '标签工作区', exact: true });
  const workspace = page.locator('.workspace-overlay');
  const cdp = await context.newCDPSession(page);
  async function cycle() {
    const start = performance.now();
    await entry.click();
    await expect(workspace).toHaveCSS('opacity', '1');
    await page
      .getByRole('searchbox', { name: '搜索工作区' })
      .fill('稳定性检查');
    await page.getByRole('button', { name: '清空工作区搜索' }).click();
    await page.keyboard.press('Escape');
    await expect(workspace).toHaveCount(0);
    await expect(page.locator('.newtab')).toHaveCSS('opacity', '1');
    durations.push(performance.now() - start);
  }
  async function sample(cycles) {
    // Compare retained resources after GC, not temporary allocations during animation.
    await cdp.send('HeapProfiler.collectGarbage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const heap = await cdp.send('Runtime.getHeapUsage');
    samples.push({ cycles, ...dom, usedHeapBytes: heap.usedSize });
  }
  for (let i = 0; i < 3; i++) await cycle();
  await sample(0);
  for (let i = 1; i <= 40; i++) {
    await cycle();
    if (i % 20 === 0) {
      await sample(i);
      console.log(`Measured workspace resources after ${i} cycles`);
    }
  }
  const first = samples[0],
    last = samples.at(-1);
  assert.ok(
    last.nodes <= first.nodes + 100,
    'DOM nodes accumulate after workspace unmount',
  );
  assert.ok(
    last.jsEventListeners <= first.jsEventListeners + 50,
    'Event listeners accumulate after workspace unmount',
  );
  assert.ok(
    last.usedHeapBytes <= first.usedHeapBytes * 1.5 + 5 * 1024 * 1024,
    'Retained heap grows substantially after warmup',
  );
  assert.deepEqual(errors, []);
  completed = true;
  console.log(
    'PASS 40 workspace open/search/close cycles without retained-resource growth beyond local test bounds',
  );
} finally {
  await context.close();
  await writeFile(
    path.join(evidence, 'results.json'),
    JSON.stringify(
      { passed: completed, samples, durationsMs: durations, errors },
      null,
      2,
    ),
  );
  console.log('Evidence: ' + evidence);
}
