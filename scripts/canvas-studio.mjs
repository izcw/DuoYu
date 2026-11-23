import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const extension = path.resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext('', {
  channel: 'msedge',
  headless: true,
  viewport: { width: 1440, height: 900 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    '--load-extension=' + extension,
    '--disable-extensions-except=' + extension,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const url =
    'chrome-extension://' + new URL(worker.url()).host + '/newtab.html';
  await context.setOffline(true);
  const page = await context.newPage();
  if (process.env.CANVAS_TEST_WALLPAPER) {
    const wallpaper = await readFile(process.env.CANVAS_TEST_WALLPAPER);
    await context.route('https://api.bimg.cc/**', (route) =>
      route.fulfill({ contentType: 'image/jpeg', body: wallpaper }),
    );
  }
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const button = (name) => page.getByRole('button', { name, exact: true });
  const open = async () => {
    await page.goto(url);
    await button('画布').click();
    await expect(page.locator('.canvas-paper')).toBeVisible();
  };
  await open();
  await button('新建画布').click();
  await expect(
    page
      .locator('dialog[open], [role=dialog]')
      .filter({ hasText: /登录/ })
      .last(),
  ).toBeVisible();
  const account = {
    issuer: 'https://fixture.invalid',
    sub: 'canvas-studio',
    name: '画布测试',
  };
  const owner = createHash('sha256')
    .update(account.issuer + '\0' + account.sub)
    .digest('hex');
  await context.addInitScript(
    ({ account, owner }) => {
      localStorage.setItem('duoyu-sync-account', owner);
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message) =>
        message.type === 'duoyu-auth' && message.action === 'status'
          ? Promise.resolve({ view: { account } })
          : send(message);
    },
    { account, owner },
  );
  await open();
  const canvas = page.locator('.canvas-paper canvas').first();
  const thumbnail = page.locator('.canvas-card[aria-pressed=true] canvas');
  const inspector = page.getByRole('complementary', { name: '工具属性' });
  const toolbar = inspector.getByRole('toolbar', { name: '绘图工具' });
  const viewControl = (name) =>
    inspector.getByRole('button', { name, exact: true });
  const tool = (name) => toolbar.getByRole('button', { name, exact: true });
  const toolNames = ['画笔', '图形', '箭头', '文字', '橡皮擦', '贴图', '平移'];
  await expect(toolbar.getByRole('button')).toHaveCount(toolNames.length);
  for (const name of toolNames) {
    await expect(tool(name)).toBeVisible();
    await expect(button(name)).toHaveCount(1);
  }
  const studio = page.locator('.canvas-studio');
  async function checkOverlay(control) {
    const paper = await canvas.boundingBox(),
      overlay = await control.boundingBox();
    assert.ok(
      overlay &&
        overlay.x >= paper.x - 1 &&
        overlay.y >= paper.y - 1 &&
        overlay.x + overlay.width <= paper.x + paper.width + 1 &&
        overlay.y + overlay.height <= paper.y + paper.height + 1,
      'floating controls must be on top of the drawing surface',
    );
  }
  async function checkViewTools() {
    await checkOverlay(inspector);
    const paper = await canvas.boundingBox(),
      panel = await inspector.boundingBox();
    assert.ok(
      panel.x + panel.width / 2 > paper.x + paper.width / 2,
      'tools open on the right',
    );
    for (const name of ['缩小', '放大', '适合窗口']) {
      await expect(viewControl(name)).toBeVisible();
      await expect(button(name)).toHaveCount(1);
    }
    await expect(inspector.getByLabel('缩放比例', { exact: true })).toHaveText(
      /%/,
    );
  }
  await checkOverlay(button('画布设置'));
  await checkViewTools();
  await expect(studio.getByText('无限画布', { exact: true })).toHaveCount(0);
  await expect(studio.locator('.canvas-hint')).toHaveCount(0);
  await expect(studio.getByText(/拖动绘制.*空格平移/)).toHaveCount(0);
  const captionColor = (theme) =>
    process.env.CANVAS_TEST_WALLPAPER
      ? 'rgb(255, 255, 255)'
      : theme === 'dark'
        ? 'rgb(242, 242, 244)'
        : 'rgb(34, 34, 34)';
  if (process.env.CANVAS_TEST_WALLPAPER) {
    await expect(page.locator('html')).toHaveAttribute(
      'data-desktop-wallpaper',
      'ready',
    );
  }
  for (const mode of ['dark', 'light']) {
    await page.getByLabel('主题', { exact: true }).selectOption(mode);
    await expect(page.locator('.canvas-studio')).toHaveCSS(
      'color',
      captionColor(mode),
    );
    await button('画布设置').click();
    const settings = page.getByRole('dialog', {
      name: '画布设置',
      exact: true,
    });
    await expect(settings).toHaveCSS('backdrop-filter', /blur\(/);
    await expect(settings.locator('.canvas-form')).toHaveCSS(
      'color',
      captionColor(mode),
    );
    await settings.getByRole('button', { name: '取消' }).click();
    for (const selector of [
      '.canvas-studio',
      '.canvas-viewport',
      '.canvas-library',
    ]) {
      await expect(page.locator(selector)).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await expect(page.locator(selector)).toHaveCSS(
        'background-image',
        'none',
      );
    }
    await expect(page.locator('.canvas-inspector')).toHaveCSS(
      'backdrop-filter',
      /blur\(/,
    );
    await expect(page.locator('.canvas-paper')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
  }
  const rgba = (element, x, y) =>
    element.evaluate(
      (el, [x, y]) => {
        return [
          ...el
            .getContext('2d')
            .getImageData(
              Math.floor(el.width * x),
              Math.floor(el.height * y),
              1,
              1,
            ).data,
        ];
      },
      [x, y],
    );
  // Express test gestures within uncovered paper. Camera coordinates and
  // renderer pixels still refer to the entire paper beneath the controls.
  async function drawingArea() {
    const paper = await canvas.boundingBox();
    const header = await page.locator('.canvas-document').boundingBox();
    const panel = (await inspector.isVisible())
      ? await inspector.boundingBox()
      : null;
    const top = Math.max(
      0,
      (header.y + header.height - paper.y + 8) / paper.height,
    );
    const right = panel
      ? Math.min(1, (panel.x - paper.x - 8) / paper.width)
      : 1;
    assert.ok(
      right > 0.3 && top < 0.4,
      'unobstructed paper is available for drawing',
    );
    return { top, right };
  }
  let area = await drawingArea();
  const pointOnPaper = (x, y) => ({
    x: x * area.right,
    y: area.top + y * (1 - area.top),
  });
  const screen = async (x, y) => {
    const r = await canvas.boundingBox();
    const point = pointOnPaper(x, y);
    const mouse = { x: r.x + r.width * point.x, y: r.y + r.height * point.y };
    assert.ok(
      await page.evaluate(
        (p) =>
          !!document.elementFromPoint(p.x, p.y)?.closest('.canvas-viewport'),
        mouse,
      ),
      'drawing input must reach the viewport',
    );
    return mouse;
  };
  async function drag(x, y, u, v) {
    const a = await screen(x, y),
      b = await screen(u, v);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
  }
  async function tap(x, y) {
    const p = await screen(x, y);
    await page.mouse.click(p.x, p.y);
  }
  const at = (x, y) => {
    const point = pointOnPaper(x, y);
    return rgba(canvas, point.x, point.y);
  };
  const view = () =>
    page.locator('.canvas-viewport').evaluate((el) => ({
      x: Number(el.dataset.viewX),
      y: Number(el.dataset.viewY),
      width: Number(el.dataset.viewWidth),
      height: Number(el.dataset.viewHeight),
    }));
  async function world(x, y) {
    const r = await view();
    const point = pointOnPaper(x, y);
    return { x: r.x + point.x * r.width, y: r.y + point.y * r.height };
  }
  async function atWorld(p) {
    const r = await view();
    const x = (p.x - r.x) / r.width,
      y = (p.y - r.y) / r.height;
    assert.ok(
      x >= 0 && x < 1 && y >= 0 && y < 1,
      'fitted view includes the sampled mark',
    );
    return rgba(canvas, x, y);
  }
  const coral = [235, 115, 101],
    green = [22, 129, 111],
    imageBlue = [52, 86, 171],
    photoPurple = [149, 65, 180];
  const testPhoto = (color) =>
    page.evaluate((fill) => {
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    }, color);
  const clipboardPhoto = await testPhoto('#9541b4');
  const pastePhoto = (target) =>
    target.evaluate((el, base64) => {
      const png = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', '照片');
      clipboard.items.add(new File([png], '照片.png', { type: 'image/png' }));
      const event = new ClipboardEvent('paste', {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    }, clipboardPhoto);
  function colorBounds(el, rgb) {
    const { width, height } = el;
    const pixels = el.getContext('2d').getImageData(0, 0, width, height).data;
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    for (let i = 0; i < pixels.length; i += 4) {
      if (
        pixels[i + 3] < 48 ||
        pixels[i] !== rgb[0] ||
        pixels[i + 1] !== rgb[1] ||
        pixels[i + 2] !== rgb[2]
      )
        continue;
      const x = (i / 4) % width,
        y = Math.floor(i / 4 / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return right < 0 ? null : { left, top, right, bottom };
  }
  async function exportedCanvas(name) {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      button('导出 PNG').click(),
    ]);
    assert.equal(download.suggestedFilename(), name + '.png');
    const bytes = await readFile(await download.path());
    return page.evaluateHandle(async (base64) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + base64;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.width;
      c.height = image.height;
      c.getContext('2d').drawImage(image, 0, 0);
      return c;
    }, bytes.toString('base64'));
  }
  await button('珊瑚').click();
  await drag(0.2, 0.3, 0.8, 0.3);
  await expect.poll(() => at(0.5, 0.3)).toEqual([235, 115, 101, 255]);
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, coral))
    .not.toBeNull();
  await button('橡皮擦').click();
  await tap(0.5, 0.3);
  await expect.poll(() => at(0.5, 0.3)).toEqual([0, 0, 0, 0]);
  await button('撤销').click();
  await expect.poll(() => at(0.5, 0.3)).toEqual([235, 115, 101, 255]);
  await page.keyboard.press('Control+Shift+Z');
  await expect.poll(() => at(0.5, 0.3)).toEqual([0, 0, 0, 0]);
  await button('图形').click();
  await button('椭圆').click();
  await button('青绿').click();
  await page.getByLabel('填充形状').check();
  await drag(0.15, 0.45, 0.35, 0.69);
  await expect.poll(() => at(0.25, 0.57)).toEqual([22, 129, 111, 255]);
  await button('箭头').click();
  await drag(0.42, 0.65, 0.63, 0.45);
  await button('文字').click();
  await tap(0.2, 0.12);
  const textEditor = page.getByLabel('画布文字');
  assert.equal(
    await pastePhoto(textEditor),
    false,
    'the editor keeps native paste handling',
  );
  await textEditor.fill('画布测试\nCanvas');
  await textEditor.press('Enter');
  await button('贴图').click();
  // Isolate the toolbar's asynchronous clipboard read from the user's clipboard.
  await page.evaluate((base64) => {
    const png = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const blob = new Blob([png], { type: 'image/png' });
    Object.defineProperty(navigator.clipboard, 'read', {
      configurable: true,
      value: async () => [new ClipboardItem({ 'image/png': blob })],
    });
  }, clipboardPhoto);
  try {
    await inspector
      .getByRole('button', { name: '粘贴照片', exact: true })
      .click();
    await expect
      .poll(() => thumbnail.evaluate(colorBounds, photoPurple))
      .not.toBeNull();
  } finally {
    await page.evaluate(() => delete navigator.clipboard.read);
  }
  await button('撤销').click();
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, photoPurple))
    .toBeNull();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    inspector.getByRole('button', { name: '选择照片', exact: true }).click(),
  ]);
  await chooser.setFiles({
    name: '贴图.png',
    mimeType: 'image/png',
    buffer: Buffer.from(await testPhoto('#3456ab'), 'base64'),
  });
  await expect(page.locator('.canvas-image-name')).toHaveText('贴图.png');
  const imagePoint = await world(0.8, 0.8);
  await tap(0.8, 0.8);
  await expect.poll(() => at(0.8, 0.8)).toEqual([52, 86, 171, 255]);
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, imageBlue))
    .not.toBeNull();
  await tool('画笔').click();
  const viewport = page.getByLabel('绘图区域', { exact: true });
  await viewport.focus();
  const safe = await page.locator('.canvas-fit-area').boundingBox();
  const surface = await canvas.boundingBox();
  const camera = await view();
  const pastePoint = {
    x:
      camera.x +
      ((safe.x + safe.width / 2 - surface.x) / surface.width) * camera.width,
    y:
      camera.y +
      ((safe.y + safe.height / 2 - surface.y) / surface.height) * camera.height,
  };
  assert.equal(
    await pastePhoto(viewport),
    true,
    'paste works with the brush selected',
  );
  await expect.poll(() => atWorld(pastePoint)).toEqual([...photoPurple, 255]);
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, photoPurple))
    .not.toBeNull();
  await button('撤销').click();
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, photoPurple))
    .toBeNull();
  await button('重做').click();
  await expect.poll(() => atWorld(pastePoint)).toEqual([...photoPurple, 255]);
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, photoPurple))
    .not.toBeNull();
  const thumbnailBefore = await thumbnail.evaluate((c) => c.toDataURL());
  const initial = await view();
  await button('放大').click();
  const zoomed = await view();
  assert.ok(zoomed.width < initial.width);
  await button('平移').click();
  await drag(0.5, 0.5, 0.55, 0.6);
  const panned = await view();
  assert.ok(panned.x < zoomed.x && panned.y < zoomed.y);
  assert.equal(await thumbnail.evaluate((c) => c.toDataURL()), thumbnailBefore);
  await button('画笔').click();
  await button('湖蓝').click();
  const bluePoint = await world(0.42, 0.4);
  await tap(0.42, 0.4);
  await expect.poll(async () => (await at(0.42, 0.4))[2]).toBe(207);
  await button('适合窗口').click();
  await expect.poll(() => atWorld(imagePoint)).toEqual([...imageBlue, 255]);
  if (process.env.CANVAS_SCREENSHOT)
    await page.screenshot({ path: process.env.CANVAS_SCREENSHOT });
  await button('黑色').click();
  const exported = await exportedCanvas('画布 01');
  assert.ok(await exported.evaluate(colorBounds, green));
  assert.ok(await exported.evaluate(colorBounds, imageBlue));
  const photo = await exported.evaluate(colorBounds, photoPurple);
  assert.ok(photo, 'the PNG contains the pasted photo');
  const aspect =
    (photo.right - photo.left + 1) / (photo.bottom - photo.top + 1);
  assert.ok(
    Math.abs(aspect - 2) < 0.1,
    'the pasted photo retains its aspect ratio',
  );
  const red = await exported.evaluate(colorBounds, coral);
  assert.ok(red);
  const erased = await exported.evaluate(
    (el, bounds) => [
      ...el
        .getContext('2d')
        .getImageData(
          (bounds.left + bounds.right) / 2,
          (bounds.top + bounds.bottom) / 2,
          1,
          1,
        ).data,
    ],
    red,
  );
  assert.deepEqual(erased, [0, 0, 0, 255]);
  await exported.dispose();
  await button('新建画布').click();
  const form = page.getByRole('dialog', { name: '新建画布', exact: true });
  await form.getByLabel('画布名称').fill('无界练习');
  await form.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.locator('.canvas-title h2')).toHaveText('无界练习');
  await expect(page.locator('.canvas-card')).toHaveCount(2);
  await tool('图形').click();
  await button('矩形').click();
  await inspector.getByLabel('填充形状').check();
  await button('珊瑚').click();
  const nearPoint = await world(0.5, 0.5);
  await drag(0.35, 0.35, 0.65, 0.65);
  await expect.poll(() => atWorld(nearPoint)).toEqual([...coral, 255]);
  await tool('平移').click();
  let zoomSteps = 0;
  while ((await view()).width * area.right * 0.8 < 5500 && zoomSteps < 20) {
    await button('缩小').click();
    zoomSteps++;
  }
  await drag(0.1, 0.5, 0.9, 0.5);
  for (let i = 0; i < zoomSteps; i++) await button('放大').click();
  const farPoint = await world(0.5, 0.5);
  assert.ok(
    farPoint.x < -1600 && nearPoint.x - farPoint.x > 4096,
    'reached negative world coordinates beyond the original sheet',
  );
  await tool('图形').click();
  await button('青绿').click();
  await drag(0.35, 0.35, 0.65, 0.65);
  await expect.poll(() => atWorld(farPoint)).toEqual([...green, 255]);
  // Both marks remain visible in the card and in PNG even when the
  // viewport is zoomed onto only the distant mark.
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, coral))
    .not.toBeNull();
  await expect
    .poll(() => thumbnail.evaluate(colorBounds, green))
    .not.toBeNull();
  const wide = await exportedCanvas('无界练习');
  const near = await wide.evaluate(colorBounds, coral);
  const far = await wide.evaluate(colorBounds, green);
  assert.ok(near && far && far.right < near.left);
  assert.ok(
    await wide.evaluate(
      (el) => el.width > el.height && Math.max(el.width, el.height) <= 4096,
    ),
  );
  await wide.dispose();
  await button('适合窗口').click();
  await expect.poll(() => atWorld(nearPoint)).toEqual([...coral, 255]);
  await expect.poll(() => atWorld(farPoint)).toEqual([...green, 255]);
  assert.ok(
    await thumbnail.evaluate((el) => {
      const art = el.getBoundingClientRect(),
        tray = el.closest('.canvas-card-tray').getBoundingClientRect();
      return (
        art.width > 0 &&
        art.height > 0 &&
        art.top >= tray.top &&
        art.left >= tray.left &&
        art.bottom <= tray.bottom &&
        art.right <= tray.right
      );
    }),
    'preview stays inside its card',
  );
  await button('切换到画布 01').click();
  await button('适合窗口').click();
  await expect.poll(() => atWorld(imagePoint)).toEqual([...imageBlue, 255]);
  await open();
  await button('适合窗口').click();
  await expect.poll(() => atWorld(imagePoint)).toEqual([...imageBlue, 255]);
  await expect.poll(() => atWorld(pastePoint)).toEqual([...photoPurple, 255]);
  await button('切换到无界练习').click();
  await button('适合窗口').click();
  await expect.poll(() => atWorld(nearPoint)).toEqual([...coral, 255]);
  await expect.poll(() => atWorld(farPoint)).toEqual([...green, 255]);
  await page.setViewportSize({ width: 390, height: 750 });
  await checkOverlay(button('画布设置'));
  await button('打开画布列表').click();
  await button('切换到无界练习').click();
  await expect(toolbar).toBeHidden();
  area = await drawingArea();
  await button('打开工具属性').click();
  await checkViewTools();
  const mobileView = await view();
  await viewControl('放大').click();
  assert.ok(
    (await view()).width < mobileView.width,
    'drawer zoom updates the drawing camera',
  );
  await viewControl('适合窗口').click();
  await tool('图形').click();
  await expect(tool('图形')).toHaveAttribute('aria-pressed', 'true');
  await inspector.getByRole('button', { name: '矩形', exact: true }).click();
  await inspector.getByLabel('填充形状').check();
  await button('关闭属性').click();
  await drag(0.25, 0.3, 0.65, 0.55);
  await expect.poll(async () => (await at(0.45, 0.4))[3]).toBe(255);
  await button('打开工具属性').click();
  await tool('橡皮擦').click();
  await expect(
    inspector.getByRole('slider', { name: '橡皮大小' }),
  ).toBeVisible();
  await inspector.getByRole('slider', { name: '橡皮大小' }).press('End');
  await button('关闭属性').click();
  await tap(0.45, 0.4);
  await expect.poll(async () => (await at(0.45, 0.4))[3]).toBe(0);
  await button('打开工具属性').click();
  await tool('画笔').click();
  await button('书法笔').click();
  await button('关闭属性').click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await button('画布设置').click();
  const edit = page.getByRole('dialog', { name: '画布设置', exact: true });
  await edit.getByLabel('画布名称').fill('草稿');
  await edit.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.canvas-title h2')).toHaveText('草稿');
  await button('画布设置').click();
  await button('删除画布').click();
  await button('确认删除').click();
  await expect(page.locator('.canvas-title h2')).toHaveText('画布 01');
  // A new stroke after undo replaces the old redo branch in both renderers.
  await button('打开工具属性').click();
  await viewControl('适合窗口').click();
  await button('关闭属性').click();
  await button('撤销').click();
  await expect.poll(async () => (await atWorld(bluePoint))[3]).toBe(0);
  await drag(0.4, 0.8, 0.5, 0.8);
  await expect.poll(async () => (await at(0.45, 0.8))[3]).toBeGreaterThan(0);
  await expect(button('重做')).toBeDisabled();
  await expect.poll(async () => (await atWorld(bluePoint))[3]).toBe(0);
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('dialog', { name: '便签', exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    'PASS right-side tools, mobile tool selection, ink/eraser history, unbounded world coordinates, previews and PNG, text, file and clipboard photos, persistence and sheet management',
  );
} finally {
  await context.close();
}
