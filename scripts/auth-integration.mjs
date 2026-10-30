// Real local OIDC server + real extension identity popup. No mail, no .env access.
import { chromium } from '@playwright/test';
import { argon2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const id = 'extension_test_' + randomBytes(8).toString('hex');
const email = `${id}@example.invalid`,
  password = randomBytes(24).toString('hex');
const salt = randomBytes(16);
const hash =
  'a2$' +
  salt.toString('base64').replaceAll('=', '') +
  '$' +
  argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    parallelism: 2,
    tagLength: 32,
    memory: 65536,
    passes: 2,
  })
    .toString('base64')
    .replaceAll('=', '');
function sql(q) {
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        'duoyu-postgres-dev',
        'psql',
        '-U',
        'duoyu',
        '-d',
        'duoyu',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-c',
        q,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
      .toString()
      .trim();
  } catch {
    throw new Error('Temporary authentication fixture SQL failed');
  }
}
let context;
try {
  assert.equal(
    (
      await fetch(
        'http://localhost:8080/.well-known/openid-configuration',
      ).then((r) => r.json())
    ).issuer,
    'http://localhost:8080',
  );
  sql(
    `INSERT INTO users(id,email,name,password_hash) VALUES('${id}','${email}','扩展联调用户','${hash}')`,
  );
  await mkdir('work', { recursive: true });
  const extension = path.resolve('.output/chrome-mv3');
  context = await chromium.launchPersistentContext(
    await mkdtemp(path.resolve('work/auth-')),
    {
      channel: 'msedge',
      headless: true,
      viewport: { width: 1440, height: 1000 },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
        '--enable-unsafe-swiftshader',
      ],
    },
  );
  await context.route('**/api/auth/code', (route) => route.abort());
  await context.route('**/api/service/mail', (route) => route.abort());
  await context.route('https://api.bimg.cc/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#315c68"/></svg>',
    }),
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const redirect = await worker.evaluate(() =>
    chrome.identity.getRedirectURL('oidc'),
  );
  assert.match(redirect, /^https:\/\/[a-p]{32}\.chromiumapp\.org\/oidc$/);
  // Register only the local extension client; no shared secrets or production changes.
  sql(
    `UPDATE apps SET platform='extension',redirects=ARRAY['${redirect}'],allowed_origins=ARRAY['chrome-extension://${extensionId}'] WHERE id='duoyu_extensions_local' AND public`,
  );
  console.log('Local callback:', redirect);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await page
    .getByRole('button', { name: '登录多鱼账号', exact: true })
    .waitFor();
  await page.waitForTimeout(1000);
  // Neutral visual fixture; no dependency on the external daily-wallpaper API.
  await page.addStyleTag({
    content: 'body { background: #315c68 !important; }',
  });
  await page.screenshot({ path: 'work/auth-entry.png' });
  await page.getByRole('button', { name: '登录多鱼账号', exact: true }).click();
  const firstPopup = context.waitForEvent('page', { timeout: 20000 });
  await page.getByRole('button', { name: '前往登录', exact: true }).click();
  const popup = await firstPopup;
  await popup.waitForURL('http://localhost:8080/login*');
  await page.waitForFunction(async () => {
    const parent = await chrome.windows.getCurrent();
    const popup = (await chrome.windows.getAll({ populate: true })).find(
      (w) =>
        w.type === 'popup' &&
        w.tabs?.some((t) => t.url?.startsWith('http://localhost:8080/login')),
    );
    const width = Math.min(1100, Math.max(320, parent.width - 48)),
      height = Math.min(840, Math.max(320, parent.height - 48));
    return (
      popup &&
      popup.width === width &&
      popup.height === height &&
      Math.abs(popup.left - (parent.left + (parent.width - width) / 2)) <= 1 &&
      Math.abs(popup.top - (parent.top + (parent.height - height) / 2)) <= 1
    );
  });
  console.log(
    'PASS compact authorization window centered on originating browser',
  );
  await popup.locator('[data-mode="password"]').click();
  await popup.locator('#email').fill(email);
  await popup.locator('#password').fill(password);
  await popup.locator('#submit').click();
  await popup.locator('#continue').click();
  await page
    .getByRole('button', { name: '我的账号', exact: true })
    .waitFor({ timeout: 20000 });
  assert.ok(await page.getByText(email, { exact: true }).isVisible());
  console.log(
    'PASS actual identity popup, password, PKCE, signed ID token, UserInfo',
  );
  await page.screenshot({ path: 'work/auth-account.png' });
  const saved = await page.evaluate(
    async () =>
      (await chrome.storage.session.get('duoyuAuthSession')).duoyuAuthSession,
  );
  assert.equal(saved.account.sub, id);
  assert.ok(saved.refresh);
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole('button', { name: '我的账号', exact: true }).waitFor();
  console.log('PASS shared account across new tabs');
  // Fault injection only inside this disposable extension worker, never the real service.
  for (const [status, error, warning] of [
    [403, 'origin_not_allowed', 'allowed_origins'],
    [403, 'insufficient_scope', '授权范围'],
    [503, 'temporarily_unavailable', '暂时不可用'],
  ]) {
    await worker.evaluate(
      ({ status, error }) => {
        globalThis.authOriginalFetch = globalThis.fetch;
        globalThis.fetch = (url, init) =>
          String(url).endsWith('/userinfo')
            ? Promise.resolve(Response.json({ error }, { status }))
            : globalThis.authOriginalFetch(url, init);
      },
      { status, error },
    );
    try {
      const failed = await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
      );
      assert.equal(failed.view.account.sub, id);
      assert.ok(failed.view.warning.includes(warning));
      assert.ok(
        await page.evaluate(
          async () =>
            !!(await chrome.storage.session.get('duoyuAuthSession'))
              .duoyuAuthSession,
        ),
      );
    } finally {
      await worker.evaluate(() => {
        globalThis.fetch = globalThis.authOriginalFetch;
        delete globalThis.authOriginalFetch;
      });
    }
  }
  console.log(
    'PASS origin/scope errors and service outage preserve session with precise warnings',
  );
  const originAllowed = await fetch('http://localhost:8080/userinfo', {
    headers: {
      Authorization: `Bearer ${saved.access}`,
      Origin: `chrome-extension://${extensionId}`,
    },
  });
  assert.equal(originAllowed.status, 200);
  const originDenied = await fetch('http://localhost:8080/userinfo', {
    headers: {
      Authorization: `Bearer ${saved.access}`,
      Origin: 'https://unregistered.example.invalid',
    },
  });
  assert.equal(originDenied.status, 403);
  assert.equal((await originDenied.json()).error, 'origin_not_allowed');
  console.log('PASS actual allowed_origins enforcement');
  // Force client expiry to exercise real refresh rotation, concurrently from two tabs.
  await page.evaluate(async () => {
    const s = (await chrome.storage.session.get('duoyuAuthSession'))
      .duoyuAuthSession;
    s.expires = 0;
    await chrome.storage.session.set({ duoyuAuthSession: s });
  });
  const results = await Promise.all(
    [page, other].map((p) =>
      p.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
      ),
    ),
  );
  assert.ok(results.every((r) => r.view?.account?.sub === id));
  const refreshed = await page.evaluate(
    async () =>
      (await chrome.storage.session.get('duoyuAuthSession')).duoyuAuthSession,
  );
  assert.notEqual(saved.refresh, refreshed.refresh);
  console.log('PASS serialized refresh rotation across tabs');
  const cdp = await context.newCDPSession(page);
  let versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => {
    versions.push(...e.versions);
  });
  await cdp.send('ServiceWorker.enable');
  for (
    let attempt = 0;
    attempt < 30 && !versions.some((v) => v.scriptURL.includes(extensionId));
    attempt++
  )
    await new Promise((r) => setTimeout(r, 100));
  const version = versions.find(
    (v) => v.scriptURL.includes(extensionId) && v.runningStatus === 'running',
  );
  assert.ok(version);
  await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId });
  const resumed = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
  );
  assert.equal(resumed.view.account.sub, id);
  console.log(
    'PASS worker suspension preserves session and resumes online verification',
  );

  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByRole('button', { name: '前往登录', exact: true }).waitFor();
  await other
    .getByRole('button', { name: '登录多鱼账号', exact: true })
    .waitFor();
  const userinfo = await fetch('http://localhost:8080/userinfo', {
    headers: { Authorization: `Bearer ${refreshed.access}` },
  });
  assert.equal(userinfo.status, 401);
  assert.equal(
    userinfo.headers.get('www-authenticate'),
    'Bearer error="invalid_token"',
  );
  console.log('PASS local logout synchronizes tabs and revokes server tokens');
  // Sign back in through SSO, then revoke the central session.
  const nextPopup = context.waitForEvent('page');
  await page.getByRole('button', { name: '前往登录', exact: true }).click();
  const sso = await nextPopup;
  await sso.waitForURL('http://localhost:8080/login*');
  await sso.locator('#continue').click();
  await page.getByRole('button', { name: '我的账号', exact: true }).waitFor();
  sql(`UPDATE users SET enabled=false WHERE id='${id}'`);
  const disabled = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
  );
  assert.equal(disabled.view.account, null);
  sql(`UPDATE users SET enabled=true WHERE id='${id}'`);
  const enabledPopup = context.waitForEvent('page');
  await page.getByRole('button', { name: '前往登录', exact: true }).click();
  const enabledLogin = await enabledPopup;
  await enabledLogin.waitForURL('http://localhost:8080/login*');
  await enabledLogin.locator('#continue').click();
  await page.getByRole('button', { name: '我的账号', exact: true }).waitFor();
  console.log('PASS account suspension clears extension identity');
  sql(`DELETE FROM sessions WHERE user_id='${id}'`);
  const revoked = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
  );
  assert.equal(revoked.view.account, null);
  console.log('PASS SSO re-login and central-session revocation');
  const cancelPopup = context.waitForEvent('page');
  await page.getByRole('button', { name: '前往登录', exact: true }).click();
  const cancelled = await cancelPopup;
  await cancelled.waitForURL('http://localhost:8080/login*');
  await cancelled.close();
  await page
    .getByText('登录窗口已关闭或授权未完成，可重新登录', { exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByRole('button', { name: '前往登录', exact: true })
      .isEnabled(),
  );
  console.log('PASS cancelled popup leaves UI usable');
  await page.keyboard.press('Escape');
  await page.locator('[data-dock-id="duoyu-workspace"]').click();
  await page.locator('.workspace-overlay').waitFor();
  await page
    .getByRole('button', { name: '登录多鱼账号', exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator('.account-entry')
      .evaluate((el) => getComputedStyle(el).visibility),
    'visible',
  );
  console.log('PASS account entry remains accessible in workspace');
  await page.getByRole('button', { name: '登录多鱼账号', exact: true }).click();
  const crashPopup = context.waitForEvent('page');
  await page.getByRole('button', { name: '前往登录', exact: true }).click();
  const crashLogin = await crashPopup;
  await crashLogin.waitForURL('http://localhost:8080/login*');
  await crashLogin.locator('[data-mode="password"]').click();
  await crashLogin.locator('#email').fill(email);
  await crashLogin.locator('#password').fill(password);
  await crashLogin.locator('#submit').click();
  await crashLogin.locator('#continue').click();
  await page.getByRole('button', { name: '我的账号', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { duoyuAuthSession: s } =
      await chrome.storage.session.get('duoyuAuthSession');
    await chrome.storage.session.set({
      duoyuAuthSession: { ...s, refreshPending: true },
    });
  });
  const uncertain = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
  );
  assert.equal(uncertain.view.account, null);
  assert.match(uncertain.view.warning, /结果不确定/);
  assert.equal(
    await page.evaluate(
      async () =>
        !!(await chrome.storage.session.get('duoyuAuthSession'))
          .duoyuAuthSession,
    ),
    false,
  );
  console.log(
    'PASS persisted in-flight refresh is discarded instead of replayed',
  );
  const reloadPopup = context.waitForEvent('page');
  await page.getByRole('button', { name: '前往登录', exact: true }).click();
  const reloadLogin = await reloadPopup;
  await reloadLogin.waitForURL('http://localhost:8080/login*');
  await reloadLogin.locator('#continue').click();
  await page.getByRole('button', { name: '我的账号', exact: true }).waitFor();
  const nextWorker = context.waitForEvent('serviceworker');
  await page.evaluate(() => chrome.runtime.reload()).catch(() => {});
  await nextWorker;
  const reloaded = await context.newPage();
  await reloaded.goto(`chrome-extension://${extensionId}/newtab.html`);
  await reloaded
    .getByRole('button', { name: '登录多鱼账号', exact: true })
    .waitFor();
  assert.equal(
    await reloaded.evaluate(
      async () =>
        !!(await chrome.storage.session.get('duoyuAuthSession'))
          .duoyuAuthSession,
    ),
    false,
  );
  console.log(
    'PASS extension reload clears session storage and requires new authorization',
  );
} finally {
  await context?.close();
  sql(
    `DELETE FROM sessions WHERE user_id='${id}'; DELETE FROM access_tokens WHERE user_id='${id}'; DELETE FROM app_users WHERE user_id='${id}'; DELETE FROM auth_requests WHERE body->>'UserID'='${id}'; DELETE FROM logout_jobs WHERE user_id='${id}'; DELETE FROM users WHERE id='${id}';`,
  );
}
