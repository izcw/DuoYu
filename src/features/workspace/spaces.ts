import { database } from '../../shared/storage/database';

export async function ensureDefaultSpace() {
  if (database.name !== 'duoyu') return;
  await database.transaction('rw', database.workspaceSpaces, async () => {
    if (!(await database.workspaceSpaces.get('default')))
      await database.workspaceSpaces.put({
        id: 'default',
        name: '个人空间',
        order: 0,
      });
  });
}
export async function saveSpace(name = '', id?: string) {
  let trimmed = name.trim().slice(0, 40);
  if (id && !trimmed) throw new Error('请输入空间名称');
  return database.transaction('rw', database.workspaceSpaces, async () => {
    if (id) {
      if (!(await database.workspaceSpaces.update(id, { name: trimmed })))
        throw new Error('空间已不存在');
      return id;
    }
    const spaces = await database.workspaceSpaces.toArray();
    if (!trimmed) {
      const next =
        spaces.reduce((max, space) => {
          const number = /^新空间(\d+)$/.exec(space.name)?.[1];
          return Math.max(max, Number(number || 0));
        }, 0) + 1;
      trimmed = `新空间${next}`;
    }
    const lastOrder = spaces.reduce(
      (max, space) => Math.max(max, space.order),
      -1,
    );
    const key = crypto.randomUUID();
    await database.workspaceSpaces.add({
      id: key,
      name: trimmed,
      order: lastOrder + 1,
    });
    return key;
  });
}
export async function deleteSpace(id: string) {
  if (id === 'default') throw new Error('默认空间不能删除');
  await database.transaction(
    'rw',
    database.workspaceSpaces,
    database.tabCollections,
    async () => {
      await database.tabCollections
        .where('spaceId')
        .equals(id)
        .modify({ spaceId: 'default' });
      await database.workspaceSpaces.delete(id);
    },
  );
}
