import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

// Invoked only by auth-isolated, against its disposable schema and local servers.
// Both peers authenticate via the actual extension password + PKCE flow.
export async function measureAccountIsolation({
  page,
  origin,
  extension,
  extensionId,
  pin,
  signIn,
  db,
  syncPool,
  userId,
  clientId,
  evidence,
}) {
  const contexts = [],
    peers = [],
    samples = [],
    duration = 12 * 60_000;
  const entityId = 'isolation-' + randomUUID();
  let started,
    passed = false,
    rounds = 0;
  const expiry = async (sub) =>
    Number(
      (
        await db.query(
          'SELECT extract(epoch FROM max(expires_at)) AS expiry FROM access_tokens WHERE app_id=$1 AND user_id=$2',
          [clientId, sub],
        )
      ).rows[0].expiry,
    );
  async function call(peer, endpoint, body) {
    const start = performance.now();
    const response = await peer.page.evaluate(
      ({ issuer, sub, endpoint, body }) =>
        chrome.runtime.sendMessage({
          type: 'duoyu-auth',
          action: 'sync',
          account: { issuer, sub },
          path: '/api/v1/sync/' + endpoint,
          method: body ? 'POST' : 'GET',
          body,
        }),
      { issuer: origin, sub: peer.sub, endpoint, body },
    );
    assert.equal(
      response?.status,
      200,
      'sync ' + endpoint + ' returned ' + response?.status,
    );
    samples.push(Math.round(performance.now() - start));
    return response.data;
  }
  try {
    peers.push({ page, sub: userId, label: 'account-A', device: randomUUID() });
    for (const label of ['account-B', 'account-C']) {
      const sub = randomUUID(),
        email = sub + '@example.invalid';
      assert.equal(
        (
          await db.query(
            'INSERT INTO users(id,email,name,password_hash) SELECT $1,$2,$3,password_hash FROM users WHERE id=$4',
            [sub, email, label, userId],
          )
        ).rowCount,
        1,
      );
      const ctx = await chromium.launchPersistentContext(
        path.join(evidence, label),
        {
          channel: 'msedge',
          headless: true,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: [
            `--ignore-certificate-errors-spki-list=${pin}`,
            `--load-extension=${extension}`,
            `--disable-extensions-except=${extension}`,
          ],
        },
      );
      contexts.push(ctx);
      for (const route of [
        '**/api/auth/code',
        '**/api/service/mail',
        'https://api.bimg.cc/**',
      ])
        await ctx.route(route, (r) => r.abort());
      const tab = await ctx.newPage();
      await tab.goto(`chrome-extension://${extensionId}/newtab.html`);
      await signIn(ctx, tab, origin, email);
      peers.push({ page: tab, sub, label, device: randomUUID() });
    }
    for (const peer of peers) {
      peer.firstExpiry = await expiry(peer.sub);
      assert.ok(peer.firstExpiry > 0);
    }
    started = performance.now();
    while (performance.now() - started < duration) {
      rounds++;
      await Promise.all(
        peers.map(async (peer) => {
          const snapshot = await call(peer, 'snapshot'),
            matches = snapshot.entities.filter(
              (e) => e.table === 'libraryPages' && e.id === entityId,
            );
          assert.equal(matches.length, rounds === 1 ? 0 : 1);
          const current = matches[0];
          if (current)
            assert.equal(current.payload.name, peer.label + '-' + (rounds - 1));
          const name = peer.label + '-' + rounds;
          const result = await call(peer, 'operations', {
            id: randomUUID(),
            deviceId: peer.device,
            epoch: snapshot.epoch,
            changes: [
              {
                table: 'libraryPages',
                id: entityId,
                revision: current?.revision || '0',
                base: current?.payload || null,
                value: { id: entityId, name, order: 99 },
              },
            ],
          });
          assert.equal(result.status, 'applied');
          const confirmed = (await call(peer, 'snapshot')).entities.filter(
            (e) => e.table === 'libraryPages' && e.id === entityId,
          );
          assert.equal(confirmed.length, 1);
          assert.equal(confirmed[0].payload.name, name);
        }),
      );
      if (rounds % 12 === 0)
        console.log(
          'Three-account soak:',
          rounds,
          'verified writes per account',
        );
      await delay(
        Math.min(5000, Math.max(0, duration - (performance.now() - started))),
      );
    }
    for (const peer of peers) {
      peer.expiryAdvanceSeconds = Math.round(
        (await expiry(peer.sub)) - peer.firstExpiry,
      );
      assert.ok(peer.expiryAdvanceSeconds >= 300, 'access token did not renew');
      const rows = await syncPool.query(
        "SELECT e.payload->>'name' AS name FROM sync_entities e JOIN sync_accounts a ON a.id=e.account_id WHERE a.issuer=$1 AND a.subject=$2 AND e.entity_type='libraryPages' AND e.entity_id=$3",
        [origin, peer.sub, entityId],
      );
      assert.deepEqual(rows.rows, [{ name: peer.label + '-' + rounds }]);
    }
    passed = true;
    console.log(
      'PASS three isolated accounts across token renewal:',
      rounds,
      'writes per account',
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    samples.sort((a, b) => a - b);
    await writeFile(
      path.join(evidence, 'multi-account-soak.json'),
      JSON.stringify(
        {
          passed,
          elapsedMs: started ? Math.round(performance.now() - started) : 0,
          rounds,
          accounts: peers.length,
          successfulRequests: samples.length,
          p95Ms: samples[Math.floor(samples.length * 0.95)],
          maxMs: samples.at(-1),
          tokenExpiryAdvanceSeconds: peers.map((p) => p.expiryAdvanceSeconds),
          scope:
            'three independent local Edge profiles, shared entity ID, real Go/Node/PostgreSQL, one write and two reads per account per round',
        },
        null,
        2,
      ),
    );
  }
}
