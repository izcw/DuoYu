import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

// Synthetic email challenges exercise validation without requesting mail. CDP's
// virtual authenticator verifies the WebAuthn protocol, not physical devices.
export async function reviewIdentitySecurity({
  context,
  origin,
  db,
  userId,
  email,
  fixtureSecret,
  evidence,
}) {
  const requireID = createRequire(
    path.resolve('../DuoYu-ID/admin/package.json'),
  );
  const jsQR = requireID('jsqr'),
    { PNG } = requireID('pngjs');
  const page = await context.newPage();
  const desktop = await context
    .browser()
    .newContext({ viewport: { width: 1440, height: 1000 } });
  desktop.setDefaultTimeout(15000);
  await desktop.route('**/api/auth/code', (route) => route.abort());
  const login = await desktop.newPage();
  const results = [],
    errors = [];
  let passed = false;
  for (const p of [page, login])
    p.on('pageerror', (e) => errors.push(e.message));
  const seed = async (purpose) => {
    const digest = createHmac('sha256', Buffer.from(fixtureSecret, 'hex'))
      .update(`${email}|${purpose}|123456`)
      .digest('hex');
    await db.query(
      `INSERT INTO challenges(email,purpose,digest,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')
      ON CONFLICT(email,purpose) DO UPDATE SET digest=EXCLUDED.digest,attempts=0,expires_at=EXCLUDED.expires_at`,
      [email, purpose, digest],
    );
  };
  const consent = async (p) => {
    await expect(p.locator('#legal-accept')).not.toBeChecked();
    await p.locator('#legal-accept').check();
  };
  const qrData = (image) => {
    const png = PNG.sync.read(Buffer.from(image.split(',')[1], 'base64'));
    const decoded = jsQR(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    );
    assert.ok(decoded, 'Actual QR image must decode');
    return decoded.data;
  };
  try {
    await page.goto(origin + '/#/account/profile');
    await expect(
      page.getByRole('heading', { name: '账号与安全', exact: true }),
    ).toBeVisible();
    await page.route('**/api/me/authenticator', route => route.fulfill({
      status: 503, contentType: 'application/json', body: '{"msg":"test outage"}',
    }), { times: 1 });
    await page.goto(origin + '/#/account/security?action=authenticator');
    await expect(page.getByRole('button', { name: '重新读取状态' })).toBeVisible();
    await expect(page.getByRole('button', { name: '验证邮箱并继续' })).toHaveCount(0);
    await page.getByRole('button', { name: '重新读取状态' }).click();
    await expect(page.getByRole('button', { name: '验证邮箱并继续' })).toBeVisible();
    await page.goto(origin + '/#/account/profile');
    results.push({flow:'authenticator status failure blocks enrollment until a successful retry',passed:true});
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await seed('login');
    await page.getByRole('button', { name: '添加手机', exact: true }).click();
    await page.getByPlaceholder('6 位验证码', { exact: true }).click();
    await page.getByPlaceholder('6 位验证码', { exact: true }).fill('123456');
    // Fill the last slots after begin returned, before the signed finish arrives.
    await page.route('**/api/me/passkeys/finish', async route => {
      await db.query("INSERT INTO passkeys(id,user_id,name,credential) SELECT 'cap-fixture-'||n,$1,'fixture','{}'::jsonb FROM generate_series(1,10) n", [userId]);
      await route.continue();
    }, { times: 1 });
    const [full] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/me/passkeys/finish')),
      page.getByRole('button', { name: '继续', exact: true }).click(),
    ]);
    assert.equal(full.status(), 409);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM passkeys WHERE user_id=$1',[userId])).rows[0].n,10);
    await db.query("DELETE FROM passkeys WHERE user_id=$1 AND id LIKE 'cap-fixture-%'",[userId]);
    for (const credential of (await cdp.send('WebAuthn.getCredentials',{authenticatorId})).credentials)
      await cdp.send('WebAuthn.removeCredential',{authenticatorId,credentialId:credential.credentialId});
    await seed('login');
    results.push({flow:'concurrent enrollment reaches cap before signed registration finishes',passed:true});
    const [registered] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/me/passkeys/finish')),
      page.getByRole('button', { name: '继续', exact: true }).click(),
    ]);
    assert.equal(registered.status(), 200);
    await page.waitForURL(origin + '/#/account/profile');
    const credentials = (
      await (await context.request.get(origin + '/api/me/passkeys')).json()
    ).data;
    assert.equal(credentials.length, 1);
    assert.equal(credentials[0].qr_enabled, true);
    assert.equal('credential' in credentials[0], false);
    results.push({
      flow: 'WebAuthn registration with virtual authenticator and private credential fields',
      passed: true,
    });

    await login.goto(origin + '/login');
    await consent(login);
    await login.route('**/api/auth/qr/*/poll', route => route.fulfill({status:503,contentType:'application/json',body:'{"msg":"test outage"}'}),{times:1});
    const [created] = await Promise.all([
      login.waitForResponse((r) => r.url().endsWith('/api/auth/qr')),
      login.locator('#qr-open').click(),
    ]);
    assert.equal(created.status(), 200);
    const qr = (await created.json()).data;
    await expect(login.locator('#qr-status')).toHaveText('连接暂时中断，正在重试');
    await expect(login.locator('#qr-status')).toContainText('系统相机扫码');
    results.push({flow:'desktop retries a transient 503 and keeps the original QR',passed:true});
    const scan = new URL(qrData(qr.image));
    assert.equal(scan.origin, origin);
    assert.equal(scan.pathname, '/scan');
    await page.goto(scan.href);
    await expect(page.locator('#verify')).toBeEnabled();
    await expect(page.locator('#label')).toHaveText(qr.label);
    await expect(page.locator('#approve')).not.toBeVisible();
    await consent(page);
    const saved = (await db.query('SELECT credential FROM passkeys WHERE id=$1',[credentials[0].id])).rows[0].credential;
    await db.query(`CREATE FUNCTION fail_security_session() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture'; END$$;
      CREATE TRIGGER fail_security_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION fail_security_session()`);
    try {
      const [failed] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/api/auth/passkey/finish')),
        page.locator('#verify').click(),
      ]);
      assert.ok(failed.status()>=500);
      assert.deepEqual((await db.query('SELECT credential FROM passkeys WHERE id=$1',[credentials[0].id])).rows[0].credential,saved);
    } finally {
      await db.query('DROP TRIGGER fail_security_session ON sessions; DROP FUNCTION fail_security_session()');
    }
    results.push({flow:'failed session insertion rolls back the signed passkey counter update',passed:true});
    const [verified] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/passkey/finish')),
      page.locator('#verify').click(),
    ]);
    assert.equal(verified.status(), 200);
    await expect(page.locator('#account')).toHaveText(email);
    await page.locator('#approve').click();
    await login.waitForURL(origin + '/#/account/profile');
    const logged = (
      await (await desktop.request.get(origin + '/api/me')).json()
    ).data;
    assert.equal(logged.email, email);
    const replay = await login.evaluate(
      async (id) =>
        (
          await (
            await fetch('/api/auth/qr/' + id + '/poll', {
              method: 'POST',
              headers: {
                'X-Duoyu-Request': '1',
                'X-Duoyu-Legal-Version': '2026-10-29',
                'X-Duoyu-Adult': 'true',
              },
            })
          ).json()
        ).data.status,
      qr.id,
    );
    assert.equal(replay, 'expired');
    results.push({
      flow: 'decoded QR, separate browser sessions, passkey verification, explicit approval, one-use grant',
      passed: true,
    });
    console.log(
      'PASS isolated virtual WebAuthn and real QR approval/one-use login (no SMTP)',
    );

    await page.goto(origin + '/#/account/security?action=authenticator');
    await expect(
      page.getByRole('heading', { name: '绑定身份验证器', exact: true }),
    ).toBeVisible();
    await seed('email');
    await page.getByPlaceholder('6 位邮箱验证码').fill('123456');
    await page
      .getByRole('button', { name: '验证邮箱并继续', exact: true })
      .click();
    await expect(page.locator('.dy-authenticator-qr')).toBeVisible();
    const secret = await page.locator('.dy-authenticator-secret').innerText();
    const uri = new URL(
      qrData(await page.locator('.dy-authenticator-qr').getAttribute('src')),
    );
    assert.equal(uri.protocol, 'otpauth:');
    assert.equal(uri.searchParams.get('secret'), secret);
    assert.equal(uri.searchParams.get('issuer'), 'DuoYu ID');
    const totp = () => {
      const bits = [...secret]
        .map((c) =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
            .indexOf(c)
            .toString(2)
            .padStart(5, '0'),
        )
        .join('');
      const key = Buffer.from(
        bits.match(/.{8}/g).map((value) => parseInt(value, 2)),
      );
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
      const digest = createHmac('sha1', key).update(counter).digest(),
        offset = digest[19] & 15;
      return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
        .toString()
        .padStart(6, '0');
    };
    await page.getByPlaceholder('6 位动态验证码').fill(totp());
    await page.getByRole('button', { name: '确认绑定', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '保存恢复码', exact: true }),
    ).toBeVisible();
    const recovery = await page
      .locator('.dy-recovery-codes code')
      .allTextContents();
    assert.equal(recovery.length, 8);
    assert.equal(new Set(recovery).size, 8);
    await page
      .getByRole('button', { name: '已保存，完成', exact: true })
      .click();
    await page.waitForURL(origin + '/#/account/profile');
    // Reset only the synthetic account's consumed step to test login without
    // sleeping across a 30-second clock boundary. Replay remains covered below.
    await db.query('UPDATE authenticators SET last_step=-1 WHERE user_id=$1', [
      userId,
    ]);
    await desktop.clearCookies();
    await login.goto(origin + '/login');
    await login.locator('#authenticator-open').click();
    await login.locator('#authenticator-account').fill(email);
    const loginCode = totp();
    await login.locator('#authenticator-code').fill(loginCode);
    await consent(login);
    await login.locator('#authenticator-submit').click();
    await login.waitForURL(origin + '/#/account/profile');
    assert.equal(
      (await (await desktop.request.get(origin + '/api/me')).json()).data.email,
      email,
    );
    const replayCode = async (code, recovery = false) =>
      login.evaluate(
        async (body) =>
          (
            await fetch('/api/auth/authenticator', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Duoyu-Request': '1',
                'X-Duoyu-Legal-Version': '2026-10-29',
                'X-Duoyu-Adult': 'true',
              },
              body: JSON.stringify(body),
            })
          ).status,
        { account: email, code, recovery },
      );
    assert.equal(
      await replayCode(loginCode),
      401,
      'Consumed TOTP cannot create another session',
    );
    results.push({
      flow: 'TOTP QR/secret consistency, enrollment, eight unique recovery codes, dynamic-code login and replay rejection',
      passed: true,
    });
    console.log('PASS isolated TOTP enrollment and actual dynamic-code login');

    await desktop.clearCookies();
    await login.goto(origin + '/login');
    await login.locator('#authenticator-open').click();
    await login.locator('#authenticator-recovery').click();
    await login.locator('#authenticator-account').fill(email);
    await login.locator('#authenticator-code').fill(recovery[0]);
    await consent(login);
    await login.locator('#authenticator-submit').click();
    await login.waitForURL(origin + '/#/account/profile');
    const remaining = (
      await (await desktop.request.get(origin + '/api/me/authenticator')).json()
    ).data.recovery_remaining;
    assert.equal(remaining, 7);
    assert.equal(
      await replayCode(recovery[0], true),
      401,
      'Recovery codes are single use',
    );
    await page.goto(origin + '/#/account/security?action=authenticator');
    await expect(
      page.getByRole('heading', { name: '已绑定身份验证器', exact: true }),
    ).toBeVisible();
    await seed('email');
    await page.getByPlaceholder('6 位邮箱验证码').fill('123456');
    await page.locator('label.el-checkbox').click();
    await page.getByPlaceholder('输入一个尚未使用的恢复码').fill(recovery[1]);
    await page
      .getByRole('button', { name: '解绑身份验证器', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '确定', exact: true })
      .click();
    await page.waitForURL(origin + '/login');
    assert.equal(
      (await desktop.request.get(origin + '/api/me')).status(),
      401,
      'Unbinding must revoke other browser sessions',
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM authenticators WHERE user_id=$1',
          [userId],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM mail_messages')).rows[0].n,
      0,
    );
    assert.deepEqual(errors, []);
    results.push({
      flow: 'recovery-code login consumes one code; unbinding revokes all browser sessions',
      passed: true,
    });
    console.log(
      'PASS recovery-code consumption, unbinding and cross-browser session revocation',
    );
    passed = true;
  } finally {
    await writeFile(
      path.join(evidence, 'identity-security.json'),
      JSON.stringify(
        {
          passed,
          results,
          errors,
          virtualAuthenticator: true,
          syntheticEmailChallenges: true,
          smtpSent: false,
        },
        null,
        2,
      ),
    );
    await page.close();
    await desktop.close();
  }
}
