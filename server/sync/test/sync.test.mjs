import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { applyOperation, merge } from '../src/store.mjs';
import { createSyncServer } from '../src/http.mjs';
const pool = new Pool({
  host: '127.0.0.1',
  port: 55432,
  user: 'duoyu',
  password: 'duoyu_dev_only',
  database: 'duoyu_sync_test',
});
await pool.query(
  await readFile(new URL('../schema.sql', import.meta.url), 'utf8'),
);
const a = {
    id: randomUUID(),
    issuer: 'https://test.invalid',
    sub: randomUUID(),
  },
  b = { id: randomUUID(), issuer: a.issuer, sub: randomUUID() };
const page = { id: 'p', name: 'one', order: 0 };
const operation = (changes) => ({
  id: randomUUID(),
  deviceId: randomUUID(),
  changes,
});
const change = (table, id, base, value, revision = '0') => ({
  table,
  id,
  base,
  value,
  revision,
});
await test('PostgreSQL sync transactions and API', async (t) => {
  await t.test(
    'create, uncertain retry and changed-body idempotency',
    async () => {
      const op = operation([change('libraryPages', 'p', null, page)]);
      const first = await applyOperation(pool, a, op);
      assert.equal(first.revision, '1');
      assert.deepEqual(await applyOperation(pool, a, op), first);
      await assert.rejects(
        applyOperation(pool, a, {
          ...op,
          changes: [
            change('libraryPages', 'p', null, { ...page, name: 'other' }),
          ],
        }),
        (e) => e.code === 'idempotency_mismatch',
      );
    },
  );
  await t.test(
    'different fields merge; same field conflict retains remote',
    async () => {
      const first = await applyOperation(
        pool,
        a,
        operation([
          change('libraryPages', 'p', page, { ...page, icon: 'Home' }, '1'),
        ]),
      );
      assert.equal(first.status, 'applied');
      const second = await applyOperation(
        pool,
        a,
        operation([
          change('libraryPages', 'p', page, { ...page, name: 'two' }, '1'),
        ]),
      );
      assert.equal(second.status, 'applied');
      assert.equal(second.changes[0].payload.icon, 'Home');
      const third = await applyOperation(
        pool,
        a,
        operation([
          change('libraryPages', 'p', page, { ...page, name: 'three' }, '1'),
        ]),
      );
      assert.equal(third.status, 'conflict');
      assert.equal(
        (
          await pool.query(
            'SELECT payload FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
            [a.id, 'p'],
          )
        ).rows[0].payload.name,
        'two',
      );
    },
  );
  await t.test(
    'atomic layout and rollback when a member conflicts',
    async () => {
      const x = {
        id: 'x',
        kind: 'link',
        name: 'x',
        url: 'https://example.com',
        icon: '',
        parent: '',
        pageId: 'p',
        gridX: 0,
        gridY: 0,
        width: 1,
        height: 1,
        order: 0,
      };
      const y = { ...x, id: 'y', name: 'y', gridX: 1, order: 1 };
      const created = await applyOperation(
        pool,
        a,
        operation([
          change('libraryItems', 'x', null, x),
          change('libraryItems', 'y', null, y),
        ]),
      );
      assert.equal(created.status, 'applied');
      const moved = await applyOperation(
        pool,
        a,
        operation([
          change('libraryItems', 'x', x, { ...x, gridX: 1 }, created.revision),
          change('libraryItems', 'y', y, { ...y, gridX: 2 }, created.revision),
        ]),
      );
      assert.equal(moved.status, 'applied');
      const conflict = await applyOperation(
        pool,
        a,
        operation([
          change('libraryItems', 'x', x, { ...x, gridX: 3 }, created.revision),
          change(
            'libraryItems',
            'y',
            y,
            { ...y, name: 'should not apply' },
            created.revision,
          ),
        ]),
      );
      assert.equal(conflict.status, 'conflict');
      assert.equal(
        (
          await pool.query(
            'SELECT payload FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
            [a.id, 'y'],
          )
        ).rows[0].payload.name,
        'y',
      );
    },
  );
  await t.test('deletion wins over stale edit; no resurrection', async () => {
    const rows = (
      await pool.query(
        'SELECT payload,revision::text FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
        [a.id, 'x'],
      )
    ).rows[0];
    await applyOperation(
      pool,
      a,
      operation([
        change('libraryItems', 'x', rows.payload, null, rows.revision),
      ]),
    );
    assert.equal(
      (
        await applyOperation(
          pool,
          a,
          operation([
            change(
              'libraryItems',
              'x',
              rows.payload,
              { ...rows.payload, name: 'revive' },
              rows.revision,
            ),
          ]),
        )
      ).status,
      'conflict',
    );
  });
  await t.test(
    'non-owner runtime role is constrained by forced row security',
    async () => {
      const role = 'sync_test_' + randomUUID().replaceAll('-', '').slice(0, 12),
        password = randomUUID();
      await pool.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await pool.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
      );
      const runtime = new Pool({
        host: '127.0.0.1',
        port: 55432,
        user: role,
        password,
        database: 'duoyu_sync_test',
      });
      try {
        assert.equal(
          (await runtime.query('SELECT * FROM sync_entities')).rowCount,
          0,
        );
        const op = operation([
          change('libraryPages', 'runtime', null, {
            id: 'runtime',
            name: 'runtime',
            order: 3,
          }),
        ]);
        assert.equal((await applyOperation(runtime, a, op)).status, 'applied');
        const db = await runtime.connect();
        try {
          await db.query('BEGIN');
          await db.query("SELECT set_config('app.account_id',$1,true)", [b.id]);
          assert.equal(
            (
              await db.query(
                'SELECT * FROM sync_entities WHERE account_id=$1',
                [a.id],
              )
            ).rowCount,
            0,
          );
          await db.query('ROLLBACK');
        } finally {
          db.release();
        }
      } finally {
        await runtime.end();
        await pool.query(`DROP OWNED BY ${role}`);
        await pool.query(`DROP ROLE ${role}`);
      }
    },
  );
  await t.test(
    'concurrent devices commit monotonic account revision',
    async () => {
      const operations = Array.from({ length: 12 }, (_, i) =>
        operation([
          change('libraryPages', 'parallel-' + i, null, {
            id: 'parallel-' + i,
            name: 'page',
            order: i,
          }),
        ]),
      );
      const result = await Promise.all(
        operations.map((op) => applyOperation(pool, b, op)),
      );
      assert.equal(new Set(result.map((r) => r.revision)).size, 12);
      assert.equal(Math.max(...result.map((r) => Number(r.revision))), 12);
    },
  );
  const server = createSyncServer({
    pool,
    origins: ['chrome-extension://test'],
    authenticate: async (req) => {
      if (req.headers.authorization === 'Bearer a') return a;
      if (req.headers.authorization === 'Bearer b') return b;
      throw Object.assign(Error(), { status: 401, code: 'invalid_token' });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    await t.test(
      'snapshot isolation and cross-account access denied',
      async () => {
        const r = await fetch(origin + '/v1/sync/snapshot', {
          headers: { Authorization: 'Bearer b' },
        });
        const s = await r.json();
        assert.equal(s.entities.length, 12);
        assert(s.entities.every((e) => e.id.startsWith('parallel-')));
        assert.equal((await fetch(origin + '/v1/sync/snapshot')).status, 401);
        assert.equal(
          (
            await fetch(origin + '/v1/sync/snapshot', {
              headers: {
                Origin: 'https://evil.invalid',
                Authorization: 'Bearer a',
              },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'incremental pull never splits an atomic operation',
      async () => {
        const r = await fetch(origin + '/v1/sync/changes?after=0', {
          headers: { Authorization: 'Bearer a' },
        });
        const s = await r.json();
        assert(s.operations.some((o) => o.changes.length === 2));
        assert.equal(s.revision, s.head);
      },
    );
    await t.test('asset validation and per-account isolation', async () => {
      const sha = 'a'.repeat(64);
      assert.equal(
        (
          await fetch(origin + '/v1/assets/' + sha, {
            method: 'POST',
            headers: { Authorization: 'Bearer a', 'Content-Type': 'image/png' },
            body: 'bad',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(origin + '/v1/assets/' + sha, {
            headers: { Authorization: 'Bearer b' },
          })
        ).status,
        404,
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
await pool.query('DELETE FROM sync_assets WHERE account_id=ANY($1::uuid[])', [
  [a.id, b.id],
]);
for (const table of [
  'sync_conflicts',
  'sync_receipts',
  'sync_changes',
  'sync_entities',
])
  await pool.query(`DELETE FROM ${table} WHERE account_id=ANY($1::uuid[])`, [
    [a.id, b.id],
  ]);
await pool.query('DELETE FROM sync_accounts WHERE id=ANY($1::uuid[])', [
  [a.id, b.id],
]);
await pool.end();
