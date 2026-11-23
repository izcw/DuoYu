import 'fake-indexeddb/auto';
import Dexie from 'dexie';
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
let rateClock = Date.now();
const server = createSyncServer({
  clock:()=>rateClock+=1000,
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
  "'../memo/markup'": "'./markup.mjs'",
  "'../library/grid-config'": "'./grid-config.mjs'",
  "'../wallpaper/desktops'": "'./desktops.mjs'",
  "'../../shared/collection-colors'": "'./collection-colors.mjs'",
  "'./pending-wallpaper'": "'./pending-wallpaper.mjs'",
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
  'pending-wallpaper': 'src/features/sync/pending-wallpaper.ts',
  'collection-colors': 'src/shared/collection-colors.ts',
  desktops: 'src/features/wallpaper/desktops.ts',
  client: 'src/features/sync/client.ts',
  capture: 'src/features/sync/capture.ts',
  model: 'src/features/sync/model.ts',
  response: 'src/features/sync/response.ts',
  assets: 'src/features/sync/assets.ts',
  conflicts: 'src/features/sync/conflicts.ts',
  markup: 'src/features/memo/markup.ts',
  importer: 'src/features/sync/import-json.ts',
  'grid-config': 'src/features/library/grid-config.ts',
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
const legacy = new Dexie('duoyu-account-' + data.get('duoyu-sync-account'));
legacy.version(11).stores({
  memos: 'id,layer', memoPages: 'id,order', syncOutbox: 'id,createdAt', syncMeta: 'id',
  syncShadow: 'id', syncAssets: 'id', syncConflicts: 'id,createdAt', preferences: 'id',
  wallpapers: 'id', shortcuts: 'id', widgetLayouts: 'id', tabCollections: 'id,spaceId,order,updatedAt',
  workspaceSpaces: 'id,order', libraryPages: 'id,order', libraryItems: 'id,pageId,parent,order,updatedAt',
});
const memoPage = { id: 'ideas', name: '灵感', icon: 'Notes', order: 0 };
const legacyMemo = {
  id: 'legacy-note', title: '旧标题', body: 'data:image/png;这是便签正文', color: 'sage',
  x: -21, y: 220, width: 260, height: 212, layer: 2, archiveOrder: 0,
  createdAt: 1, updatedAt: 2, archivedAt: null,
};
await legacy.memoPages.add(memoPage);
await legacy.memos.bulkAdd([legacyMemo, { ...legacyMemo, id: 'group-note', pageId: memoPage.id, archivedAt: 3 }]);
legacy.close();
const { database } = await import('../work/sync-integration/database.mjs');
const client = await import('../work/sync-integration/client.mjs');
try {
  await client.initializeCloud();
  assert.equal(client.syncState.value.status, '已同步');
  const memoPeer = await startPeer(__syncTest);
  try {
    const first = await memoPeer.call('readMemos');
    assert.deepEqual(first.pages, [memoPage]);
    assert.deepEqual(first.memos.find(n => n.id === legacyMemo.id), { ...legacyMemo, pageId: 'wall' });
    assert.equal(first.memos.find(n => n.id === 'group-note').archivedAt, 3);
    __syncTest.offline = true;
    const literal = 'duoyu-asset:' + 'f'.repeat(64);
    for (let i = 1; i <= 12; i++)
      await database.memos.update(legacyMemo.id, { body: literal + i, html: '<b>' + literal + i + '</b>', updatedAt: 2 + i });
    assert.equal(await database.syncOutbox.count(), 12);
    await client.syncNow();
    assert.equal(await database.syncOutbox.count(), 1);
    const before = (await database.syncMeta.get('cursor')).value;
    __syncTest.offline = false;
    await client.syncNow();
    assert.equal(BigInt((await database.syncMeta.get('cursor')).value), BigInt(before) + 1n);
    await memoPeer.call('sync');
    const changed = (await memoPeer.call('readMemos')).memos.find(n => n.id === legacyMemo.id);
    assert.equal(changed.body, literal + 12);
    assert.equal(changed.html, '<b>' + literal + '12</b>');
    const markdown = '# 设计评审\n\n- **本周**\n- `原样保存`';
    await database.memos.update(legacyMemo.id, { title: '', body: markdown, html: undefined });
    await client.syncNow();
    await memoPeer.call('sync');
    const converted = (await memoPeer.call('readMemos')).memos.find(n => n.id === legacyMemo.id);
    assert.equal(converted.body, markdown);
    assert.equal(converted.html, undefined);
    const reply = markdown + '\n\n> 第二台设备补充';
    await memoPeer.call('editMemo', { memoId: legacyMemo.id, changes: { body: reply } });
    await memoPeer.call('sync');
    await client.syncNow();
    assert.equal((await database.memos.get(legacyMemo.id)).body, reply);
    await memoPeer.call('editMemo', { memoId: 'group-note', changes: { archivedAt: null, color: 'lilac', x: 91, width: 312 } });
    await memoPeer.call('sync');
    await client.syncNow();
    const restored = await database.memos.get('group-note');
    assert.deepEqual([restored.archivedAt, restored.color, restored.pageId, restored.x, restored.width], [null, 'lilac', 'ideas', 91, 312]);
    await database.memos.update('group-note', { html: '<b>格式版本</b>', body: '格式版本' });
    await client.syncNow();
    await memoPeer.call('sync');
    await database.memos.update('group-note', { html: '<u>格式版本</u>' });
    await memoPeer.call('editMemo', { memoId: 'group-note', changes: { html: '<b>另一版本</b>', body: '另一版本' } });
    await memoPeer.call('sync');
    await client.syncNow();
    const conflict = (await database.syncConflicts.toArray()).find(c => !c.resolvedAt);
    assert.equal(conflict?.reason, 'field_conflict');
    assert.equal((await database.memos.get('group-note')).body, '另一版本');
    const { retryConflict } = await import('../work/sync-integration/conflicts.mjs');
    await retryConflict(conflict.id);
    await memoPeer.call('sync');
    const resolved = (await memoPeer.call('readMemos')).memos.find(n => n.id === 'group-note');
    assert.deepEqual([resolved.body, resolved.html], ['格式版本', '<u>格式版本</u>']);
    data.set('duoyu-sync-account', 'different-account');
    await assert.rejects(database.memos.update(legacyMemo.id, { body: 'wrong owner' }), /账号|abort/i);
    data.set('duoyu-sync-account', await client.accountKey(account));
    await database.memos.delete(legacyMemo.id);
    await client.syncNow();
    await memoPeer.call('sync');
    assert.deepEqual((await memoPeer.call('readMemos')).memos.map(n => n.id), ['group-note']);
    assert.equal((await database.syncConflicts.toArray()).filter(c => !c.resolvedAt).length, 0);
    console.log('PASS memo v11 upgrade, pages, two-way Markdown sync, account guard, offline typing (12 edits → one revision), legacy rich text, archive restore and deletion');
  } finally {
    await memoPeer.close();
  }
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
  assert.equal((await database.syncShadow.get('libraryItems:i')).payload.name, 'cloud-wins');
  assert.equal((await database.syncConflicts.toArray()).filter(c => !c.resolvedAt).length, 1);
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
  assert.equal(await database.libraryItems.get(rejectedId), undefined);
  assert((await database.syncConflicts.toArray()).some(c =>
    c.operation.rows?.['libraryItems:' + rejectedId]?.value?.url === 'javascript:bad'));
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
  const blocked = (await database.syncConflicts.toArray()).find(c => c.state === 'blocked' && !c.resolvedAt);
  assert(blocked);
  await resolution.discardConflict(blocked.id);
  assert((await database.syncConflicts.get(blocked.id)).resolvedAt);
  assert.equal(await database.libraryItems.get(rejectedId), undefined, 'cloud choice must immediately remove a local-only rejected item without new cloud revisions');
  assert.equal(await database.syncOutbox.count(), 0, 'applying cloud must not generate an upload');
  console.log('PASS cloud choice immediately rematerializes local data without uploading rejected changes');
  const resolvedRecord = await database.syncConflicts.get(blocked.id);
  await database.syncMeta.put({id:'conflictEpoch',value:'old-generation'});
  await resolution.fetchRemoteConflicts(async()=>({conflicts:[{operation_id:blocked.id,created_at:new Date().toISOString(),resolved_at:null,detail:{code:'field_conflict',changes:[]}}]}));
  assert.equal((await database.syncConflicts.get(blocked.id)).resolvedAt,resolvedRecord.resolvedAt,'stale server list must not resurrect an acknowledged conflict after epoch metadata changes');
  let idleWrites = 0;
  const countWrite = () => { idleWrites++; };
  database.syncConflicts.hook('updating', countWrite);
  database.syncMeta.hook('updating', countWrite);
  try {
    await resolution.fetchRemoteConflicts(async () => ({ conflicts: [{
      operation_id: blocked.id, created_at: new Date(resolvedRecord.createdAt).toISOString(),
      resolved_at: null, detail: { code: 'field_conflict', changes: [] },
    }] }));
    assert.equal(idleWrites, 0, 'unchanged conflict polling must leave IndexedDB observers idle');
  } finally {
    database.syncConflicts.hook('updating').unsubscribe(countWrite);
    database.syncMeta.hook('updating').unsubscribe(countWrite);
  }
  const accountStorageKey = data.get('duoyu-sync-account');
  data.set('duoyu-sync-account','different-account');
  let calledWrongAccount = false;
  await assert.rejects(resolution.fetchRemoteConflicts(async()=>{calledWrongAccount=true;return {conflicts:[]};}),/账号/);
  assert.equal(calledWrongAccount,false);
  await assert.rejects(resolution.retryConflict(blocked.id), /账号/);
  data.set('duoyu-sync-account',accountStorageKey);
  console.log('PASS resolved conflict persistence and switched-account isolation');
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
  // A pre-upgrade local intent or thumbnail must never originate a cloud edit.
  const owner = localStorage.getItem('duoyu-sync-account');
  localStorage.setItem('account:'+owner+':duoyu-wallpaper-intent',JSON.stringify({selection:'daily'}));
  await client.refreshSnapshot();
  await client.syncNow();
  assert.equal(await database.syncOutbox.count(),0);
  assert.equal((await database.syncShadow.get('wallpapers:daily')).payload.asset,'duoyu-asset:'+pngSha);
  assert.notEqual((await database.preferences.get('wallpaperSelection'))?.value,'daily');
  console.log('PASS stale local wallpaper intent cannot rewrite the cloud snapshot');

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
      memoPages: [memoPage],
      memos: [{ ...legacyMemo, pageId: memoPage.id }],
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
  assert.equal(plan.tables.memos[0].pageId, plan.tables.memoPages[0].id);
  assert.notEqual(plan.tables.memoPages[0].id, memoPage.id);
  await assert.rejects(importer.planJsonImport(JSON.stringify({
    format: 'duoyu-backup', version: 1,
    tables: { memos: Array.from({ length: 2001 }, (_, i) => ({...legacyMemo, id: String(i)})) },
  })), /2000/);
  assert.notEqual(plan.tables.libraryItems[0].id, item.id);
  assert.equal(plan.tables.preferences.length, 0);
  assert(!JSON.stringify(plan).includes('must-not-import'));
  await importer.commitJsonImport(plan);
  await client.syncNow();
  assert.equal((await database.syncShadow.get('memos:' + plan.tables.memos[0].id)).payload.body, legacyMemo.body);
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
          return { items: await database.libraryItems.toArray(), state:client.syncState.value, pending:await database.syncOutbox.count() };
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
            'Missing ' + id + ' state=' + JSON.stringify(view.state) + ' pending=' + view.pending,
          );
      }
    }
    console.log(
      'PASS all six requested two/three-client online/offline editing and reconnection scenarios',
    );
  } finally {
    for (const peer of peers) await peer.close();
  }

  const latestBackup = async () => (await client.rpc('/api/v1/sync/backups')).backups[0];
  const probe = { ...item, id: randomUUID(), gridX: undefined, gridY: undefined, updatedAt: 1 };
  await database.libraryItems.put(probe);
  await client.syncNow();
  async function peerEdit(fields) {
    const row = await database.syncShadow.get('libraryItems:' + probe.id);
    return applyOperation(pool, backend, {
      id: randomUUID(), deviceId: randomUUID(),
      changes: [{ table: 'libraryItems', id: probe.id, base: row.payload,
        value: { ...row.payload, ...fields }, revision: row.revision }],
    });
  }
  const beforeConflicts = () => database.syncConflicts.filter(c => !c.resolvedAt).count();
  const baseline = await beforeConflicts();
  await database.libraryItems.update(probe.id, { name: '共同结果', updatedAt: 2 });
  await peerEdit({ name: '共同结果', updatedAt: 3 });
  await client.syncNow();
  assert.equal((await database.libraryItems.get(probe.id)).updatedAt, 3);
  assert.equal(await beforeConflicts(), baseline);
  await database.libraryItems.update(probe.id, { name: '本地候选' });
  await peerEdit({ name: '云端版本' });
  await client.syncNow();
  assert.equal((await database.libraryItems.get(probe.id)).name, '云端版本');
  assert.equal(await beforeConflicts(), baseline + 1);
  await peerEdit({ name: '本地候选' });
  await client.syncNow();
  assert.equal(await beforeConflicts(), baseline, 'a converged historical conflict must close on both devices');
  await database.libraryItems.delete(probe.id);
  await peerEdit({ updatedAt: 4 });
  await client.syncNow();
  assert.equal(await database.libraryItems.get(probe.id), undefined);
  assert.equal(await beforeConflicts(), baseline, 'timestamp-only drift must not block deletion');
  await client.syncNow();
  const previous = await latestBackup();
  await client.backupCloudNow();
  const firstManual = await latestBackup();
  await client.backupCloudNow();
  const secondManual = await latestBackup();
  assert.notEqual(firstManual.id, previous?.id);
  assert.notEqual(secondManual.id, firstManual.id);
  assert.equal(BigInt(secondManual.revision), BigInt(firstManual.revision) + 1n);
  assert.equal(secondManual.entity_count, firstManual.entity_count);
  const spaceId = randomUUID(), collectionId = randomUUID(), linkId = randomUUID();
  const legacyIcon = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E';
  const legacyLink = { id: linkId, collectionId, title: 'original', url: 'https://example.test/legacy',
    icon: legacyIcon, savedAt: 1, position: 0 };
  const seedWorkspace = await applyOperation(pool, backend, { id: randomUUID(), deviceId: randomUUID(),
    changes: [
      ['workspaceSpaces', spaceId, { id: spaceId, name: 'legacy space', order: 0 }],
      ['tabCollections', collectionId, { id: collectionId, spaceId, name: 'legacy collection', order: 0, updatedAt: 1 }],
      ['savedTabs', linkId, legacyLink],
    ].map(([table, id, value]) => ({ table, id, base: null, value, revision: '0' })),
  });
  assert.equal(seedWorkspace.status, 'applied');
  await client.syncNow();
  const legacyBaseline = await beforeConflicts();
  __syncTest.offline = true;
  async function editLegacyTab(edit) {
    const group = await database.tabCollections.get(collectionId);
    Object.assign(group.tabs[0], edit);
    await database.tabCollections.put(group);
  }
  await editLegacyTab({ title: 'draft' });
  await editLegacyTab({ title: 'final' });
  await client.syncNow();
  const remoteEdit = await applyOperation(pool, backend, { id: randomUUID(), deviceId: randomUUID(),
    changes: [{ table: 'savedTabs', id: linkId, base: legacyLink, value: { ...legacyLink, starred: true }, revision: seedWorkspace.revision }],
  });
  assert.equal(remoteEdit.status, 'applied');
  __syncTest.offline = false;
  await client.syncNow();
  const mergedLink = (await database.tabCollections.get(collectionId)).tabs[0];
  assert.equal(mergedLink.title, 'final');
  assert.equal(mergedLink.starred, true);
  assert.equal(mergedLink.icon, legacyIcon);
  assert.equal(await beforeConflicts(), legacyBaseline);
  const cloudLink = await database.syncShadow.get('savedTabs:' + linkId);
  await editLegacyTab({ title: 'local choice' });
  await applyOperation(pool, backend, { id: randomUUID(), deviceId: randomUUID(),
    changes: [{ table: 'savedTabs', id: linkId, base: cloudLink.payload,
      value: { ...cloudLink.payload, title: 'remote choice' }, revision: cloudLink.revision }],
  });
  await client.syncNow();
  assert.equal((await database.tabCollections.get(collectionId)).tabs[0].title, 'remote choice');
  const legacyConflict = (await database.syncConflicts.toArray()).find(c =>
    !c.resolvedAt && resolution.conflictChanges(c).some(change => change.id === linkId));
  assert.ok(legacyConflict);
  await resolution.retryConflict(legacyConflict.id);
  assert.equal((await database.tabCollections.get(collectionId)).tabs[0].title, 'local choice');
  assert.equal(await beforeConflicts(), legacyBaseline);
  await database.tabCollections.delete(collectionId);
  await client.syncNow();
  assert.equal(await database.tabCollections.get(collectionId), undefined);
  assert.equal(await beforeConflicts(), legacyBaseline);
  console.log('PASS legacy favicon: offline edits merge with a remote mark, explicit local choice and deletion synchronize');
  console.log('PASS full client ↔ PostgreSQL: cloud-first projection, durable offline writes, retry and distinct manual backups without edits');
} finally {
  client.stopCloud();
  await database.delete();
  await new Promise((r) => server.close(r));
  for (const table of [
    'sync_user_backups',
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

