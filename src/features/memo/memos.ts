import { database, type Memo } from '../../shared/storage/database';

const table = database.memos;
export const memoColors = {
  sand: '奶黄',
  rose: '桃粉',
  sage: '鼠尾草绿',
  sky: '雾蓝',
  lilac: '丁香紫',
} as const;

export async function createMemo(
  x: number,
  y: number,
  width: number,
  pageId: string,
) {
  return database.transaction('rw', table, async () => {
    const top = await table.orderBy('layer').last();
    const now = Date.now();
    return table.add({
      id: crypto.randomUUID(),
      title: '',
      body: '',
      color: 'sand',
      pageId,
      x,
      y,
      width,
      height: 212,
      layer: (top?.layer ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      archiveOrder: 0,
    });
  });
}

type MemoChanges = Partial<
  Pick<
    Memo,
    'title' | 'body' | 'html' | 'color' | 'x' | 'y' | 'width' | 'height'
  >
>;
export function updateMemo(id: string, changes: MemoChanges) {
  return table.update(id, { ...changes, updatedAt: Date.now() });
}

export function bringToFront(id: string) {
  return database.transaction('rw', table, async () => {
    const top = await table.orderBy('layer').last();
    if (top && top.id !== id) await table.update(id, { layer: top.layer + 1 });
  });
}

export function archiveMemos(ids: string[], archive: boolean) {
  return database.transaction('rw', table, async () => {
    const now = Date.now();
    const selected = (await table.bulkGet(ids)).filter(
      (note): note is Memo => !!note && (note.archivedAt === null) === archive,
    );
    if (!selected.length) return;
    if (archive) {
      const first = await table
        .filter((note) => note.archivedAt !== null)
        .sortBy('archiveOrder');
      const start = (first[0]?.archiveOrder ?? 0) - selected.length;
      await Promise.all(
        selected.map((note, i) =>
          table.update(note.id, {
            archivedAt: now,
            archiveOrder: start + i,
            updatedAt: now,
          }),
        ),
      );
    } else {
      const top = (await table.orderBy('layer').last())?.layer ?? 0;
      await Promise.all(
        selected.map((note, i) =>
          table.update(note.id, {
            archivedAt: null,
            layer: top + i + 1,
            updatedAt: now,
          }),
        ),
      );
    }
  });
}

export const archiveSort = (a: Memo, b: Memo) =>
  a.archiveOrder - b.archiveOrder ||
  (b.archivedAt ?? 0) - (a.archivedAt ?? 0) ||
  a.id.localeCompare(b.id);

export function reorderArchive(id: string, target: string, after: boolean) {
  return database.transaction('rw', table, async () => {
    const notes = (
      await table.filter((note) => note.archivedAt !== null).toArray()
    ).sort(archiveSort);
    const moved = notes.find((note) => note.id === id);
    const rest = notes.filter((note) => note.id !== id);
    const index = rest.findIndex((note) => note.id === target);
    if (!moved || index < 0) return;
    rest.splice(index + Number(after), 0, moved);
    await Promise.all(
      rest.map((note, order) =>
        note.archiveOrder === order
          ? undefined
          : table.update(note.id, { archiveOrder: order }),
      ),
    );
  });
}
