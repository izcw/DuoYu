import { ref } from 'vue';
import Dexie from 'dexie';
import { browser } from 'wxt/browser';
import { database } from '../../shared/storage/database';
import {
  ACCOUNT_STORAGE_KEY,
  activeAccountKey,
} from '../../shared/storage/account';
import { AUTH_SESSION_KEY, type Account } from '../auth/config';
import { syncResponse, syncTransportError } from './response';
import { SYNC_TABLES, type CapturedOperation } from './capture';
import {
  pruneAssetCache,
  collectAssets,
  uploadAsset,
  connectAssetTransport,
  encodeAssets,
  getAsset,
  ASSET_PREFIX,
} from './assets';
import { fetchRemoteConflicts } from './conflicts';
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
  needsReload: false,
  lastSyncedAt: 0,
  assetError: '',
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
  const r = await browser.runtime
    .sendMessage({
      type: 'duoyu-auth',
      action: 'sync',
      account: { issuer: current.issuer, sub: current.sub },
      path,
      method,
      body,
      binary,
      mediaType,
    })
    .catch((error: unknown) => {
      throw syncTransportError(error);
    });
  if (g !== generation || account?.sub !== current.sub || switched())
    throw Error('账号已切换');
  retryAfter = Math.max(0, Math.min(300, Number(r?.retryAfter) || 0)) * 1000;
  return syncResponse(r);
}
export async function remoteTransaction(fn: () => Promise<void>) {
  await database.transaction('rw', database.tables, async () => {
    (
      Dexie.currentTransaction!.idbtrans as IDBTransaction & {
        syncRemote: boolean;
      }
    ).syncRemote = true;
    await fn();
  });
}
async function waitForInteraction() {
  while (
    document.querySelector?.(
      '.ui-draggable-dragging,.ui-resizable-resizing,.grid-selection-dragging,.desktop-transfer-preview',
    )
  )
    await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 0));
}
export async function applyRemote(
  updates: Entity[],
  revision: string,
  full = false,
  ack?: string,
  conflict?: string,
  epoch?: string,
) {
  if (switched()) throw Error('账号已切换');
  await waitForInteraction();
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
  const cached = new Map(
    (await database.syncAssets.toArray()).map((a) => [
      ASSET_PREFIX + a.id,
      a.blob,
    ]),
  );
  await remoteTransaction(async () => {
    const previousEpoch = (await database.syncMeta.get('epoch'))?.value;
    if (previousEpoch && epoch && previousEpoch !== epoch) {
      for (const op of await database.syncOutbox.toArray()) {
        await database.syncConflicts.put({
          id: op.id,
          operation: op,
          reason: 'epoch_changed',
          state: 'blocked',
          createdAt: Date.now(),
        });
        if (op.resolutionOf)
          await database.syncConflicts.update(op.resolutionOf, {
            resolvedAt: Date.now(),
          });
      }
      await database.syncOutbox.clear();
    }
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
          state: 'conflict',
          server: true,
          createdAt: Date.now(),
        });
      if (op?.resolutionOf)
        await database.syncConflicts.update(op.resolutionOf, {
          resolvedAt: Date.now(),
        });
      await database.syncOutbox.delete(ack);
    }
    const view = new Map([...next].filter(([, e]) => !e.deleted));
    for (const op of await database.syncOutbox.orderBy('createdAt').toArray())
      overlay(view, rowChanges(op.rows));
    const tables = denormalized([...view.values()]);
    for (const table of SYNC_TABLES) {
      let rows = tables[table] ?? [];
      if (table === 'wallpapers') {
        const expected = new Set(rows.map((row) => row.id));
        for (const local of await database.wallpapers.toArray())
          if (local.sourceUrl.startsWith('local:') && !expected.has(local.id))
            await database.wallpapers.delete(local.id);
        rows = rows.flatMap((row) => {
          const blob =
            row.blob instanceof Blob ? row.blob : cached.get(row.blob);
          return blob ? [{ ...row, blob }] : [];
        });
        if (rows.length) await database.wallpapers.bulkPut(rows as any);
        continue;
      }
      const local = await database.table(table).toArray(),
        incoming = new Map(rows.map((r) => [r.id, r]));
      const removed = local.filter((r) => !incoming.has(r.id)).map((r) => r.id);
      if (removed.length) await database.table(table).bulkDelete(removed);
      const old = new Map(local.map((r) => [r.id, r]));
      const changed = rows.filter((r) => !same(old.get(r.id), r));
      if (changed.length) await database.table(table).bulkPut(changed);
    }
    await database.syncMeta.put({ id: 'cursor', value: revision });
    await database.syncMeta.put({ id: 'initialized', value: true });
    if (epoch) await database.syncMeta.put({ id: 'epoch', value: epoch });
  });
  await projectPreferences();
  void hydrateWallpaper();
  window.dispatchEvent(new Event('duoyu-assets-retry'));
}
async function hydrateWallpaper() {
  try {
    const shadow = await database.syncShadow.get('wallpapers:daily');
    const ref = (shadow?.payload as Row)?.asset;
    if (
      shadow?.deleted ||
      typeof ref !== 'string' ||
      !ref.startsWith(ASSET_PREFIX)
    )
      return;
    const blob = await getAsset(ref);
    if (switched()) return;
    await remoteTransaction(async () => {
      const current = await database.syncShadow.get('wallpapers:daily');
      const pending = (await database.syncOutbox.toArray()).some(
        (op) => 'wallpapers:daily' in op.rows,
      );
      if (
        pending ||
        (current?.payload as Row)?.asset !== ref ||
        current?.deleted
      )
        return;
      const p = current!.payload as Row;
      const existing = await database.wallpapers.get('daily');
      if (existing?.contentHash !== p.contentHash)
        await database.wallpapers.put({
          id: 'daily',
          sourceUrl: p.sourceUrl,
          contentHash: p.contentHash,
          blob,
          savedAt: Date.now(),
        });
    });
    syncState.value.assetError = '';
    window.dispatchEvent(new Event('duoyu-wallpaper-change'));
  } catch {
    syncState.value.assetError = '壁纸下载暂未完成，联网后会自动重试';
  }
}
export async function refreshSnapshot(ack?: string, reason?: string) {
  const r = await rpc('/v1/sync/snapshot');
  if (r.schemaVersion !== 1) throw Error('云端同步版本不兼容');
  await applyRemote(r.entities, r.revision, true, ack, reason, r.epoch);
}
async function prepare(op: CapturedOperation) {
  if (op.prepared) {
    // An unfinished upload can outlive the server's staging lease while offline.
    // Renew only images explicitly changed by this request, never historical bases.
    const prepared = op.prepared as { changes: Change[] };
    if (!Array.isArray(prepared?.changes)) return op.prepared;
    const epoch = String((await database.syncMeta.get('epoch'))?.value ?? '');
    const changed = prepared.changes
      .filter((c) => c && typeof c === 'object')
      .flatMap((c) =>
        c.value
          ? Object.entries(c.value)
              .filter(([key, value]) => !same(c.base?.[key], value))
              .map(([, value]) => value)
          : [],
      );
    for (const ref of collectAssets(changed)) await uploadAsset(ref, epoch);
    return op.prepared;
  }
  const epoch = String((await database.syncMeta.get('epoch'))?.value ?? '');
  const changes = (await encodeAssets(rowChanges(op.rows), epoch)) as Change[];
  for (const c of changes) {
    const shadow = await database.syncShadow.get(c.table + ':' + c.id);
    c.revision = shadow && same(shadow.payload, c.base) ? shadow.revision : '0';
  }
  let device = String((await database.syncMeta.get('device'))?.value ?? '');
  if (!device) {
    device = crypto.randomUUID();
    await database.syncMeta.put({ id: 'device', value: device });
  }
  const prepared = {
    id: op.id,
    deviceId: device,
    changes,
    epoch: epoch || undefined,
    ...(op.resolutionOf ? { resolutionOf: op.resolutionOf } : {}),
  };
  await database.syncOutbox.update(op.id, { prepared });
  return prepared;
}
async function pull() {
  let cursor = String((await database.syncMeta.get('cursor'))?.value ?? '0');
  while (true) {
    let r;
    try {
      const epoch = String((await database.syncMeta.get('epoch'))?.value ?? '');
      r = await rpc(
        '/v1/sync/changes?after=' + cursor + (epoch ? '&epoch=' + epoch : ''),
      );
    } catch (e) {
      if ((e as Error & { status: number }).status !== 410) throw e;
      await refreshSnapshot();
      return;
    }
    const changes = r.operations.flatMap((o: any) => o.changes);
    await applyRemote(
      changes,
      r.revision,
      false,
      undefined,
      undefined,
      r.epoch,
    );
    cursor = r.revision;
    if (cursor === r.head) break;
  }
}
async function quarantine(op: CapturedOperation, reason: string) {
  await remoteTransaction(async () => {
    await database.syncConflicts.put({
      id: op.id,
      operation: op,
      reason,
      state: 'blocked',
      createdAt: Date.now(),
    });
    await database.syncOutbox.delete(op.id);
    if (op.resolutionOf)
      await database.syncConflicts.update(op.resolutionOf, {
        resolvedAt: Date.now(),
      });
  });
}
export async function syncNow() {
  if (!account || switched()) return;
  if (running) return running;
  firstWrite = 0;
  running = navigator.locks.request(
    'duoyu:sync:' + activeAccountKey(),
    async () => {
      let uploadError: unknown, downloadError: unknown;
      syncState.value.status = '正在同步';
      syncState.value.error = '';
      syncState.value.needsReload = false;
      try {
        if (!(await database.syncMeta.get('initialized'))?.value)
          await refreshSnapshot();
        // Check the dataset generation before replaying any offline operations.
        await pull();
        for (const original of await database.syncOutbox
          .orderBy('createdAt')
          .toArray()) {
          const op = await database.syncOutbox.get(original.id);
          if (!op) continue;
          try {
            const prepared = (await prepare(op)) as { changes: Change[] };
            if (!prepared.changes.length) {
              await database.syncOutbox.delete(op.id);
              continue;
            }
            const result = await rpc('/v1/sync/operations', 'POST', prepared);
            await refreshSnapshot(
              op.id,
              result.status === 'conflict' ? result.code : undefined,
            );
          } catch (error) {
            const status = (error as { status?: number }).status,
              code = error instanceof Error ? error.message : '';
            if (code === 'epoch_mismatch') {
              await refreshSnapshot();
              break;
            }
            if (status && [400, 409, 413, 415, 422].includes(status)) {
              await quarantine(op, code);
              await refreshSnapshot();
              continue;
            }
            uploadError = error;
            break;
          }
        }
      } catch (error) {
        uploadError = error;
      }
      // Upload failures must never prevent downloading other devices' changes.
      try {
        await pull();
        await fetchRemoteConflicts(rpc);
      } catch (error) {
        downloadError = error;
      }
      await remoteTransaction(async () => {
        if (!downloadError) {
          const now = Date.now();
          await database.syncMeta.put({ id: 'lastSyncedAt', value: now });
          syncState.value.lastSyncedAt = now;
        }
      });
      await pruneAssetCache().catch(() => {});
      syncState.value.pending = await database.syncOutbox.count();
      syncState.value.conflicts = (
        await database.syncConflicts.toArray()
      ).filter((c) => !c.resolvedAt).length;
      const error = downloadError || uploadError;
      if (error) {
        syncState.value.error =
          error instanceof Error ? error.message : '同步失败';
        syncState.value.needsReload =
          (error as { status?: number }).status === 426;
        retry = Math.min(retry + 1, 7);
      } else retry = 0;
      syncState.value.status = syncState.value.pending
        ? '待同步'
        : syncState.value.conflicts
          ? '有更改待处理'
          : error
            ? '连接异常'
            : '已同步';
      void hydrateWallpaper();
      window.dispatchEvent(new Event('duoyu-assets-retry'));
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
  if (!account || syncState.value.needsReload) return;
  if (delay === 800) {
    firstWrite ||= Date.now();
    delay = Math.min(delay, Math.max(0, firstWrite + 5000 - Date.now()));
  }
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}
export function reloadSyncExtension() {
  browser.runtime.reload();
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
  connectAssetTransport(rpc);
  syncState.value.lastSyncedAt = Number(
    (await database.syncMeta.get('lastSyncedAt'))?.value || 0,
  );
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
  const oldWallpaperMode = localStorage.getItem(
    `account:${activeAccountKey()}:duoyu-wallpaper-mode`,
  );
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
  if (
    oldWallpaperMode !==
    localStorage.getItem(`account:${activeAccountKey()}:duoyu-wallpaper-mode`)
  ) {
    localStorage.removeItem(
      `account:${activeAccountKey()}:duoyu:wallpaper-preview`,
    );
    window.dispatchEvent(new Event('duoyu-wallpaper-change'));
  }
}
export function formatSyncTime(time: number) {
  if (!time) return '';
  const date = new Date(time),
    pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
