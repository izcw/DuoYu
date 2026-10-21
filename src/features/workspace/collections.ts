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
export async function createCollection(name: string, tabs: SavedTab[] = []) {
  return database.transaction('rw', database.tabCollections, async () => {
    const last = await database.tabCollections.orderBy('order').last();
    const collection: TabCollection = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 80) || '未命名集合',
      order: (last?.order ?? -1) + 1,
      updatedAt: Date.now(),
      tabs,
    };
    await database.tabCollections.add(collection);
    return collection.id;
  });
}
export async function renameCollection(id: string, name: string) {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return;
  await database.tabCollections.update(id, {
    name: trimmed,
    updatedAt: Date.now(),
  });
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
    if (index < 0) return;
    const [tab] = from.tabs.splice(index, 1);
    const at = before ? to.tabs.findIndex((t) => t.id === before) : -1;
    to.tabs.splice(at < 0 ? to.tabs.length : at, 0, tab!);
    from.updatedAt = to.updatedAt = Date.now();
    await database.tabCollections.put(from);
    if (source !== target) await database.tabCollections.put(to);
  });
}
export async function reorderCollection(id: string, before: string) {
  if (id === before) return;
  await database.transaction('rw', database.tabCollections, async () => {
    const all = await database.tabCollections.orderBy('order').toArray();
    const item = all.find((c) => c.id === id);
    if (!item || !all.some((c) => c.id === before)) return;
    const rest = all.filter((c) => c.id !== id);
    rest.splice(
      rest.findIndex((c) => c.id === before),
      0,
      item,
    );
    await database.tabCollections.bulkPut(
      rest.map((c, order) => ({ ...c, order })),
    );
  });
}
