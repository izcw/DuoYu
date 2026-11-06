// Real local ID server + extension, with a disposable schema and no mail workers.
// Requires DUOYU_TEST_DATABASE_URL (loopback duoyu_sync_test) and GO_BINARY.
import assert from 'node:assert/strict';
import {
  argon2Sync,
  randomBytes,
  createHash,
  X509Certificate,
} from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { build } from 'wxt';
import { openGridMenu } from './ui-helpers.mjs';
import {
  createAuthenticator,
  createSyncServer,
  accountId,
} from '../../DuoYu-Backend/server/sync/src/http.mjs';

const dsn = new URL(process.env.DUOYU_TEST_DATABASE_URL || 'about:blank');
assert.ok(['postgres:', 'postgresql:'].includes(dsn.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(dsn.hostname));
assert.equal(
  dsn.pathname,
  '/duoyu_sync_test',
  'Only the dedicated test database is allowed',
);
assert.ok(
  process.env.GO_BINARY,
  'Set GO_BINARY to the installed Go executable',
);
const requireBackend = createRequire(
  path.resolve('../DuoYu-Backend/server/sync/package.json'),
);
const { Client, Pool } = requireBackend('pg');
const idRoot = path.resolve('../DuoYu-ID');
await mkdir('work', { recursive: true });
const evidence = await mkdtemp(path.resolve('work/auth-isolated-'));
const idDist = path.join(evidence, 'admin/dist');
await cp(path.join(idRoot, 'admin/dist'), idDist, { recursive: true });
// The standalone login bundle is a separate build step. Fail before creating
// fixtures if a partial admin build removed it.
for (const asset of [
  'index.html',
  'login-ui/message.js',
  'login-ui/message.css',
]) {
  const content = await readFile(path.join(idDist, asset)).catch(
    (cause) => {
      throw new Error(
        `Missing ID build asset ${asset}; run pnpm build in DuoYu-ID/admin`,
        { cause },
      );
    },
  );
  assert.ok(
    content.length,
    `Missing ID build asset ${asset}; run pnpm build in DuoYu-ID/admin`,
  );
}
const schema = 'auth_browser_' + randomBytes(8).toString('hex');
await writeFile(
  path.join(evidence, 'fixture.json'),
  JSON.stringify({ schema }),
);
const db = new Client({ connectionString: dsn.href });
await db.connect();
const executable = path.join(
  evidence,
  process.platform === 'win32' ? 'identity.exe' : 'identity',
);
const clientId = 'isolated_extension';
const userId = 'browser_' + randomBytes(8).toString('hex');
const email = userId + '@example.invalid';
const password = randomBytes(24).toString('hex');
let context,
  server,
  syncServer,
  tlsServer,
  backend,
  syncPool,
  page,
  schemaCreated = false,
  serverOutput = '',
  backendOutput = '',
  completed = false;
async function command(file, args, options = {}) {
  const child = spawn(file, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const [code] = await once(child, 'close');
  if (code !== 0)
    throw new Error(`Fixture command failed (${code}): ${output}`);
}
async function freePort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}
async function signIn(context, page, origin, loginEmail = email) {
  if (!(await page.getByRole('dialog', { name: '登录后编辑' }).isVisible()))
    await page.getByRole('button', { name: '登录多鱼账号', exact: true }).click();
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: '前往登录', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL(origin + '/login*');
  await popup.locator('#email').fill(loginEmail);
  await popup.locator('#password').fill(password);
  // Only this synthetic fixture explicitly exercises consent.
  const consent = popup.locator('#legal-accept');
  await expect(consent).not.toBeChecked();
  await expect(consent).toHaveAccessibleName(/^我已阅读并同意\s*《服务条款》\s*和\s*《隐私政策》$/);
  await consent.check();
  await popup.locator('#submit').click();
  await popup.locator('#continue').click();
  await expect(
    page.getByRole('button', { name: '我的账号', exact: true }),
  ).toBeVisible();
}
try {
  await db.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await db.query(`SET search_path TO ${schema}`);
  const isolatedDsn = new URL(dsn);
  isolatedDsn.searchParams.set('search_path', schema);
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const origin = `http://localhost:${port}`;
  await command(
    process.env.GO_BINARY,
    ['build', '-o', executable, './server'],
    { cwd: idRoot },
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/SMTP|MAIL|^DUOYU_|^DATABASE_URL$/i.test(key),
    ),
  );
  const fixtureSecret = randomBytes(32).toString('hex');
  server = spawn(executable, [], {
    cwd: evidence,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      DATABASE_URL: isolatedDsn.href,
      DUOYU_DEV: 'true',
      DUOYU_ROLE: 'api',
      DUOYU_ORIGIN: origin,
      DUOYU_ADDR: `127.0.0.1:${port}`,
      DUOYU_DATA_DIR: path.join(evidence, 'data'),
      DUOYU_SECRET: fixtureSecret,
    },
  });
  server.stdout.on('data', (data) => {
    serverOutput += data;
  });
  server.stderr.on('data', (data) => {
    serverOutput += data;
  });
  await expect
    .poll(
      async () => {
        if (server.exitCode !== null)
          throw new Error('Isolated ID server exited during startup');
        try {
          return (
            await fetch(origin + '/healthz', {
              signal: AbortSignal.timeout(1000),
            })
          ).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  // Both services use a disposable schema. Authentication is the production
  // verifier (remote JWKS + live UserInfo), not an injected test identity.
  syncPool = new Pool({
    connectionString: dsn.href,
    options: `-c search_path=${schema}`,
  });
  await syncPool.query(
    await readFile(
      new URL('../../DuoYu-Backend/server/sync/schema.sql', import.meta.url),
      'utf8',
    ),
  );
  const origins = [];
  syncServer = createSyncServer({
    pool: syncPool,
    origins,
    authenticate: await createAuthenticator({ issuer: origin, clientId }),
  });
  await new Promise((resolve) => syncServer.listen(0, '127.0.0.1', resolve));
  const syncOrigin = `http://127.0.0.1:${syncServer.address().port}`;
  const backendPort = await freePort();
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const backendRoot = path.resolve('../DuoYu-Backend/server/backend');
  const backendExecutable = path.join(
    evidence,
    process.platform === 'win32' ? 'backend.exe' : 'backend',
  );
  await command(
    process.env.GO_BINARY,
    ['build', '-o', backendExecutable, '.'],
    { cwd: backendRoot },
  );
  await syncPool.query(
    await readFile(path.join(backendRoot, 'schema.sql'), 'utf8'),
  );
  await command(process.env.GO_BINARY, [
    'run',
    path.resolve('scripts/fixtures/local-tls.go'),
    evidence,
  ]);
  const cert = await readFile(path.join(evidence, 'cert.pem'));
  const key = await readFile(path.join(evidence, 'key.pem'));
  const pin = createHash('sha256')
    .update(
      new X509Certificate(cert).publicKey.export({
        type: 'spki',
        format: 'der',
      }),
    )
    .digest('base64');
  // Keep the production HTTPS requirement; trust only this fixture's ephemeral
  // certificate in its own browser profile, without changing OS trust settings.
  tlsServer = createHttpsServer({ cert, key }, (req, res) => {
    const proxy = request(
      backendOrigin + req.url,
      {
        method: req.method,
        headers: req.headers,
      },
      (upstream) => {
        if (res.destroyed) {
          upstream.destroy();
          return;
        }
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.on('error', () => res.destroy());
        upstream.pipe(res);
      },
    );
    proxy.on('error', () => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502);
      res.end();
    });
    req.on('aborted', () => proxy.destroy());
    res.on('close', () => proxy.destroy());
    req.pipe(proxy);
  });
  await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
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
  await db.query(
    'INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',
    [userId, email, '隔离联调账号', hash],
  );
  Object.assign(process.env, {
    VITE_AUTH_ISSUER: origin,
    VITE_AUTH_CLIENT_ID: clientId,
    VITE_AUTH_SCOPE: process.argv.includes('--without-refresh-scope')
      ? 'openid profile email'
      : 'openid profile email offline_access',
    VITE_SYNC_URL: `https://127.0.0.1:${tlsServer.address().port}`,
  });
  await build({
    outDir: path.join(evidence, 'extension'),
    browser: 'chrome',
    mode: 'production',
  });
  const extension = path.join(evidence, 'extension/chrome-mv3');
  context = await chromium.launchPersistentContext(
    path.join(evidence, 'profile'),
    {
      channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
      headless: true,
      viewport: { width: 1440, height: 1000 },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--ignore-certificate-errors-spki-list=${pin}`,
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
      ],
    },
  );
  await context.route('**/api/auth/code', (r) => r.abort());
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  await context.route('**/api/service/mail', (r) => r.abort());
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  origins.push(`chrome-extension://${extensionId}`);
  const redirect = await worker.evaluate(() =>
    chrome.identity.getRedirectURL('oidc'),
  );
  await db.query(
    `INSERT INTO apps(id,name,redirects,public,platform,allowed_origins,refresh_enabled,login_methods)
    VALUES($1,$2,$3,true,'extension',$4,true,ARRAY['password'])`,
    [clientId, '隔离扩展', [redirect], [`chrome-extension://${extensionId}`]],
  );
  const businessOrigin = `https://127.0.0.1:${tlsServer.address().port}`;
  await db.query(
    `INSERT INTO apps(id,name,redirects,public,platform,refresh_enabled,login_methods)
    VALUES($1,$2,$3,true,'web',true,ARRAY['password'])`,
    ['isolated_admin', '隔离业务管理', [businessOrigin + '/auth/callback']],
  );
  backend = spawn(backendExecutable, [], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      DATABASE_URL: isolatedDsn.href,
      PUBLIC_ORIGIN: `https://127.0.0.1:${tlsServer.address().port}`,
      DUOYU_ISSUER: origin,
      DUOYU_CLIENT_ID: clientId,
      ADMIN_CLIENT_ID: 'isolated_admin',
      SUPER_ADMIN_SUB: userId,
      SESSION_KEY: randomBytes(32).toString('hex'),
      ASSET_ROOT: path.join(evidence, 'business-assets'),
      BACKUP_DIR: path.join(evidence, 'business-backups'),
      ADMIN_DIST: path.resolve('../DuoYu-Backend/admin/dist'),
      SYNC_ORIGINS: origins.join(','),
      SYNC_UPSTREAM: syncOrigin,
      LISTEN: `127.0.0.1:${backendPort}`,
    },
  });
  backend.stdout.on('data', (data) => {
    backendOutput += data;
  });
  backend.stderr.on('data', (data) => {
    backendOutput += data;
  });
  await expect
    .poll(
      async () => {
        if (backend.exitCode !== null)
          throw new Error('Isolated business server exited during startup');
        try {
          return (
            await fetch(backendOrigin + '/healthz', {
              signal: AbortSignal.timeout(1000),
            })
          ).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  if (process.argv.includes('--export-boundaries')) {
    const { verifyGuestExport } =
      await import('./fixtures/export-boundaries.mjs');
    await verifyGuestExport({ page, evidence });
  }
  await signIn(context, page, origin);
  // The account-scoped new tab can reload immediately after sign-in.
  const session = await worker.evaluate(
    async () =>
      (await chrome.storage.local.get('duoyuAuthSessionRenewal'))
        .duoyuAuthSessionRenewal,
  );
  assert.equal(session.account.sub, userId);
  assert.equal(session.account.issuer, origin);
  assert.ok(session.refresh);
  console.log(
    'PASS real password/consent, identity popup, PKCE, signed ID token and UserInfo',
  );
  console.log('Checking initial cloud synchronization');
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await expect(page.locator('.sync-time')).toContainText('最近同步', {
    timeout: 30000,
  });
  await page.keyboard.press('Escape');
  console.log('Creating a collection item through the UI');
  await openGridMenu(page, page.locator('.library-cell-grid').first(), {
    waitForItem: false,
  });
  await page.getByRole('menuitem', { name: '添加网址', exact: true }).click();
  await page
    .getByLabel('收藏网址', { exact: true })
    .fill('https://example.invalid/real-oidc');
  await page.getByLabel('收藏名称', { exact: true }).fill('真实认证同步收藏');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const saved = page.locator(
    '.cell-link[aria-label="打开收藏 真实认证同步收藏"]',
  );
  await expect(saved).toBeVisible();
  const account = accountId(origin, userId);
  // A clean second profile has neither the selected desktop nor its image cache.
  const wallpaperBytes = await readFile('public/icons/128.png');
  await context.route('https://api.bimg.cc/all?**', (route) => route.fulfill({
    json: { code: 200, total: 1, data: [{ id: 871, title: '重装验收', datetime: '2026-11-01', url: 'https://bing.com/th?id=fixture_1920x1080.jpg', copyright: 'fixture' }] },
  }));
  await context.route('https://bing.com/**', (route) => route.fulfill({ contentType: 'image/png', body: wallpaperBytes }));
  const firstDesktop = process.argv.includes('--default-wallpaper');
  if (!firstDesktop) {
    await page.getByRole('button', { name: '切换桌面', exact: true }).click();
    await page.getByRole('button', { name: '添加桌面', exact: true }).click();
  }
  await openGridMenu(page, page.locator('.library-cell-grid').first(), { waitForItem: false });
  await page.getByRole('menuitem', { name: '换壁纸', exact: true }).click();
  await page.getByRole('button', { name: '必应', exact: true }).click();
  const bingCard = page.getByRole('button', { name: '应用壁纸 重装验收', exact: true });
  await bingCard.click();
  await expect(bingCard).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  const expectedAsset = 'duoyu-asset:' + createHash('sha256').update(wallpaperBytes).digest('hex');
  const cloudDesktop = async () => (await syncPool.query(
    "SELECT payload->'value' AS profile FROM sync_entities WHERE account_id=$1 AND entity_type='preferences' AND entity_id LIKE 'wallpaperDesktop:%' AND payload->'value'->>'asset'=$2 AND NOT deleted",
    [account, expectedAsset],
  )).rows[0]?.profile;
  await expect.poll(async () => (await cloudDesktop())?.selection, { timeout: 30000 }).toBe('bing:871');
  const chosenDesktop = (await cloudDesktop()).id;
  if (firstDesktop) assert.equal(chosenDesktop, 'default');
  // New selections must sync through the same desktop preference on every desktop.
  if (firstDesktop) {
    const legacyWrites = await syncPool.query(
      "SELECT entity_id FROM sync_entities WHERE account_id=$1 AND (entity_type='wallpapers' OR (entity_type='preferences' AND entity_id IN ('wallpaperSelection','wallpaperMode')))",
      [account],
    );
    assert.deepEqual(legacyWrites.rows, [], 'desktop 1 also wrote the legacy wallpaper selection');
  }
  const resumeDesktop = async () => (await syncPool.query(
    "SELECT payload->>'value' AS desktop FROM sync_entities WHERE account_id=$1 AND entity_type='preferences' AND entity_id='wallpaperResumeDesktop' AND NOT deleted",
    [account],
  )).rows[0]?.desktop;
  await expect.poll(resumeDesktop, { timeout: 30000 }).toBe(chosenDesktop);

  await expect
    .poll(
      async () =>
        (
          await syncPool.query(
            "SELECT payload->>'url' AS url FROM sync_entities WHERE account_id=$1 AND entity_type='libraryItems' AND payload->>'name'=$2 AND NOT deleted",
            [account, '真实认证同步收藏'],
          )
        ).rows[0]?.url,
      { timeout: 30000 },
    )
    .toBe('https://example.invalid/real-oidc');
  console.log(
    'PASS real signed identity → business sync → PostgreSQL persistence',
  );
  const peer = await context.newPage();
  await peer.goto(page.url());
  await expect(
    peer.getByRole('button', { name: '我的账号', exact: true }),
  ).toBeVisible();
  // Expire the real server-side access grant. Editing client storage races
  // normal status checkpoints now that the real sync queue is also running.
  await db.query(
    "UPDATE access_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND app_id=$2",
    [userId, clientId],
  );
  const refreshed = await Promise.all(
    [page, peer].map((p) =>
      p.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'duoyu-auth', action: 'status' }),
      ),
    ),
  );
  assert.ok(refreshed.every((value) => value.view?.account?.sub === userId));
  const rotated = await page.evaluate(
    async () =>
      (await chrome.storage.local.get('duoyuAuthSessionRenewal'))
        .duoyuAuthSessionRenewal,
  );
  assert.ok(
    rotated.refresh !== session.refresh,
    'The real refresh grant must rotate',
  );
  const syncHeaders = {
    Authorization: `Bearer ${rotated.access}`,
    'X-Duoyu-Identity': rotated.identity,
    Origin: `chrome-extension://${extensionId}`,
  };
  const snapshot = await fetch(backendOrigin + '/api/v1/sync/snapshot', {
    headers: syncHeaders,
  });
  assert.equal(snapshot.status, 200);
  assert.ok(
    (await snapshot.json()).entities.some(
      (entity) => entity.payload.name === '真实认证同步收藏',
    ),
  );
  assert.equal(
    (
      await fetch(backendOrigin + '/api/v1/sync/snapshot', {
        headers: { ...syncHeaders, 'X-Duoyu-Identity': 'invalid' },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(backendOrigin + '/api/v1/sync/snapshot', {
        headers: {
          ...syncHeaders,
          Origin: 'https://unregistered.example.invalid',
        },
      })
    ).status,
    403,
  );
  console.log('PASS real concurrent refresh rotation and cross-tab identity');
  const discovery = await fetch(
    origin + '/.well-known/openid-configuration',
  ).then((r) => r.json());
  const allowed = await fetch(discovery.userinfo_endpoint, {
    headers: {
      Authorization: `Bearer ${rotated.access}`,
      Origin: `chrome-extension://${extensionId}`,
    },
  });
  assert.equal(allowed.status, 200);
  const denied = await fetch(discovery.userinfo_endpoint, {
    headers: {
      Authorization: `Bearer ${rotated.access}`,
      Origin: 'https://unregistered.example.invalid',
    },
  });
  assert.equal(denied.status, 403);
  await context.close();
  context = undefined;
  context = await chromium.launchPersistentContext(
    path.join(evidence, 'profile'),
    {
      channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--ignore-certificate-errors-spki-list=${pin}`,
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
      ],
    },
  );
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await expect(
    page.getByRole('button', { name: '我的账号', exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.cell-link[aria-label="打开收藏 真实认证同步收藏"]'),
  ).toBeVisible();
  console.log('PASS browser restart restores durable authentication');
  await page.getByRole('button', { name: '我的账号', exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '登录多鱼账号', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: '打开收藏 真实认证同步收藏',
      exact: true,
    }),
  ).toHaveCount(0);
  assert.equal(
    (
      await fetch(backendOrigin + '/api/v1/sync/snapshot', {
        headers: syncHeaders,
      })
    ).status,
    401,
  );
  console.log(
    'PASS logout isolates guest data and revokes business sync access',
  );
  assert.equal(
    (
      await fetch(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${rotated.access}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS count FROM mail_messages')).rows[0]
      .count,
    0,
  );
  await context.close();
  context = undefined;
  if (process.argv.includes('--legacy-wallpaper')) {
    // Older clients uploaded the desktop and image, but no resume preference.
    const legacy = await syncPool.query(
      "DELETE FROM sync_entities WHERE account_id=$1 AND entity_type='preferences' AND entity_id='wallpaperResumeDesktop'",
      [account],
    );
    assert.equal(legacy.rowCount, 1);
  }
  context = await chromium.launchPersistentContext(
    path.join(evidence, 'fresh-profile'),
    {
      channel: process.env.TEST_BROWSER_CHANNEL || 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--ignore-certificate-errors-spki-list=${pin}`,
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
      ],
    },
  );
  context.setDefaultTimeout(15000);
  await context.route('**/api/auth/code', (r) => r.abort());
  await context.route('**/api/service/mail', (r) => r.abort());
  await context.route('https://api.bimg.cc/**', (r) => r.abort());
  const guestLink = { id: 'guest-template-link', pageId: 'home', parent: '', kind: 'link', name: '官方模板入口', url: 'https://example.invalid/guest-only', order: 0, width: 1, height: 1 };
  const guestImage = await readFile('public/images/google.png');
  const guestHash = createHash('sha256').update(guestImage).digest('hex');
  assert.notEqual('duoyu-asset:'+guestHash,expectedAsset);
  const catalogDir = path.join(evidence,'business-assets','catalog');
  await mkdir(catalogDir,{recursive:true});
  await writeFile(path.join(catalogDir,guestHash),guestImage);
  const guestDesktop = {table:'preferences',id:'wallpaperDesktop:default',payload:{id:'wallpaperDesktop:default',value:{id:'default',created:0,selection:'bing:771',asset:'duoyu-asset:'+guestHash}}};
  const template = await syncPool.query("INSERT INTO backend_catalog(kind,name,status,payload) VALUES('templates','访客验收','published',$1) RETURNING id",
    [{format:'duoyu-template',version:1,source_account_id:'private-source',assets:[{sha256:guestHash,media_type:'image/png',bytes:guestImage.length}],entities:[guestDesktop,{table:'libraryItems',id:guestLink.id,payload:guestLink}]}]);
  await syncPool.query("INSERT INTO backend_settings(id,value) VALUES('default_template_id',to_jsonb($1::text)) ON CONFLICT(id) DO UPDATE SET value=excluded.value",[template.rows[0].id]);
  const guestResponse = await fetch(backendOrigin+'/api/v1/guest-template');
  assert.equal(guestResponse.status,200);
  assert.ok(!(await guestResponse.text()).includes('private-source'));
  assert.equal((await fetch(backendOrigin+'/api/v1/guest-template',{method:'POST'})).status,405);
  assert.equal((await fetch(backendOrigin+'/api/v1/guest-template/assets/'+'a'.repeat(64))).status,404);
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  const official = page.locator('.cell-link[aria-label="打开收藏 官方模板入口"]');
  await expect(official).toBeVisible();
  await expect.poll(async()=>page.locator('.wallpaper img.loaded').first().evaluate(async img => {
    const bytes = await (await fetch(img.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  })).toBe(guestHash);
  await context.route('**/api/v1/guest-template',r=>r.abort());
  await page.reload();
  await expect(official).toBeVisible();
  await expect(page.getByText('离线显示上次下载的官方模板')).toBeVisible();
  await context.unroute('**/api/v1/guest-template');
  const expectLogin = async () => {
    const prompt = page.getByRole('dialog', {name: '登录后编辑'});
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button', {name: '前往登录'})).toBeVisible();
    await prompt.getByRole('button', {name: '继续浏览'}).click();
    await expect(prompt).not.toBeVisible();
  };
  for (const name of ['编辑', '删除']) {
    await official.click({ button: 'right' });
    await page.locator('.grid-item-menu').getByRole('button', { name, exact: true }).click();
    await expectLogin();
    await expect(official).toBeVisible();
  }
  await expect(page.getByRole('button',{name:'调整大小 官方模板入口'})).toHaveCount(1);
  await page.getByRole('button',{name:'切换桌面',exact:true}).click();
  const cards = page.locator('.desktop-cards [data-desktop]');
  const before = await cards.count();
  await page.getByRole('button',{name:'添加桌面',exact:true}).click();
  await expectLogin();
  await expect(cards).toHaveCount(before);
  await page.keyboard.press('Escape');
  await context.route(guestLink.url, route => route.fulfill({contentType:'text/plain',body:'guest link opened'}));
  const linkOpened = context.waitForEvent('page');
  await official.click();
  const opened = await linkOpened;
  await opened.waitForURL(guestLink.url,{waitUntil:'commit'}).catch(async()=>assert.equal((await page.evaluate(()=>chrome.tabs.query({}))).some(t=>(t.url || t.pendingUrl)==='https://example.invalid/guest-only'),true));
  await opened.close();
  console.log('PASS official guest template, open link, visible edit/delete/add actions prompt for login and restricted template endpoint');
  await expect(
    page.locator('.cell-link[aria-label="打开收藏 真实认证同步收藏"]'),
  ).toHaveCount(0);
  // Exercise a stale local default intent left by a previous build on startup.
  await page.addInitScript(() => {
    const owner = localStorage.getItem('duoyu-sync-account');
    if (owner) localStorage.setItem('account:'+owner+':duoyu-wallpaper-intent', JSON.stringify({selection:'daily'}));
  });
  await official.click({ button: 'right' });
  await page.locator('.grid-item-menu').getByRole('button', {name:'编辑',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'登录后编辑'})).toBeVisible();
  await signIn(context, page, origin);
  await expect(
    page.locator('.cell-link[aria-label="打开收藏 真实认证同步收藏"]'),
  ).toBeVisible({ timeout: 30000 });
  await expect(official).toHaveCount(0);
  console.log(
    'PASS fresh browser profile pulls actual cloud data after real login',
  );
  await page.getByRole('button', { name: '切换桌面', exact: true }).click();
  await expect(page.locator('[data-desktop="' + chosenDesktop + '"]')).toHaveAttribute('aria-pressed', 'true');
  const displayedWallpaper = page.locator('.wallpaper:not(.wallpaper-contained) img.loaded').first();
  await expect.poll(async () => displayedWallpaper.evaluate(async img => {
    const bytes = await (await fetch(img.src)).arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  }), { timeout: 15000 }).toBe(expectedAsset.slice('duoyu-asset:'.length));
  if (firstDesktop) {
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'我的账号',exact:true}).click();
    await page.getByRole('button',{name:'立即同步',exact:true}).click();
    await expect(page.locator('.sync-time')).toContainText('最近同步');
    assert.equal((await cloudDesktop()).selection,'bing:871');
    const localOverwrite = await syncPool.query("SELECT entity_id FROM sync_entities WHERE account_id=$1 AND entity_id IN ('wallpaperSelection','wallpaperMode')",[account]);
    assert.equal(localOverwrite.rowCount,0);
  }
  await page.keyboard.press('Escape');
  console.log('PASS fresh installation restores the selected desktop and byte-identical Bing wallpaper');
  // Another device can set its own default without switching this open device.
  await page.getByRole('button', { name: '切换桌面', exact: true }).click();
  await page.locator('[data-desktop="default"]').click();
  await expect.poll(resumeDesktop, { timeout: 30000 }).toBe('default');
  await context.close();
  context = await chromium.launchPersistentContext(path.join(evidence, 'profile'), {
    channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--ignore-certificate-errors-spki-list=${pin}`, `--load-extension=${extension}`, `--disable-extensions-except=${extension}`],
  });
  await context.clearCookies();
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await signIn(context, page, origin);
  await page.getByRole('button', { name: '切换桌面', exact: true }).click();
  await expect(page.locator('[data-desktop="' + chosenDesktop + '"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  console.log('PASS existing device retains its own desktop after a different device selects default');
  // Project suspension is enforced at the Go entry, before the Node engine.
  await syncPool.query(
    'UPDATE backend_users SET disabled=true WHERE account_id=$1',
    [account],
  );
  const blocked = await page.evaluate(
    ({ issuer, sub }) =>
      chrome.runtime.sendMessage({
        type: 'duoyu-auth',
        action: 'sync',
        account: { issuer, sub },
        path: '/api/v1/sync/snapshot',
        method: 'GET',
      }),
    { issuer: origin, sub: userId },
  );
  assert.equal(blocked.status, 403);
  await syncPool.query(
    'UPDATE backend_users SET disabled=false WHERE account_id=$1',
    [account],
  );
  console.log(
    'PASS disabled project account cannot access sync with a valid ID session',
  );
  if (process.argv.includes('--sync-load')) {
    // A bounded authenticated read burst, through the actual extension worker,
    // Go gateway, Node engine and PostgreSQL. This is not a capacity promise.
    const metrics = await page.evaluate(
      async ({ issuer, sub }) => {
        const durations = [],
          failures = [];
        const started = performance.now();
        await Promise.all(
          Array.from({ length: 8 }, async () => {
            for (let i = 0; i < 8; i++) {
              const began = performance.now();
              const response = await chrome.runtime.sendMessage({
                type: 'duoyu-auth',
                action: 'sync',
                account: { issuer, sub },
                path: '/api/v1/sync/snapshot',
                method: 'GET',
              });
              durations.push(performance.now() - began);
              if (
                response.status !== 200 ||
                !response.data?.entities?.some(
                  (entity) => entity.payload?.name === '真实认证同步收藏',
                )
              )
                failures.push({
                  status: response.status,
                  error: response.error,
                });
            }
          }),
        );
        durations.sort((a, b) => a - b);
        return {
          requests: durations.length,
          concurrency: 8,
          failures,
          elapsedMs: performance.now() - started,
          p50Ms: durations[31],
          p95Ms: durations[60],
          maxMs: durations.at(-1),
          scope:
            '64 authenticated snapshot reads; small fixture, not production capacity or endurance',
        };
      },
      { issuer: origin, sub: userId },
    );
    await writeFile(
      path.join(evidence, 'sync-read-burst.json'),
      JSON.stringify(metrics, null, 2),
    );
    assert.equal(metrics.requests, 64);
    assert.deepEqual(metrics.failures, []);
    console.log(
      'PASS 64 authenticated snapshot reads at concurrency 8 through the real four-service chain',
    );
  }
  if (process.argv.includes('--multi-account-soak')) {
    const { measureAccountIsolation } = await import('./fixtures/multi-account-soak.mjs');
    await measureAccountIsolation({ page, origin, extension, extensionId, pin, signIn, db, syncPool, userId, clientId, evidence });
  }
  if (process.argv.includes('--id-pages')) {
    const { reviewIdentityPages } = await import('./fixtures/id-pages.mjs');
    await reviewIdentityPages({
      context,
      origin,
      db,
      userId,
      clientId,
      evidence,
    });
  }
  if (process.argv.includes('--admin-pages')) {
    const { reviewBusinessPages } =
      await import('./fixtures/business-pages.mjs');
    await reviewBusinessPages({
      context,
      origin: businessOrigin,
      assetOrigin: backendOrigin,
      syncPool,
      account,
      evidence,
    });
  }
  if (process.argv.includes('--large-restore')) {
    const { reviewLargeAccountRestore } =
      await import('./fixtures/large-account-restore.mjs');
    await reviewLargeAccountRestore({
      page,
      issuer: origin,
      sub: userId,
      evidence,
    });
  }
  if (process.argv.includes('--import-boundaries')) {
    const { verifyImportBoundaries } =
      await import('./fixtures/import-boundaries.mjs');
    await verifyImportBoundaries({ page, syncPool, account, evidence });
  }
  if (process.argv.includes('--import-layout')) {
    const { verifyImportLayout } = await import('./fixtures/import-layout.mjs');
    await verifyImportLayout({ page, syncPool, account, evidence });
  }
  if (process.argv.includes('--sync-sustained')) {
    assert.ok(
      process.argv.includes('--large-restore'),
      'Use --large-restore to populate the real workload',
    );
    const { measureSustainedSync } =
      await import('./fixtures/sustained-sync.mjs');
    await measureSustainedSync({
      page,
      issuer: origin,
      sub: userId,
      syncPool,
      evidence,
    });
  }
  if (process.argv.includes('--device-write-load')) {
    const { measureDeviceWrites } =
      await import('./fixtures/device-write-load.mjs');
    await measureDeviceWrites({
      page,
      extension,
      extensionId,
      pin,
      origin,
      signIn,
      syncPool,
      account,
      evidence,
    });
  }
  if (process.argv.includes('--export-boundaries')) {
    const { verifyExportBoundaries } =
      await import('./fixtures/export-boundaries.mjs');
    await verifyExportBoundaries({ page, evidence });
  }
  if (process.argv.includes('--legacy-unpacked')) {
    const { verifyLegacyImport } =
      await import('./fixtures/distribution-migration.mjs');
    await verifyLegacyImport({
      legacy: process.argv[process.argv.indexOf('--legacy-unpacked') + 1],
      page,
      syncPool,
      account,
      evidence,
    });
  }
  if (process.argv.includes('--id-security')) {
    const { reviewIdentitySecurity } =
      await import('./fixtures/id-security.mjs');
    await reviewIdentitySecurity({
      context,
      origin,
      db,
      userId,
      email,
      fixtureSecret,
      evidence,
    });
  }
  completed = true;
  console.log(
    'PASS logout revokes tokens; no project mail queued; test schema is removed on exit',
  );
} catch (error) {
  for (const [index, openPage] of (context?.pages() ?? []).entries()) {
    if (openPage.isClosed() || openPage === page) continue;
    await openPage.screenshot({
      path: path.join(evidence, `failure-popup-${index}.png`),
    });
    await writeFile(
      path.join(evidence, `popup-${index}.txt`),
      await openPage.locator('body').innerText(),
    );
  }
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(evidence, 'failure.png') });
    await writeFile(
      path.join(evidence, 'page.txt'),
      await page.locator('body').innerText(),
    );
  }
  throw error;
} finally {
  const cleanup = await Promise.allSettled([
    context?.close(),
    tlsServer &&
      new Promise((resolve, reject) =>
        tlsServer.close((error) => (error ? reject(error) : resolve())),
      ),
    syncServer &&
      new Promise((resolve, reject) =>
        syncServer.close((error) => (error ? reject(error) : resolve())),
      ),
    (async () => {
      if (server && server.exitCode === null) {
        const closed = once(server, 'close');
        server.kill();
        await closed;
      }
    })(),
    (async () => {
      if (backend && backend.exitCode === null) {
        const closed = once(backend, 'close');
        backend.kill();
        await closed;
      }
    })(),
  ]);
  await syncPool?.end();
  try {
    if (schemaCreated) await db.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally {
    await db.end();
    await writeFile(path.join(evidence, 'server.log'), serverOutput);
    await writeFile(path.join(evidence, 'backend.log'), backendOutput);
  }
  const failures = cleanup.filter((result) => result.status === 'rejected');
  await writeFile(
    path.join(evidence, 'results.json'),
    JSON.stringify(
      { passed: completed && !failures.length, schemaRemoved: true },
      null,
      2,
    ),
  );
  console.log('Evidence: ' + evidence);
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Fixture cleanup failed',
    );
}
