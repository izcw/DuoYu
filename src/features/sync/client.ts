import {
  restoreWallpaperChoice,
  settleWallpaperChoice,
} from '../wallpaper/wallpaper-intent';
import { ref } from 'vue';
import Dexie from 'dexie';
import { browser } from 'wxt/browser';
import { database } from '../../shared/storage/database';
import {
  ACCOUNT_STORAGE_KEY,
  activeAccountKey,
  assertCurrentPageAccount,
  pageAccountKey,
  scopedKey,
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
import { fetchRemoteConflicts, conflictChanges } from './conflicts';
import { pendingWallpaperChanges } from './pending-wallpaper';
import {
  normalized,
  preserveLocalConflict,
  denormalized,
  pendingCollectionCreates,
  pendingDesktopChanges,
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
  accountSelection++;
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
let accountSelection = 0;
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
  return activeAccountKey() !== pageAccountKey;
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
  assertCurrentPageAccount();
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
  if (!pageAccountKey || switched()) throw Error('账号已切换');
  await waitForInteraction();
  assertCurrentPageAccount();
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
    const wallpaper = await database.wallpapers.get('daily');
    const conflicts = (
      await database.syncConflicts.orderBy('createdAt').toArray()
    ).flatMap((record) => {
      const op = record.operation as Partial<CapturedOperation> | null;
      return !record.resolvedAt &&
        record.reason !== 'epoch_changed' &&
        record.reason !== 'epoch_required' &&
        op?.rows
        ? [{ ...record, rows: op.rows }]
        : [];
    });
    const unresolved = conflicts.map((record) => ({
      changes: conflictChanges(record),
    }));
    // Recover creations hidden by older clients; newer operations take precedence.
    overlay(view, pendingCollectionCreates(next, unresolved));
    overlay(
      view,
      pendingDesktopChanges(unresolved).filter(
        (c) => !next.has(c.table + ':' + c.id),
      ),
    );
    const local = new Map<string, Row>();
    const visited = new Set<string>();
    for (const record of conflicts) {
      for (const row of Object.values(record.rows)) {
        const key = row.table + ':' + row.id;
        if (visited.has(key) || row.table === 'wallpapers') continue;
        visited.add(key);
        const current = await database.table(row.table).get(row.id);
        for (const entity of normalized(row.table, current ?? null))
          local.set(entity.table + ':' + entity.id, entity.payload);
      }
    }
    for (const record of conflicts)
      preserveLocalConflict(view, rowChanges(record.rows), local);
    overlay(view, pendingWallpaperChanges(wallpaper?.contentHash, unresolved));
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
  await settleWallpaperChoice();
  await restoreWallpaperChoice();
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
      const selected = (await database.preferences.get('wallpaperSelection'))
        ?.value;
      if (
        typeof selected === 'string' &&
        (selected === 'daily' || p.selection !== selected)
      )
        return;
      const saved = (
        await database.preferences.get(
          selected === 'upload'
            ? 'savedWallpaper:upload'
            : 'savedWallpaper:store',
        )
      )?.value as Row | undefined;
      if (
        saved &&
        saved.selection === selected &&
        saved.contentHash &&
        p.contentHash !== saved.contentHash
      )
        return;
      const existing = await database.wallpapers.get('daily');
      const unresolved = (
        await database.syncConflicts.orderBy('createdAt').toArray()
      ).map((record) => ({
        resolvedAt: record.resolvedAt,
        changes: conflictChanges(record),
      }));
      if (pendingWallpaperChanges(existing?.contentHash, unresolved).length)
        return;
      if (existing?.contentHash !== p.contentHash)
        await database.wallpapers.put({
          id: 'daily',
          sourceUrl: p.sourceUrl,
          selection: p.selection,
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
  const r = await rpc('/api/v1/sync/snapshot');
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
        '/api/v1/sync/changes?after=' +
          cursor +
          (epoch ? '&epoch=' + epoch : ''),
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
export async function refreshConflictPreview() {
  await navigator.locks.request(
    'duoyu:sync:' + activeAccountKey(),
    async () => {
      if (!account || switched()) throw Error('请先登录当前同步账号');
      if (!(await database.syncMeta.get('initialized'))?.value)
        await refreshSnapshot();
      else await pull();
      await fetchRemoteConflicts(rpc);
      // Old clients could leave a resolving flag after its queued operation disappeared.
      await remoteTransaction(async () => {
        const pending = new Set(
          (await database.syncOutbox.toArray()).map((op) => op.resolutionOf),
        );
        for (const record of await database.syncConflicts.toArray())
          if (
            !record.resolvedAt &&
            record.state === 'resolving' &&
            !pending.has(record.id)
          )
            await database.syncConflicts.update(record.id, {
              state: 'conflict',
            });
      });
    },
  );
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
        await fetchRemoteConflicts(rpc);
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
            const result = await rpc(
              '/api/v1/sync/operations',
              'POST',
              prepared,
            );
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
        if (!downloadError && !uploadError) {
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
        : syncState.value.pending || firstWrite
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
  const selection = ++accountSelection;
  const key = next ? await accountKey(next) : '';
  if (selection !== accountSelection) return false;
  if (key !== activeAccountKey() || key !== pageAccountKey) {
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
  // Account changes must be observed even while startup authentication or the
  // first sync is waiting on the network. Otherwise logout can leave the old
  // account database visible until a manual reload.
  const initialGeneration = generation;
  let sessionChange: Promise<boolean> | undefined;
  browser.storage.session.onChanged.addListener((changes) => {
    if (AUTH_SESSION_KEY in changes) {
      const next = (changes[AUTH_SESSION_KEY].newValue as any)?.account ?? null;
      sessionChange = chooseAccount(next);
      void sessionChange.then((ok) => {
        if (ok) schedule(0);
      });
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === ACCOUNT_STORAGE_KEY && switched()) {
      accountSelection++;
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
    if (account && id && !switched())
      void database.preferences.put({ id, value }).catch(() => {});
  });
  syncState.value.lastSyncedAt = Number(
    (await database.syncMeta.get('lastSyncedAt'))?.value || 0,
  );
  try {
    const response = await browser.runtime.sendMessage({
      type: 'duoyu-auth',
      action: 'status',
    });
    if (generation !== initialGeneration) return false;
    // Session events received during startup take priority over the status
    // request, which may have captured an earlier login.
    const selected =
      sessionChange ?? (response?.view && chooseAccount(response.view.account));
    if (selected && !(await selected)) return false;
    await restoreWallpaperChoice();
    if (account && generation === initialGeneration) {
      await syncNow();
      await projectPreferences();
    }
  } catch {
    if (generation === initialGeneration) syncState.value.status = '离线';
  }
  return true;
}
export async function setSyncPreference(id: string, value: unknown) {
  assertCurrentPageAccount();
  if (pageAccountKey) {
    await database.preferences.put({ id, value });
  } else await browser.storage.local.set({ [id]: value });
}
export async function getSyncPreference(id: string) {
  assertCurrentPageAccount();
  const value = pageAccountKey
    ? (await database.preferences.get(id))?.value
    : (await browser.storage.local.get(id))[id];
  assertCurrentPageAccount();
  return value;
}
async function projectPreferences() {
  if (!pageAccountKey || switched()) return;
  const modeKey = scopedKey('duoyu-wallpaper-mode');
  const oldWallpaperMode = localStorage.getItem(modeKey);
  const preferences = await database.preferences.toArray();
  if (switched()) return;
  for (const p of preferences) {
    const key =
      p.id === 'dockOrder'
        ? 'duoyu-dock-order'
        : p.id === 'wallpaperMode'
          ? 'duoyu-wallpaper-mode'
          : p.id.startsWith('layout:')
            ? 'duoyu-layout-' + p.id.slice(7)
            : '';
    if (key) {
      if (p.value == null) localStorage.removeItem(scopedKey(key));
      else
        localStorage.setItem(
          scopedKey(key),
          typeof p.value === 'string' ? p.value : JSON.stringify(p.value),
        );
    }
    if (p.id === 'glassMode')
      document.documentElement.dataset.glassMode = String(p.value);
  }
  // Explicit selection is authoritative; a legacy mode can arrive independently.
  const selection = preferences.find(
    (row) => row.id === 'wallpaperSelection',
  )?.value;
  if (typeof selection === 'string') {
    if (selection === 'daily') localStorage.removeItem(modeKey);
    else localStorage.setItem(modeKey, 'custom');
  }
  window.dispatchEvent(new Event('duoyu-sync-preferences'));
  if (oldWallpaperMode !== localStorage.getItem(modeKey)) {
    localStorage.removeItem(scopedKey('duoyu:wallpaper-preview'));
    window.dispatchEvent(new Event('duoyu-wallpaper-change'));
  }
}
export function formatSyncTime(time: number) {
  if (!time) return '';
  const date = new Date(time),
    pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function restoreCloudBackup(
  id: string,
  expected: { epoch: string; revision: string },
  requestId: string,
) {
  if (!account || switched()) throw Error('请先登录账号');
  await syncNow();
  if (syncState.value.error) throw Error(syncState.value.error);
  await navigator.locks.request(
    'duoyu:sync:' + activeAccountKey(),
    async () => {
      if (await database.syncOutbox.count())
        throw Error('还有未同步的修改，请先完成同步');
      if (await database.syncConflicts.filter((r) => !r.resolvedAt).count())
        throw Error('请先处理同步更改，再恢复备份');
      const deviceId = String(
        (await database.syncMeta.get('device'))?.value || crypto.randomUUID(),
      );
      const result = await rpc(
        '/api/v1/sync/backups/' + id + '/restore',
        'POST',
        {
          id: requestId,
          deviceId,
          ...expected,
        },
      );
      if (result.status !== 'applied') throw Error('备份未恢复，请刷新后重试');
      await refreshSnapshot();
    },
  );
}

export async function backupCloudNow() {
  if (!account || switched()) throw Error('请先登录账号再创建云端备份');
  await syncNow();
  if (syncState.value.error) throw Error(syncState.value.error);
  await navigator.locks.request(
    'duoyu:sync:' + activeAccountKey(),
    async () => {
      if (await database.syncOutbox.count())
        throw Error('还有未同步的修改，请先完成同步');
      if (await database.syncConflicts.filter((row) => !row.resolvedAt).count())
        throw Error('请先处理同步更改，再创建云端备份');
      await rpc('/api/v1/sync/backups', 'POST', {});
    },
  );
}
