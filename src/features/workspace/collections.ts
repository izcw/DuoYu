import type { CollectionColor } from '../../shared/collection-colors';
import { ensureDefaultDestination } from './spaces';
import {
  database,
  type SavedTab,
  type TabCollection,
} from '../../shared/storage/database';

export function webUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function hostname(value: string) {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}
export async function createCollection(
  name: string,
  tabs: SavedTab[] = [],
  selectedSpace = 'default',
) {
  const spaceId = selectedSpace || 'default';
  return database.transaction(
    'rw',
    database.tabCollections,
    database.workspaceSpaces,
    async () => {
      if (spaceId === 'default') await ensureDefaultDestination();
      else if (!(await database.workspaceSpaces.get(spaceId)))
        throw new Error('空间已不存在，请重新选择');
      const first = await database.tabCollections.orderBy('order').first();
      const existing = await database.tabCollections.toArray();
      const nextNumber =
        existing
          .filter((c) => (c.spaceId || 'default') === spaceId)
          .reduce(
            (max, c) =>
              Math.max(max, Number(/^集合(\d+)$/.exec(c.name)?.[1] || 0)),
            0,
          ) + 1;
      const collection: TabCollection = {
        id: crypto.randomUUID(),
        name:
          name.trim().slice(0, 80) ||
          `集合${String(nextNumber).padStart(2, '0')}`,
        order: (first?.order ?? 1) - 1,
        updatedAt: Date.now(),
        tabs,
        spaceId,
      };
      await database.tabCollections.add(collection);
      return collection.id;
    },
  );
}
export async function renameCollection(id: string, name: string) {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return;
  if (
    !(await database.tabCollections.update(id, {
      name: trimmed,
      updatedAt: Date.now(),
    }))
  )
    throw new Error('集合已不存在');
}
export function removeCollection(id: string) {
  return database.transaction('rw', database.tabCollections, async () => {
    const group = await database.tabCollections.get(id);
    if (!group) throw new Error('集合已不存在');
    await database.tabCollections.delete(id);
    return group;
  });
}
export function restoreCollection(group: TabCollection) {
  return database.transaction(
    'rw',
    database.tabCollections,
    database.workspaceSpaces,
    async () => {
      let spaceId = group.spaceId || 'default';
      if (!(await database.workspaceSpaces.get(spaceId))) {
        await ensureDefaultDestination();
        spaceId = 'default';
      }
      await database.tabCollections.add({ ...group, spaceId });
    },
  );
}
export async function addTabs(id: string, tabs: SavedTab[], before?: string) {
  return database.transaction('rw', database.tabCollections, async () => {
    const group = await database.tabCollections.get(id);
    if (!group) throw new Error('集合已不存在，请选择其他集合');
    const existing = new Set(group.tabs.map((t) => t.url));
    const added = tabs.filter((tab) => {
      if (!webUrl(tab.url) || existing.has(tab.url)) return false;
      existing.add(tab.url);
      return true;
    });
    const index = before ? group.tabs.findIndex((t) => t.id === before) : -1;
    group.tabs.splice(index < 0 ? group.tabs.length : index, 0, ...added);
    group.updatedAt = Date.now();
    await database.tabCollections.put(group);
    return added.length;
  });
}
export async function moveSavedTab(
  source: string,
  id: string,
  target: string,
  before?: string,
) {
  if (source === target && id === before) return;
  await database.transaction('rw', database.tabCollections, async () => {
    const from = await database.tabCollections.get(source);
    const to =
      source === target ? from : await database.tabCollections.get(target);
    if (!from || !to) throw new Error('集合已变更，请重试');
    const index = from.tabs.findIndex((t) => t.id === id);
    if (index < 0) throw new Error('标签页已被移除，请重试');
    const [tab] = from.tabs.splice(index, 1);
    const at = before ? to.tabs.findIndex((t) => t.id === before) : -1;
    if (before && at < 0) throw new Error('目标位置已变更，请重试');
    to.tabs.splice(at < 0 ? to.tabs.length : at, 0, tab!);
    from.updatedAt = to.updatedAt = Date.now();
    await database.tabCollections.put(from);
    if (source !== target) await database.tabCollections.put(to);
  });
}
export async function reorderCollection(
  id: string,
  before: string | undefined,
  spaceId: string,
) {
  if (id === before) return;
  await database.transaction('rw', database.tabCollections, async () => {
    const all = await database.tabCollections
      .orderBy('order')
      .filter((c) => (c.spaceId || 'default') === spaceId)
      .toArray();
    const item = all.find((c) => c.id === id);
    if (!item || (before && !all.some((c) => c.id === before)))
      throw new Error('集合位置已变更，请重试');
    const rest = all.filter((c) => c.id !== id);
    rest.splice(
      before ? rest.findIndex((c) => c.id === before) : rest.length,
      0,
      item,
    );
    let previousOrder = -Infinity;
    for (const [index, group] of rest.entries()) {
      const order = Math.max(all[index]!.order, previousOrder + 1);
      previousOrder = order;
      if (order !== group.order)
        await database.tabCollections.update(group.id, { order });
    }
  });
}

export async function updateSavedTab(
  groupId: string,
  id: string,
  changes: { title?: string; url?: string; starred?: boolean },
) {
  await database.transaction('rw', database.tabCollections, async () => {
    const group = await database.tabCollections.get(groupId);
    const tab = group?.tabs.find((t) => t.id === id);
    if (!group || !tab) throw new Error('标签页已被移除，请刷新后重试');
    if (changes.title !== undefined) {
      if (!changes.title.trim()) throw new Error('请输入名称');
      tab.title = changes.title.trim().slice(0, 200);
    }
    if (changes.url !== undefined) {
      const url = webUrl(changes.url.trim());
      if (!url) throw new Error('请输入完整的 http:// 或 https:// 网址');
      if (url !== tab.url) tab.icon = '';
      tab.url = url;
    }
    if (changes.starred !== undefined) tab.starred = changes.starred;
    group.updatedAt = Date.now();
    await database.tabCollections.put(group);
  });
}

export async function setCollectionColor(id: string, color: CollectionColor) {
  if (
    !(await database.tabCollections.update(id, {
      color,
      updatedAt: Date.now(),
    }))
  )
    throw Error('集合已不存在');
}
