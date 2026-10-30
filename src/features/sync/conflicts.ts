import { database } from '../../shared/storage/database';
import { activeAccountKey } from '../../shared/storage/account';
import type { SyncConflict, CapturedOperation } from './capture';
import {
  rowChanges,
  same,
  snapshotValue,
  type Change,
  type Row,
} from './model';
import { rpc, syncNow, remoteTransaction } from './client';
export const conflictReasons: Record<string, string> = {
  field_conflict: '同一内容在其他设备上也被修改了',
  layout_conflict: '位置或大小与其他设备的修改冲突',
  layout_overlap: '这个位置已被其他项目占用',
  deleted_or_missing: '项目已在其他设备上删除',
  delete_conflict: '删除前，其他设备更新了这个项目',
  epoch_changed: '云端已恢复数据，需要确认这些本机修改',
  epoch_required: '这项更改来自旧版扩展，请检查后重新应用',
  missing_parent: '所在文件夹已不存在',
  invalid_parent: '所在文件夹发生了变化',
  missing_page: '所在页面已不存在',
  missing_collection: '所在集合已不存在',
  missing_space: '所在空间已不存在',
  account_data_quota: '云端数据已达到容量上限',
  body_too_large: '本次修改超出单次同步大小',
  invalid_operation: '这次操作需要重新整理后提交',
  asset_quota: '图片存储空间不足',
  missing_asset: '图片尚未完整上传',
};
export function conflictChanges(record: SyncConflict): Change[] {
  const op = record.operation as CapturedOperation & { changes?: Change[] };
  return (
    (op.prepared as { changes?: Change[] })?.changes ??
    op.changes ??
    rowChanges(op.rows ?? {})
  );
}
export async function fetchRemoteConflicts(request: typeof rpc = rpc) {
  const response = await request('/v1/sync/conflicts');
  const epoch = (await database.syncMeta.get('epoch'))?.value;
  const changed =
    (await database.syncMeta.get('conflictEpoch'))?.value !== epoch;
  for (const entry of response.conflicts ?? []) {
    const existing = await database.syncConflicts.get(entry.operation_id);
    await database.syncConflicts.put({
      id: entry.operation_id,
      createdAt: existing?.createdAt ?? Date.parse(entry.created_at),
      operation: existing?.operation ?? {
        id: entry.operation_id,
        changes: entry.detail.changes,
      },
      reason: entry.detail.code ?? existing?.reason ?? 'field_conflict',
      state: changed ? 'conflict' : (existing?.state ?? 'conflict'),
      server: true,
      ...(entry.resolved_at
        ? { resolvedAt: Date.parse(entry.resolved_at) }
        : !changed && existing?.resolvedAt
          ? { resolvedAt: existing.resolvedAt }
          : {}),
    });
  }
  if (epoch) await database.syncMeta.put({ id: 'conflictEpoch', value: epoch });
}
export async function discardConflict(
  id: string,
  expected: Record<string, string> = {},
) {
  await syncNow();
  const latest = new Map(
    (await database.syncShadow.toArray()).map((e) => [e.id, e.revision]),
  );
  for (const [key, revision] of Object.entries(expected))
    if ((latest.get(key) ?? '0') !== revision)
      throw Error('云端又有新修改，已刷新预览，请确认后重新应用');
  const record = await database.syncConflicts.get(id);
  if (!record) return;
  if (record.server)
    await rpc('/v1/sync/conflicts/' + id + '/resolve', 'POST', {});
  await database.syncConflicts.update(id, { resolvedAt: Date.now() });
  await syncNow();
}
export async function retryConflict(
  id: string,
  overrides: Record<string, Row> = {},
  expected: Record<string, string> = {},
  wholeVersion = false,
  replacementChanges?: Change[],
) {
  await syncNow();
  await navigator.locks.request(
    'duoyu:sync:' + activeAccountKey(),
    async () => {
      const record = await database.syncConflicts.get(id);
      if (!record || record.resolvedAt)
        throw Error('这项更改已处理，请刷新列表');
      const all = await database.syncShadow.toArray();
      const shadow = new Map(all.map((r) => [r.id, r]));
      for (const [key, revision] of Object.entries(expected))
        if ((shadow.get(key)?.revision ?? '0') !== revision)
          throw Error('云端又有新修改，已刷新对比，请确认后重新应用');
      const originals = replacementChanges
        ? snapshotValue(replacementChanges)
        : conflictChanges(record);
      const copies = new Map<string, string>();
      for (const change of originals) {
        const remote = shadow.get(change.table + ':' + change.id);
        if (
          change.value &&
          (remote?.deleted ||
            (!remote && (!wholeVersion || change.base !== null))) &&
          !['preferences', 'shortcuts'].includes(change.table)
        )
          copies.set(
            change.table + ':' + change.id,
            change.table === 'shortcutItems'
              ? change.value.groupId + ':' + crypto.randomUUID()
              : crypto.randomUUID(),
          );
      }
      const changes: Change[] = [];
      for (const c of originals) {
        const key = c.table + ':' + c.id,
          remote = shadow.get(key),
          base = remote && !remote.deleted ? (remote.payload as Row) : null;
        if (c.value === null) {
          if (base)
            changes.push({
              ...c,
              base,
              value: null,
              revision: remote!.revision,
            });
          continue;
        }
        const newId = copies.get(key) ?? c.id,
          value: Row = wholeVersion
            ? { ...c.value }
            : { ...(base ?? c.base ?? {}) };
        if (!wholeVersion)
          for (const field of Object.keys({ ...c.base, ...c.value }))
            if (!same(c.base?.[field], c.value[field])) {
              if (field in c.value) value[field] = c.value[field];
              else delete value[field];
            }
        Object.assign(value, overrides[key] ?? {});
        value.id = newId;
        for (const [field, table] of [
          ['parent', 'libraryItems'],
          ['pageId', 'libraryPages'],
          ['spaceId', 'workspaceSpaces'],
          ['collectionId', 'tabCollections'],
        ] as const)
          if (value[field] && copies.has(table + ':' + value[field]))
            value[field] = copies.get(table + ':' + value[field]);
        if (c.table === 'libraryItems') {
          const parent = shadow.get('libraryItems:' + value.parent);
          if (
            value.parent &&
            !copies.has('libraryItems:' + c.value.parent) &&
            (!parent || parent.deleted)
          )
            value.parent = '';
          const page = shadow.get('libraryPages:' + value.pageId);
          if (
            value.pageId &&
            !['home', '__dock'].includes(value.pageId) &&
            (!page || page.deleted) &&
            !copies.has('libraryPages:' + c.value.pageId)
          )
            value.pageId = 'home';
          if (copies.has(key) && !wholeVersion) {
            value.name = (value.name || '恢复的项目') + '（恢复）';
            delete value.gridX;
            delete value.gridY;
          }
        }
        changes.push({
          table: c.table,
          id: newId,
          base,
          value,
          revision: base ? remote!.revision : '0',
        });
        if (remote?.deleted && ['preferences', 'shortcuts'].includes(c.table)) {
          const last = changes.at(-1)!;
          last.restore = true;
          last.base = remote.payload as Row;
          last.revision = remote.revision;
        }
      }
      // Restore saved tabs into a valid recovered collection/space rather than
      // leaving a dangling relationship when their old container was deleted.
      const planned = new Map(
        changes
          .filter((c) => c.value)
          .map((c) => [c.table + ':' + c.id, c.value!]),
      );
      const live = (table: string, key: string) =>
        planned.has(table + ':' + key) ||
        !!(
          shadow.get(table + ':' + key) &&
          !shadow.get(table + ':' + key)!.deleted
        );
      let recoveredSpace = '';
      function space() {
        if (recoveredSpace) return recoveredSpace;
        const existing = all.find(
          (r) => r.table === 'workspaceSpaces' && !r.deleted,
        );
        if (existing) return existing.entityId;
        recoveredSpace = crypto.randomUUID();
        const value = { id: recoveredSpace, name: '恢复的空间', order: 999 };
        changes.push({
          table: 'workspaceSpaces',
          id: recoveredSpace,
          base: null,
          value,
          revision: '0',
        });
        planned.set('workspaceSpaces:' + recoveredSpace, value);
        return recoveredSpace;
      }
      const recoveredGroups = new Map<string, string>();
      for (const c of [...changes]) {
        if (
          c.table === 'tabCollections' &&
          c.value &&
          !live('workspaceSpaces', c.value.spaceId)
        )
          c.value.spaceId = space();
        if (
          c.table === 'savedTabs' &&
          c.value &&
          !live('tabCollections', c.value.collectionId)
        ) {
          const old = c.value.collectionId;
          let group = recoveredGroups.get(old);
          if (!group) {
            group = crypto.randomUUID();
            recoveredGroups.set(old, group);
            const value = {
              id: group,
              spaceId: space(),
              name: '恢复的集合',
              order: 999,
              updatedAt: Date.now(),
            };
            changes.push({
              table: 'tabCollections',
              id: group,
              base: null,
              value,
              revision: '0',
            });
            planned.set('tabCollections:' + group, value);
          }
          c.value.collectionId = group;
        }
      }
      for (const c of [...changes])
        if (
          c.table === 'shortcutItems' &&
          c.value &&
          !live('shortcuts', c.value.groupId)
        ) {
          const group = c.value.groupId,
            previous = shadow.get('shortcuts:' + group),
            value = { id: group };
          changes.push({
            table: 'shortcuts',
            id: group,
            base: previous?.deleted ? (previous.payload as Row) : null,
            value,
            revision: previous?.revision ?? '0',
            ...(previous?.deleted ? { restore: true } : {}),
          });
          planned.set('shortcuts:' + group, value);
        }
      if (!changes.length) {
        await database.syncConflicts.update(id, { resolvedAt: Date.now() });
        if (record.server)
          await rpc('/v1/sync/conflicts/' + id + '/resolve', 'POST', {});
        return;
      }
      // A resolution is a fresh commit based on current cloud state, never a replay
      // of the rejected request ID. A concurrent edit is checked again by the server.
      const operationId = crypto.randomUUID();
      let device = String((await database.syncMeta.get('device'))?.value ?? '');
      if (!device) {
        device = crypto.randomUUID();
        await database.syncMeta.put({ id: 'device', value: device });
      }
      const epoch = String((await database.syncMeta.get('epoch'))?.value ?? '');
      const rows = Object.fromEntries(
        changes.map((c) => [
          c.table + ':' + c.id,
          { table: c.table, id: c.id, base: c.base, value: c.value },
        ]),
      );
      const operation: CapturedOperation = {
        id: operationId,
        createdAt: Date.now(),
        rows,
        resolutionOf: id,
      };
      // Let normal preparation handle binary assets. Saved tabs are already
      // normalized so a prepared changes list is supplied after asset encoding.
      const { encodeAssets } = await import('./assets');
      const encoded = await encodeAssets(changes, epoch);
      operation.prepared = {
        id: operationId,
        deviceId: device,
        changes: encoded,
        epoch,
        resolutionOf: id,
      };
      await remoteTransaction(async () => {
        await database.syncOutbox.put(operation);
        await database.syncConflicts.update(id, { state: 'resolving' });
      });
    },
  );
  await syncNow();
}
export const fieldLabels: Record<string, string> = {
  name: '名称',
  title: '标题',
  url: '网址',
  text: '正文',
  icon: '图标外观',
  parent: '所在文件夹',
  pageId: '所在页面',
  gridX: '横向位置',
  gridY: '纵向位置',
  width: '宽度',
  height: '高度',
  order: '顺序',
  position: '排列位置',
  spaceId: '所在空间',
  collectionId: '所在集合',
  value: '设置值',
};
export function conflictFields(change: Change) {
  return Object.keys({ ...change.base, ...change.value }).filter(
    (k) =>
      !['id', 'updatedAt', 'savedAt'].includes(k) &&
      !same(change.base?.[k], change.value?.[k]),
  );
}
export function conflictValue(value: unknown) {
  if (value === undefined || value === null) return '（无）';
  if (value instanceof Blob) return '图片文件';
  if (
    typeof value === 'string' &&
    (value.startsWith('data:image/') || value.startsWith('duoyu-asset:'))
  )
    return '图片文件';
  if (typeof value === 'string' && value.startsWith('duoyu-icon:')) {
    try {
      const p = JSON.parse(value.slice(11));
      return [
        p.mode === 'text'
          ? '文字图标'
          : p.mode === 'upload'
            ? '上传图标'
            : '网站图标',
        p.text,
        p.material === 'fill' ? '填充' : '液态玻璃',
        p.color || '透明',
      ]
        .filter(Boolean)
        .join(' · ');
    } catch {
      return '图标';
    }
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
