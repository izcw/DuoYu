import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { startPeer } from './fixtures/peer-driver.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';
import pg from '../../DuoYu-Backend/server/sync/node_modules/pg/lib/index.js';
import { createSyncServer, accountId } from '../../DuoYu-Backend/server/sync/src/http.mjs';
import { applyOperation as commitOperation } from '../../DuoYu-Backend/server/sync/src/store.mjs';
const pool = new pg.Pool({
  host: '127.0.0.1',
  port: 55432,
  user: 'duoyu',
  password: 'duoyu_dev_only',
  database: 'duoyu_sync_test',
});
await pool.query(await readFile(new URL('../../DuoYu-Backend/server/sync/schema.sql', import.meta.url), 'utf8'));
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
  "'./response'": "'./response.mjs'",
  "'./assets'": "'./assets.mjs'",
  "'./conflicts'": "'./conflicts.mjs'",
  "'./client'": "'./client.mjs'",
  "'wxt/browser'": "'./browser.mjs'",
};
for (const [name, path] of Object.entries({
  client: 'src/features/sync/client.ts',
  capture: 'src/features/sync/capture.ts',
  model: 'src/features/sync/model.ts',
  response: 'src/features/sync/response.ts',
  assets: 'src/features/sync/assets.ts',
  conflicts: 'src/features/sync/conflicts.ts',
  importer: 'src/features/sync/import-json.ts',
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
  `export const browser={storage:{session:{onChanged:{addListener(){}}},local:{get:async()=>({})}},runtime:{sendMessage:async m=>{const t=globalThis.__syncTest;if(m.action==='status')return{view:{account:t.account}};if(t.noResponse)return undefined;if(t.failAssets&&m.binary&&m.method==='GET')throw Error('image offline');if(t.offline)throw Error('offline');const response=await fetch(t.origin+m.path,{method:m.method,headers:m.method==='POST'?{'Content-Type':m.binary?m.mediaType:'application/json'}:{},body:m.method==='POST'?m.binary?Buffer.from(m.body,'base64'):JSON.stringify(m.body):undefined});if(m.method==='POST'&&t.drop){t.drop=false;throw Error('response lost');}return{status:response.status,data:m.binary&&m.method==='GET'&&response.ok?{base64:Buffer.from(await response.arrayBuffer()).toString('base64'),mediaType:response.headers.get('content-type')}:await response.json()};}}};`,
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
  assert((await database.libraryItems.get('i')).icon.includes('duoyu-asset:'));
  assert.equal(await database.syncAssets.count(), 1);

  const rejectedId = 'invalid-' + randomUUID();
  await database.libraryItems.put({
    ...item,
    id: rejectedId,
    url: 'javascript:bad',
    gridX: undefined,
    gridY: undefined,
  });
  await database.libraryItems.put({
    ...item,
    id: 'after-rejected',
    gridX: undefined,
    gridY: undefined,
  });
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 0);
  assert(!(await database.libraryItems.get(rejectedId)));
  assert(await database.libraryItems.get('after-rejected'));
  assert(
    (await database.syncConflicts.toArray()).some((c) => c.state === 'blocked'),
  );
  assert.match(
    client.formatSyncTime(client.syncState.value.lastSyncedAt),
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  );
  const resolution = await import('../work/sync-integration/conflicts.mjs');
  const conflict = (await database.syncConflicts.toArray()).find(
    (c) => c.reason === 'field_conflict' && !c.resolvedAt,
  );
  assert(conflict);
  await resolution.retryConflict(conflict.id);
  assert((await database.syncConflicts.get(conflict.id)).resolvedAt);
  const pngSha = (await database.syncAssets.toArray())[0].id;
  await database.syncAssets.delete(pngSha);
  await applyOperation(pool, backend, {
    id: randomUUID(),
    deviceId: randomUUID(),
    changes: [
      {
        table: 'wallpapers',
        id: 'daily',
        base: null,
        value: {
          id: 'daily',
          asset: 'duoyu-asset:' + pngSha,
          sourceUrl: 'local:' + pngSha,
          contentHash: pngSha,
        },
        revision: '0',
      },
    ],
  });
  __syncTest.failAssets = true;
  await client.syncNow();
  await new Promise((r) => setTimeout(r, 20));
  assert(client.syncState.value.lastSyncedAt);
  assert(await database.libraryItems.get('after-rejected'));
  assert(client.syncState.value.assetError);
  __syncTest.failAssets = false;
  await client.syncNow();
  for (
    let n = 0;
    n < 40 && !(await database.wallpapers.get('daily'))?.blob;
    n++
  )
    await new Promise((r) => setTimeout(r, 20));
  assert((await database.wallpapers.get('daily')).blob instanceof Blob);
  console.log(
    'PASS bad-operation quarantine, continuing uploads/downloads, timestamp, in-app conflict resolution, nonblocking image failure and retry',
  );

  const importer = await import('../work/sync-integration/importer.mjs');
  const countBefore = await database.libraryItems.count();
  const file = JSON.stringify({
    format: 'duoyu-backup',
    version: 1,
    tables: {
      libraryPages: [{ id: 'p', name: 'Imported', order: 0 }],
      libraryItems: [{ ...item, gridX: 0, gridY: 0 }],
      workspaceSpaces: [],
      tabCollections: [],
    },
    storage: {
      duoyuAuthSessionRenewal: { refresh: 'must-not-import' },
      glassMode: 'soft',
    },
  });
  const plan = await importer.planJsonImport(file);
  assert.notEqual(plan.tables.libraryItems[0].id, item.id);
  assert.equal(plan.tables.preferences.length, 0);
  assert(!JSON.stringify(plan).includes('must-not-import'));
  await importer.commitJsonImport(plan);
  await client.syncNow();
  assert.equal(await database.libraryItems.count(), countBefore + 1);
  await assert.rejects(importer.commitJsonImport(plan), /已经导入/);
  await assert.rejects(importer.planJsonImport('{bad json'), /有效JSON/);
  await assert.rejects(
    importer.planJsonImport(
      '{"format":"duoyu-backup","version":1,"tables":{},"__proto__":{}}',
    ),
    /不允许/,
  );
  await assert.rejects(
    importer.planJsonImport(
      JSON.stringify({
        format: 'duoyu-backup',
        version: 1,
        tables: { libraryItems: [{ ...item, url: 'javascript:bad' }] },
      }),
    ),
    /无效网址/,
  );
  assert.equal(await database.libraryItems.count(), countBefore + 1);
  const epochBefore = (
    await pool.query('SELECT epoch::text FROM sync_generation WHERE singleton')
  ).rows[0].epoch;
  await database.libraryItems.update('i', { name: 'offline before restore' });
  await pool.query('UPDATE sync_generation SET epoch=$1', [randomUUID()]);
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(), 0);
  assert(
    (await database.syncConflicts.toArray()).some(
      (c) => c.reason === 'epoch_changed',
    ),
  );
  assert.notEqual(
    (await database.libraryItems.get('i')).name,
    'offline before restore',
  );
  // Leave the test database generation changed; each new client discovers it.
  console.log(
    'PASS additive JSON import, duplicate-file protection, invalid-file rollback, credential exclusion, restored-dataset epoch detection with offline work retained for review',
  );

  // Independent IndexedDB and runtime reproduce two browser installations.
  const peer = fork('scripts/fixtures/cloud-peer.mjs', [], {
    env: {
      ...process.env,
      DUOYU_SYNC_TEST_CONTEXT: JSON.stringify(__syncTest),
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let peerErrors = '';
  peer.stderr.on('data', (chunk) => {
    peerErrors += chunk.toString();
  });
  function waitPeer(id) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        peer.off('message', listen);
        reject(Error('Peer timeout: ' + peerErrors));
      }, 15000);
      function listen(message) {
        if (message.id !== id) return;
        clearTimeout(timeout);
        peer.off('message', listen);
        message.error ? reject(Error(message.error)) : resolve(message);
      }
      peer.on('message', listen);
    });
  }
  async function peerAction(action, extra = {}) {
    const id = randomUUID(),
      result = waitPeer(id);
    peer.send({ id, action, ...extra });
    return result;
  }
  try {
    const ready = await waitPeer('ready');
    assert(!ready.state.error);
    await database.libraryItems.update('i', { name: 'Chrome new icon' });
    await client.syncNow();
    const refreshed = await peerAction('refresh');
    assert.equal(
      refreshed.items.find((i) => i.id === 'i').name,
      'Chrome new icon',
    );
    await peerAction('legacy');
    await peerAction('add', {
      item: {
        ...item,
        id: 'edge-pending',
        name: 'Edge pending icon',
        gridX: 1,
      },
    });
    const stalled = await peerAction('sync');
    assert.equal(stalled.pending, 1);
    assert.equal(stalled.state.needsReload, true);
    assert.match(stalled.state.error, /扩展后台尚未更新/);
    const recovered = await peerAction('refresh');
    assert.equal(recovered.pending, 0);
    assert(!recovered.state.error);
    assert(recovered.items.some((i) => i.id === 'edge-pending'));
    await client.syncNow();
    assert(await database.libraryItems.get('edge-pending'));
    console.log(
      'PASS two isolated clients: upload → refresh, legacy worker detection, pending item retained across reload, reverse synchronization',
    );
  } finally {
    if (peer.connected) await peerAction('stop').catch(() => {});
    peer.kill();
  }

  const peers = await Promise.all([
    startPeer(__syncTest),
    startPeer(__syncTest),
  ]);
  try {
    const actors = [
      {
        call: async (action, extra = {}) => {
          if (action === 'offline') __syncTest.offline = true;
          if (action === 'online') __syncTest.offline = false;
          if (action === 'add') await database.libraryItems.put(extra.item);
          if (action === 'sync') await client.syncNow();
          return { items: await database.libraryItems.toArray() };
        },
      },
      ...peers,
    ];
    const scenarios = [
      { count: 2, online: [0, 1] },
      { count: 2, online: [] },
      { count: 2, online: [0] },
      { count: 3, online: [0, 1] },
      { count: 3, online: [0] },
      { count: 3, online: [] },
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const working = actors.slice(0, scenario.count),
        expected = [];
      for (const [i, actor] of working.entries()) {
        await actor.call(scenario.online.includes(i) ? 'online' : 'offline');
        const id = 'scenario-' + index + '-' + i;
        expected.push(id);
        await actor.call('add', {
          item: { ...item, id, name: id, gridX: undefined, gridY: undefined },
        });
      }
      for (const actor of working) await actor.call('sync');
      for (const actor of working) await actor.call('online');
      for (let pass = 0; pass < 2; pass++)
        for (const actor of working) await actor.call('sync');
      for (const actor of working) {
        const view = await actor.call('read');
        for (const id of expected)
          assert(
            view.items.some((r) => r.id === id),
            'Missing ' + id,
          );
      }
    }
    console.log(
      'PASS all six requested two/three-client online/offline editing and reconnection scenarios',
    );
  } finally {
    for (const peer of peers) await peer.close();
  }

  console.log(
    'PASS full client ↔ PostgreSQL: cloud bootstrap, durable queue, offline recovery, field merge, cloud-priority conflict copy, lost-response idempotent retry',
  );
} finally {
  client.stopCloud();
  await database.delete();
  await new Promise((r) => server.close(r));
  for (const table of [
    'sync_assets',
    'sync_asset_deletions',
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

async function applyOperation(pool, account, operation) {
  const epoch = (
    await pool.query('SELECT epoch::text FROM sync_generation WHERE singleton')
  ).rows[0].epoch;
  return commitOperation(pool, account, { epoch, ...operation });
}

