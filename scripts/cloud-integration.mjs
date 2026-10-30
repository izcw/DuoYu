import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';
import pg from '../server/sync/node_modules/pg/lib/index.js';
import { createSyncServer, accountId } from '../server/sync/src/http.mjs';
import { applyOperation } from '../server/sync/src/store.mjs';
const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 55432,
  user: 'duoyu',
  password: 'duoyu_dev_only',
  database: 'duoyu_sync_test',
});
await pool.query(await readFile('server/sync/schema.sql', 'utf8'));
const account = {
  issuer: 'https://identity.test',
  sub: randomUUID(),
  name: 'test',
  email: '',
  picture: '',
};
const backend = { ...account, id: accountId(account.issuer, account.sub) };
const server = createSyncServer({
  pool,
  origins: [],
  authenticate: async () => backend,
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
globalThis.__syncTest = {
  account,
  origin: 'http://127.0.0.1:' + server.address().port,
  offline: false,
  drop: false,
};
const data = new Map([
  [
    'duoyu-sync-account',
    createHash('sha256')
      .update(account.issuer + '\0' + account.sub)
      .digest('hex'),
  ],
]);
globalThis.localStorage = {
  getItem: (k) => data.get(k) ?? null,
  setItem: (k, v) => data.set(k, v),
  removeItem: (k) => data.delete(k),
};
globalThis.window = new EventTarget();
globalThis.document = {
  documentElement: { dataset: {} },
  createElement: () => ({}),
};
globalThis.location = {
  reload() {
    throw Error('unexpected account reload');
  },
};
if (!navigator.locks)
  Object.defineProperty(navigator, 'locks', {
    value: { request: async (_name, fn) => fn() },
  });
await mkdir('work/sync-integration', { recursive: true });
const replacements = {
  "'../../shared/storage/database'": "'./database.mjs'",
  "'../../shared/storage/account'": "'./account.mjs'",
  "'../auth/config'": "'./auth.mjs'",
  "'./account'": "'./account.mjs'",
  "'../../features/sync/capture'": "'./capture.mjs'",
  "'./capture'": "'./capture.mjs'",
  "'./model'": "'./model.mjs'",
  "'wxt/browser'": "'./browser.mjs'",
};
for (const [name, path] of Object.entries({
  client: 'src/features/sync/client.ts',
  capture: 'src/features/sync/capture.ts',
  model: 'src/features/sync/model.ts',
  database: 'src/shared/storage/database.ts',
  account: 'src/shared/storage/account.ts',
})) {
  let source = await readFile(path, 'utf8');
  for (const [a, b] of Object.entries(replacements))
    source = source.replaceAll(a, b);
  await writeFile(
    'work/sync-integration/' + name + '.mjs',
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
}
await writeFile(
  'work/sync-integration/auth.mjs',
  "export const AUTH_SESSION_KEY='auth';",
);
await writeFile(
  'work/sync-integration/browser.mjs',
  `export const browser={storage:{session:{onChanged:{addListener(){}}},local:{get:async()=>({})}},runtime:{sendMessage:async m=>{const t=globalThis.__syncTest;if(m.action==='status')return{view:{account:t.account}};if(t.offline)throw Error('offline');const response=await fetch(t.origin+m.path,{method:m.method,headers:m.method==='POST'?{'Content-Type':m.binary?m.mediaType:'application/json'}:{},body:m.method==='POST'?m.binary?Buffer.from(m.body,'base64'):JSON.stringify(m.body):undefined});if(m.method==='POST'&&t.drop){t.drop=false;throw Error('response lost');}return{status:response.status,data:m.binary&&m.method==='GET'&&response.ok?{base64:Buffer.from(await response.arrayBuffer()).toString('base64'),mediaType:response.headers.get('content-type')}:await response.json()};}}};`,
);
const { database } = await import('../work/sync-integration/database.mjs');
const client = await import('../work/sync-integration/client.mjs');
try {
  await client.initializeCloud();
  assert.equal(client.syncState.value.status, '已同步');
  const page = { id: 'p', name: 'page', order: 0 },
    item = {
      id: 'i',
      kind: 'link',
      pageId: 'p',
      parent: '',
      name: 'start',
      url: 'https://example.com',
      icon: '',
      order: 0,
      width: 1,
      height: 1,
      gridX: 0,
      gridY: 0,
    };
  await database.transaction(
    'rw',
    database.libraryPages,
    database.libraryItems,
    async () => {
      await database.libraryPages.put(page);
      await database.libraryItems.put(item);
    },
  );
  assert.equal(await database.syncOutbox.count(), 1);
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 0);
  __syncTest.offline = true;
  await database.libraryItems.update('i', { name: 'offline' });
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 1);
  assert.equal((await database.libraryItems.get('i')).name, 'offline');
  __syncTest.offline = false;
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 0);
  let shadow = await database.syncShadow.get('libraryItems:i');
  await applyOperation(pool, backend, {
    id: randomUUID(),
    deviceId: randomUUID(),
    changes: [
      {
        table: 'libraryItems',
        id: 'i',
        base: shadow.payload,
        value: { ...shadow.payload, name: 'remote' },
        revision: shadow.revision,
      },
    ],
  });
  await database.libraryItems.update('i', { url: 'https://local.example' });
  await client.syncNow();
  let saved = await database.libraryItems.get('i');
  assert.equal(saved.name, 'remote');
  assert.equal(saved.url, 'https://local.example');
  shadow = await database.syncShadow.get('libraryItems:i');
  await applyOperation(pool, backend, {
    id: randomUUID(),
    deviceId: randomUUID(),
    changes: [
      {
        table: 'libraryItems',
        id: 'i',
        base: shadow.payload,
        value: { ...shadow.payload, name: 'cloud-wins' },
        revision: shadow.revision,
      },
    ],
  });
  await database.libraryItems.update('i', { name: 'local-conflict' });
  await client.syncNow();
  assert.equal((await database.libraryItems.get('i')).name, 'cloud-wins');
  assert.equal(await database.syncConflicts.count(), 1);
  await database.libraryItems.update('i', { name: 'uncertain' });
  __syncTest.drop = true;
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 1);
  const head = (
    await pool.query('SELECT head_revision FROM sync_accounts WHERE id=$1', [
      backend.id,
    ])
  ).rows[0].head_revision;
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 0);
  assert.equal(
    (
      await pool.query('SELECT head_revision FROM sync_accounts WHERE id=$1', [
        backend.id,
      ])
    ).rows[0].head_revision,
    head,
  );
  assert.equal((await database.libraryItems.get('i')).name, 'uncertain');
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLZ0AAAAASUVORK5CYII=';
  await database.libraryItems.update('i', {
    icon:
      'duoyu-icon:' +
      JSON.stringify({
        mode: 'upload',
        image: png,
        material: 'glass',
        color: '',
      }),
  });
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 0);
  const icon = (
    await pool.query(
      'SELECT payload FROM sync_entities WHERE account_id=$1 AND entity_id=$2',
      [backend.id, 'i'],
    )
  ).rows[0].payload.icon;
  assert(icon.includes('duoyu-asset:'));
  assert(!icon.includes('base64'));
  assert(
    (await database.libraryItems.get('i')).icon.includes('data:image/png'),
  );
  console.log(
    'PASS full client ↔ PostgreSQL: cloud bootstrap, durable queue, offline recovery, field merge, cloud-priority conflict copy, lost-response idempotent retry',
  );
} finally {
  client.stopCloud();
  await database.delete();
  await new Promise((r) => server.close(r));
  for (const table of [
    'sync_assets',
    'sync_conflicts',
    'sync_receipts',
    'sync_changes',
    'sync_entities',
  ])
    await pool.query('DELETE FROM ' + table + ' WHERE account_id=$1', [
      backend.id,
    ]);
  await pool.query('DELETE FROM sync_accounts WHERE id=$1', [backend.id]);
  await pool.end();
}
