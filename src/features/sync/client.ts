import { ref } from 'vue';
import Dexie from 'dexie';
import { browser } from 'wxt/browser';
import { database } from '../../shared/storage/database';
import {
  ACCOUNT_STORAGE_KEY,
  activeAccountKey,
  accountStorage,
} from '../../shared/storage/account';
import { AUTH_SESSION_KEY, type Account } from '../auth/config';
import { SYNC_TABLES, type CapturedOperation } from './capture';
import {
  denormalized,
  overlay,
  rowChanges,
  same,
  type Entity,
  type Row,
  type Change,
} from './model';
export const syncState = ref({
  status: '未登录',
  pending: 0,
  conflicts: 0,
  error: '',
});
export function stopCloud() {
  generation++;
  account = null;
  clearTimeout(timer);
}
let account: Account | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let retry = 0;
let firstWrite = 0;
let retryAfter = 0;
let generation = 0;
let running: Promise<unknown> | undefined;
const assetCache = new Map<string, Blob>();
const native = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function accountKey(a: Account) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(a.issuer + '\0' + a.sub),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
function switched() {
  return activeAccountKey() !== database.name.replace('duoyu-account-', '');
}
export async function rpc(
  path: string,
  method = 'GET',
  body?: unknown,
  binary = false,
  mediaType?: string,
): Promise<any> {
  const current = account,
    g = generation;
  if (!current) throw Error('请先登录');
  const r = await browser.runtime.sendMessage({
    type: 'duoyu-auth',
    action: 'sync',
    account: { issuer: current.issuer, sub: current.sub },
    path,
    method,
    body,
    binary,
    mediaType,
  });
  if (g !== generation || account?.sub !== current.sub || switched())
    throw Error('账号已切换');
  if (!r || r.status >= 400 || r.error) {
    retryAfter = Math.max(0, Math.min(300, Number(r?.retryAfter) || 0)) * 1000;
    const e = new Error(
      r?.data?.error || r?.error || '云同步暂不可用',
    ) as Error & { status: number };
    e.status = r?.status ?? 503;
    throw e;
  }
  return r.data;
}
async function bytesBase64(blob: Blob) {
  const a = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < a.length; i += 8192)
    s += String.fromCharCode(...a.subarray(i, i + 8192));
  return btoa(s);
}
async function upload(blob: Blob) {
  if (blob.size > 20 * 1024 * 1024)
    throw Error('云同步图片上限为20MB，请缩小图片后重试');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await blob.arrayBuffer(),
  );
  const sha = [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  await rpc(
    '/v1/assets/' + sha,
    'POST',
    await bytesBase64(blob),
    true,
    blob.type,
  );
  assetCache.set(sha, blob);
  return 'duoyu-asset:' + sha;
}
async function encode(v: any): Promise<any> {
  if (v instanceof Blob) return upload(v);
  if (typeof v === 'string' && v.startsWith('data:image/'))
    return upload(await (await fetch(v)).blob());
  if (typeof v === 'string' && v.startsWith('duoyu-icon:')) {
    let p;
    try {
      p = JSON.parse(v.slice(11));
    } catch {
      return v;
    }
    if (p.image?.startsWith('data:image/')) p.image = await encode(p.image);
    return 'duoyu-icon:' + JSON.stringify(p);
  }
  if (Array.isArray(v)) return Promise.all(v.map(encode));
  if (v && typeof v === 'object') {
    const result: Row = {};
    for (const [k, x] of Object.entries(v))
      if (x !== undefined) result[k] = await encode(x);
    return result;
  }
  return v;
}
async function download(sha: string) {
  let blob = assetCache.get(sha);
  if (!blob) {
    const r = await rpc('/v1/assets/' + sha, 'GET', undefined, true);
    blob = new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], {
      type: r.mediaType,
    });
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await blob.arrayBuffer(),
    );
    if (
      [...new Uint8Array(digest)]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('') !== sha
    )
      throw Error('云端图片校验失败');
    assetCache.set(sha, blob);
  }
  return blob;
}
async function decode(v: any, wallpaper = false): Promise<any> {
  if (typeof v === 'string' && v.startsWith('duoyu-asset:')) {
    const blob = await download(v.slice(12));
    return wallpaper
      ? blob
      : `data:${blob.type};base64,${await bytesBase64(blob)}`;
  }
  if (typeof v === 'string' && v.startsWith('duoyu-icon:')) {
    let p;
    try {
      p = JSON.parse(v.slice(11));
    } catch {
      return v;
    }
    if (p.image?.startsWith('duoyu-asset:')) p.image = await decode(p.image);
    return 'duoyu-icon:' + JSON.stringify(p);
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => decode(x)));
  if (v && typeof v === 'object' && !(v instanceof Blob)) {
    const result: Row = {};
    for (const [k, x] of Object.entries(v))
      result[k] = await decode(x, wallpaper && k === 'asset');
    return result;
  }
  return v;
}
async function remoteTransaction(fn: () => Promise<void>) {
  await database.transaction('rw', database.tables, async () => {
    (
      Dexie.currentTransaction!.idbtrans as IDBTransaction & {
        syncRemote: boolean;
      }
    ).syncRemote = true;
    await fn();
  });
}
async function applyRemote(
  updates: Entity[],
  revision: string,
  full = false,
  ack?: string,
  conflict?: string,
) {
  if (switched()) throw Error('账号已切换');
  // Fetch/decode attachments before opening a write transaction. Capture writes
  // arriving during fetch in the final transaction's pending overlay.
  const existing = full ? [] : await database.syncShadow.toArray();
  const next = new Map<string, Entity>(
    existing.map((r) => [
      r.id,
      {
        table: r.table,
        id: r.entityId,
        payload: r.payload as Row,
        deleted: r.deleted,
        revision: r.revision,
      },
    ]),
  );
  for (const e of updates) next.set(e.table + ':' + e.id, e);
  const decoded = new Map<string, Entity>();
  for (const [k, e] of next)
    decoded.set(k, {
      ...e,
      payload: await decode(e.payload, e.table === 'wallpapers'),
    });
  if (switched()) throw Error('账号已切换');
  await remoteTransaction(async () => {
    if (full) await database.syncShadow.clear();
    for (const e of updates)
      await database.syncShadow.put({
        id: e.table + ':' + e.id,
        table: e.table,
        entityId: e.id,
        payload: e.payload,
        deleted: e.deleted,
        revision: e.revision,
      });
    if (ack) {
      const op = await database.syncOutbox.get(ack);
      if (conflict && op)
        await database.syncConflicts.put({
          id: ack,
          operation: op,
          reason: conflict,
          createdAt: Date.now(),
        });
      await database.syncOutbox.delete(ack);
    }
    const pending = await database.syncOutbox.orderBy('createdAt').toArray();
    const view = new Map([...decoded].filter(([, e]) => !e.deleted));
    for (const op of pending) overlay(view, rowChanges(op.rows));
    const tables = denormalized([...view.values()]);
    for (const table of SYNC_TABLES) {
      if (table === 'wallpapers') {
        const custom = tables[table] ?? [];
        if (custom.length) await database.wallpapers.bulkPut(custom as any);
        continue;
      }
      await database.table(table).clear();
      if (tables[table]?.length)
        await database.table(table).bulkPut(tables[table]);
    }
    await database.syncMeta.put({ id: 'cursor', value: revision });
    await database.syncMeta.put({ id: 'initialized', value: true });
  });
  await projectPreferences();
  window.dispatchEvent(new Event('duoyu-wallpaper-change'));
}
async function prepare(op: CapturedOperation) {
  if (op.prepared) return op.prepared;
  const changes = (await encode(rowChanges(op.rows))) as Change[];
  for (const c of changes) {
    const shadow = await database.syncShadow.get(c.table + ':' + c.id);
    c.revision = shadow && same(shadow.payload, c.base) ? shadow.revision : '0';
  }
  let device = String((await database.syncMeta.get('device'))?.value ?? '');
  if (!device) {
    device = crypto.randomUUID();
    await database.syncMeta.put({ id: 'device', value: device });
  }
  const prepared = { id: op.id, deviceId: device, changes };
  await database.syncOutbox.update(op.id, { prepared });
  return prepared;
}
async function pull() {
  let cursor = String((await database.syncMeta.get('cursor'))?.value ?? '0');
  while (true) {
    let r;
    try {
      r = await rpc('/v1/sync/changes?after=' + cursor);
    } catch (e) {
      if ((e as Error & { status: number }).status !== 410) throw e;
      const snapshot = await rpc('/v1/sync/snapshot');
      await applyRemote(snapshot.entities, snapshot.revision, true);
      return;
    }
    const changes = r.operations.flatMap((o: any) => o.changes);
    await applyRemote(changes, r.revision);
    cursor = r.revision;
    if (cursor === r.head) break;
  }
}
export async function syncNow() {
  if (!account || switched()) return;
  if (running) return running;
  firstWrite = 0;
  running = navigator.locks.request(
    'duoyu:sync:' + activeAccountKey(),
    async () => {
      try {
        syncState.value.status = '正在同步';
        syncState.value.error = '';
        if (!(await database.syncMeta.get('initialized'))?.value) {
          const snapshot = await rpc('/v1/sync/snapshot');
          if (snapshot.schemaVersion !== 1) throw Error('云端同步版本不兼容');
          await applyRemote(snapshot.entities, snapshot.revision, true);
        }
        // Push before pull so local base revisions retain their meaning. Server does
        // three-way merge against its latest committed data under the account lock.
        for (const op of await database.syncOutbox
          .orderBy('createdAt')
          .toArray()) {
          const prepared = (await prepare(op)) as { changes: Change[] };
          if (!prepared.changes.length) {
            await database.syncOutbox.delete(op.id);
            continue;
          }
          const result = await rpc('/v1/sync/operations', 'POST', prepared);
          // A push response is not a pull cursor: another device's earlier operations
          // may precede it. Refresh a consistent snapshot after acknowledged writes.
          const snapshot = await rpc('/v1/sync/snapshot');
          await applyRemote(
            snapshot.entities,
            snapshot.revision,
            true,
            op.id,
            result.status === 'conflict' ? result.code : undefined,
          );
        }
        await pull();
        retry = 0;
        syncState.value.status = '已同步';
      } catch (e) {
        syncState.value.status = '待同步';
        syncState.value.error = e instanceof Error ? e.message : '同步失败';
        retry = Math.min(retry + 1, 7);
      } finally {
        syncState.value.pending = await database.syncOutbox.count();
        syncState.value.conflicts = await database.syncConflicts.count();
      }
    },
  );
  try {
    await running;
  } finally {
    running = undefined;
    schedule(
      retry
        ? Math.max(retryAfter, Math.min(120000, 1000 * 2 ** retry)) +
            Math.random() * 1000
        : syncState.value.pending
          ? 800
          : 30000,
    );
  }
}
function schedule(delay = 800) {
  if (!account) return;
  if (delay === 800) {
    firstWrite ||= Date.now();
    delay = Math.min(delay, Math.max(0, firstWrite + 5000 - Date.now()));
  }
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}
async function chooseAccount(next: Account | null) {
  const key = next ? await accountKey(next) : '';
  if (key !== activeAccountKey()) {
    generation++;
    account = null;
    localStorage.setItem(ACCOUNT_STORAGE_KEY, key);
    location.reload();
    return false;
  }
  account = next;
  return true;
}
export async function initializeCloud() {
  try {
    const response = await browser.runtime.sendMessage({
      type: 'duoyu-auth',
      action: 'status',
    });
    if (response?.view && !(await chooseAccount(response.view.account)))
      return false;
    if (account) {
      await syncNow();
      await projectPreferences();
    }
  } catch {
    syncState.value.status = '离线';
  }
  browser.storage.session.onChanged.addListener((changes) => {
    if (AUTH_SESSION_KEY in changes) {
      const next = (changes[AUTH_SESSION_KEY].newValue as any)?.account ?? null;
      void chooseAccount(next).then((ok) => {
        if (ok) schedule(0);
      });
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === ACCOUNT_STORAGE_KEY && switched()) {
      generation++;
      location.reload();
    }
  });
  window.addEventListener('duoyu-local-write', () => schedule());
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('focus', () => schedule(0));
  window.addEventListener('duoyu-preference-change', (e) => {
    const { key, value } = (e as CustomEvent).detail;
    const id =
      key === 'duoyu-dock-order'
        ? 'dockOrder'
        : key === 'duoyu-wallpaper-mode'
          ? 'wallpaperMode'
          : key.startsWith('duoyu-layout-')
            ? 'layout:' + key.slice(13)
            : undefined;
    if (account && id)
      void database.preferences.put({ id, value }).catch(() => {});
  });
  return true;
}
export async function setSyncPreference(id: string, value: unknown) {
  if (activeAccountKey()) {
    await database.preferences.put({ id, value });
  } else await browser.storage.local.set({ [id]: value });
}
export async function getSyncPreference(id: string) {
  if (activeAccountKey()) return (await database.preferences.get(id))?.value;
  return (await browser.storage.local.get(id))[id];
}
async function projectPreferences() {
  for (const p of await database.preferences.toArray()) {
    const key =
      p.id === 'dockOrder'
        ? 'duoyu-dock-order'
        : p.id === 'wallpaperMode'
          ? 'duoyu-wallpaper-mode'
          : p.id.startsWith('layout:')
            ? 'duoyu-layout-' + p.id.slice(7)
            : '';
    if (key) {
      if (p.value == null)
        localStorage.removeItem(`account:${activeAccountKey()}:${key}`);
      else
        localStorage.setItem(
          `account:${activeAccountKey()}:${key}`,
          typeof p.value === 'string' ? p.value : JSON.stringify(p.value),
        );
    }
    if (p.id === 'glassMode')
      document.documentElement.dataset.glassMode = String(p.value);
  }
  window.dispatchEvent(new Event('duoyu-sync-preferences'));
}
export async function importGuest() {
  if (!account) throw Error('请先登录');
  const guest = new Dexie('duoyu');
  await guest.open();
  try {
    const source: Record<string, Row[]> = {};
    for (const name of SYNC_TABLES.filter((n) => n !== 'preferences'))
      if (guest.tables.some((t) => t.name === name))
        source[name] = await guest.table(name).toArray();
    source.preferences = [];
    const saved = await browser.storage.local.get([
      'glassMode',
      'searchEngine',
    ]);
    for (const [id, value] of Object.entries(saved))
      source.preferences.push({ id, value });
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      const id =
        key === 'duoyu-dock-order'
          ? 'dockOrder'
          : key === 'duoyu-wallpaper-mode'
            ? 'wallpaperMode'
            : key.startsWith('duoyu-layout-')
              ? 'layout:' + key.slice(13)
              : '';
      if (id) source.preferences.push({ id, value: localStorage.getItem(key) });
    }
    const imported = Object.fromEntries(
      Object.entries(source).flatMap(([table, rows]) =>
        rows.map((value) => [
          table + ':' + value.id,
          { table, id: value.id, base: null, value },
        ]),
      ),
    );
    if (rowChanges(imported).length > 2000)
      throw Error('单次导入最多2000条，请先导出备份并分批整理');
    // Explicit one-time import into an empty account prevents collisions with
    // fixed IDs such as home folders, default page and default space.
    if (
      (await database.libraryItems.count()) ||
      (await database.libraryPages.count()) ||
      (await database.workspaceSpaces.count()) ||
      (await database.tabCollections.count())
    )
      throw Error('账号已有数据，不能覆盖导入；请先导出备份后单独整理');
    await database.transaction('rw', database.tables, async () => {
      for (const [name, rows] of Object.entries(source))
        if (rows.length) await database.table(name).bulkPut(rows);
    });
  } finally {
    guest.close();
  }
  await syncNow();
}
export async function exportConflicts() {
  const records = await database.syncConflicts.toArray();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'duoyu-sync-conflicts.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
