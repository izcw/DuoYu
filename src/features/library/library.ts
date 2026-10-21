import { database, type LibraryItem } from '../../shared/storage/database';
import { webUrl } from '../workspace/collections';

export type LibraryDraft = Pick<
  LibraryItem,
  'kind' | 'name' | 'url' | 'icon' | 'parent'
>;
export async function saveLibraryItem(draft: LibraryDraft, id?: string) {
  const name = draft.name.trim().slice(0, 80);
  if (!name) throw new Error('请输入名称');
  const url = draft.kind === 'link' ? webUrl(draft.url.trim()) : '';
  if (url === null) throw new Error('请输入完整的 http:// 或 https:// 网址');
  const icon = draft.icon.trim();
  if (icon && !webUrl(icon))
    throw new Error('图标地址须为 http:// 或 https:// 网址');
  await database.transaction('rw', database.libraryItems, async () => {
    const previous = id ? await database.libraryItems.get(id) : undefined;
    if (id && !previous) throw new Error('该收藏已被删除');
    if (draft.parent) {
      const folder = await database.libraryItems.get(draft.parent);
      if (draft.kind === 'folder' || folder?.kind !== 'folder')
        throw new Error('请选择有效的文件夹');
    }
    const all = await database.libraryItems.toArray();
    const order =
      previous?.parent === draft.parent
        ? previous.order
        : Math.max(
            -1,
            ...all.filter((i) => i.parent === draft.parent).map((i) => i.order),
          ) + 1;
    await database.libraryItems.put({
      ...draft,
      id: id || crypto.randomUUID(),
      name,
      url: url || '',
      icon,
      order,
      updatedAt: Date.now(),
    });
  });
}
export async function moveLibraryItem(
  id: string,
  parent: string,
  before?: string,
) {
  if (id === before) return;
  await database.transaction('rw', database.libraryItems, async () => {
    const item = await database.libraryItems.get(id);
    if (!item) return;
    if (parent) {
      const folder = await database.libraryItems.get(parent);
      if (item.kind === 'folder' || folder?.kind !== 'folder')
        throw new Error('文件夹暂不支持嵌套');
    }
    const siblings = (
      await database.libraryItems.where('parent').equals(parent).sortBy('order')
    ).filter((i) => i.id !== id);
    const index = siblings.findIndex((i) => i.id === before);
    siblings.splice(index < 0 ? siblings.length : index, 0, {
      ...item,
      parent,
    });
    await database.libraryItems.bulkPut(
      siblings.map((entry, order) => ({
        ...entry,
        order,
        updatedAt: Date.now(),
      })),
    );
  });
}
export async function deleteLibraryItem(id: string) {
  await database.transaction('rw', database.libraryItems, async () => {
    const item = await database.libraryItems.get(id);
    if (!item) return;
    // Removing a folder keeps its links by moving them back to the root.
    if (item.kind === 'folder') {
      const root = await database.libraryItems
        .where('parent')
        .equals('')
        .toArray();
      const children = await database.libraryItems
        .where('parent')
        .equals(id)
        .sortBy('order');
      const start = Math.max(-1, ...root.map((i) => i.order)) + 1;
      await database.libraryItems.bulkPut(
        children.map((entry, index) => ({
          ...entry,
          parent: '',
          order: start + index,
          updatedAt: Date.now(),
        })),
      );
    }
    await database.libraryItems.delete(id);
  });
}
