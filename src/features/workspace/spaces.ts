import { database } from '../../shared/storage/database';

export async function ensureDefaultDestination() {
  return database.transaction('rw', database.workspaceSpaces, async () => {
    if (!(await database.workspaceSpaces.get('default')))
      await database.workspaceSpaces.put({
        id: 'default',
        name: '个人空间',
        order: 0,
      });
  });
}
export async function ensureDefaultSpace() {
  if (database.name === 'duoyu-guest-template-v1') return;
  await database.transaction(
    'rw',
    database.workspaceSpaces,
    database.tabCollections,
    async () => {
      if (await database.workspaceSpaces.get('default')) return;
      // Earlier versions could move groups here without creating the destination.
      const stranded = await database.tabCollections
        .filter((group) => (group.spaceId || 'default') === 'default')
        .first();
      if (stranded) await ensureDefaultDestination();
    },
  );
}
export async function saveSpace(name = '', id?: string, icon?: string) {
  let trimmed = name.trim().slice(0, 40);
  if (id && !trimmed) throw new Error('请输入空间名称');
  return database.transaction('rw', database.workspaceSpaces, async () => {
    if (id) {
      if (
        !(await database.workspaceSpaces.update(id, {
          name: trimmed,
          ...(icon ? { icon } : {}),
        }))
      )
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
      ...(icon ? { icon } : {}),
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
      const moved = await database.tabCollections
        .where('spaceId')
        .equals(id)
        .modify({ spaceId: 'default' });
      if (moved) await ensureDefaultDestination();
      await database.workspaceSpaces.delete(id);
    },
  );
}

export async function orderSpaces(ids: string[]) {
  await database.transaction('rw', database.workspaceSpaces, async () => {
    const current = await database.workspaceSpaces.toArray();
    const positions = new Map(ids.map((id, order) => [id, order]));
    if (
      ids.length !== current.length ||
      positions.size !== ids.length ||
      current.some((space) => !positions.has(space.id))
    )
      throw new Error('空间已变更，请重新排序');
    for (const space of current) {
      const order = positions.get(space.id)!;
      if (space.order !== order)
        await database.workspaceSpaces.update(space.id, { order });
    }
  });
}
