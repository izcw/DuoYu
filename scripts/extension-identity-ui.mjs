// A disposable public key verifies build validation and cross-directory IDs.
// No store registration, production configuration or signing key is changed.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'wxt';

await mkdir('work', { recursive: true });
const evidence = await mkdtemp(path.resolve('work/extension-identity-'));
const unpacked = process.argv[2];
const der = unpacked
  ? Buffer.from(
      JSON.parse(await readFile('extension-identity.json')).key,
      'base64',
    )
  : generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
      format: 'der',
      type: 'spki',
    });
const key = der.toString('base64');
const expectedId = createHash('sha256')
  .update(der)
  .digest('hex')
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (n) => String.fromCharCode(97 + parseInt(n, 16)));
const previous = process.env.VITE_EXTENSION_PUBLIC_KEY;
const results = [];
let passed = false;
let invalidKeysRejected = 0;
try {
  if (!unpacked) {
    for (const invalid of [
      'not-base64',
      '-----BEGIN PRIVATE KEY-----invalid-----END PRIVATE KEY-----',
    ]) {
      process.env.VITE_EXTENSION_PUBLIC_KEY = invalid;
      await assert.rejects(
        build({
          outDir: path.join(evidence, 'invalid'),
          browser: 'chrome',
          mode: 'production',
        }),
        /VITE_EXTENSION_PUBLIC_KEY/,
      );
      invalidKeysRejected++;
    }
    process.env.VITE_EXTENSION_PUBLIC_KEY = key;
    await build({
      outDir: path.join(evidence, 'build'),
      browser: 'chrome',
      mode: 'production',
    });
  }
  const original = unpacked
    ? path.resolve(unpacked)
    : path.join(evidence, 'build/chrome-mv3');
  const copied = path.join(evidence, 'another-directory/extension');
  await cp(original, copied, { recursive: true });
  assert.equal(
    JSON.parse(await readFile(path.join(original, 'manifest.json'))).key,
    key,
  );
  for (const channel of ['msedge', 'chrome']) {
    for (const [location, extension] of [
      ['original', original],
      ['copied', copied],
    ]) {
      const context = await chromium.launchPersistentContext(
        path.join(evidence, channel + '-' + location),
        {
          channel,
          headless: true,
          ignoreDefaultArgs: ['--disable-extensions'],
          args:
            channel === 'chrome'
              ? ['--enable-unsafe-extension-debugging']
              : [
                  '--load-extension=' + extension,
                  '--disable-extensions-except=' + extension,
                ],
        },
      );
      try {
        await context.route('https://**/*', (route) => route.abort());
        if (channel === 'chrome') {
          const session = await context.browser().newBrowserCDPSession();
          const loaded = await session.send('Extensions.loadUnpacked', {
            path: extension,
          });
          assert.equal(loaded.id, expectedId);
          await session.detach();
        }
        const worker =
          context.serviceWorkers()[0] ||
          (await context.waitForEvent('serviceworker'));
        const actual = await worker.evaluate(() => ({
          id: chrome.runtime.id,
          redirect: chrome.identity.getRedirectURL('oidc'),
        }));
        assert.equal(actual.id, expectedId);
        assert.equal(
          actual.redirect,
          `https://${expectedId}.chromiumapp.org/oidc`,
        );
        results.push({ channel, location, ...actual, passed: true });
      } finally {
        await context.close();
      }
    }
  }
  passed = true;
} finally {
  if (previous === undefined) delete process.env.VITE_EXTENSION_PUBLIC_KEY;
  else process.env.VITE_EXTENSION_PUBLIC_KEY = previous;
  await writeFile(
    path.join(evidence, 'results.json'),
    JSON.stringify(
      {
        passed,
        invalidKeysRejected,
        packageDirectory: unpacked ?? null,
        expectedId,
        results,
        productionRegistrationChanged: false,
      },
      null,
      2,
    ),
  );
  console.log('Evidence:', evidence);
}
