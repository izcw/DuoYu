import { database } from '../../shared/storage/database';

// Call within the same write transaction as the item. Home has no page row.
export async function requireLibraryPage(pageId: string) {
  if (pageId === 'home' || (await database.libraryPages.get(pageId))) return;
  if (pageId !== 'default' || (await database.libraryPages.count()))
    throw new Error('该收藏页已被删除，请重新选择');
  await database.libraryPages.add({
    id: 'default',
    name: '常用收藏',
    order: 0,
  });
}

export async function ensureLibraryPage() {
  if (database.name !== 'duoyu') return;
  await database.transaction('rw', database.libraryPages, async () => {
    if (!(await database.libraryPages.count()))
      await database.libraryPages.put({
        id: 'default',
        name: '常用收藏',
        order: 0,
      });
  });
}
export async function addLibraryPage(name?: string, icon = 'Bookmark') {
  return database.transaction('rw', database.libraryPages, async () => {
    const pages = await database.libraryPages.toArray();
    let n = 1;
    while (pages.some((p) => p.name === `收藏页 ${n}`)) n++;
    const id = crypto.randomUUID();
    await database.libraryPages.put({
      id,
      name: name?.trim().slice(0, 30) || `收藏页 ${n}`,
      icon,
      order: Math.max(-1, ...pages.map((p) => p.order)) + 1,
    });
    return id;
  });
}
export async function removeLibraryPage(id: string) {
  return database.transaction(
    'rw',
    database.libraryPages,
    database.libraryItems,
    async () => {
      const pages = await database.libraryPages.orderBy('order').toArray();
      const target = pages.find((p) => p.id !== id);
      if (!target) throw new Error('请至少保留一个收藏页');
      // Keep saved links and folders when removing their page.
      await database.libraryItems
        .filter((i) => (i.pageId || 'default') === id)
        .modify({ pageId: target.id });
      await database.libraryPages.delete(id);
      return target.id;
    },
  );
}
export async function orderLibraryPages(ids: string[]) {
  await database.transaction('rw', database.libraryPages, async () => {
    const currentIds = await database.libraryPages.toCollection().primaryKeys();
    const requested = new Set(ids);
    if (
      ids.length !== currentIds.length ||
      requested.size !== ids.length ||
      currentIds.some((id) => !requested.has(id))
    )
      throw new Error('收藏页已更改，请重新排序');
    for (const [order, id] of ids.entries())
      await database.libraryPages.update(id, { order });
  });
}
