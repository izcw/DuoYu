import Dexie, { type Table } from 'dexie';
import {
  guardAccountWrites,
  pageAccountKey,
} from '../../shared/storage/account';
import {
  markBounds,
  unionBounds,
  type Bounds,
  type Mark,
  type Paper,
} from './drawing';

export interface Sheet {
  id: string;
  name: string;
  paper: Paper;
  width: number;
  height: number;
  created: number;
  head: number;
  length: number;
  branch: number;
  revision: number;
  bounds?: Bounds;
}
interface Entry {
  sheetId: string;
  step: number;
  mark: Mark;
  area: Bounds;
  bounds?: Bounds;
}

function contentBounds(previous: Bounds | undefined, mark: Mark, area: Bounds) {
  if (
    (mark.kind === 'ink' && mark.brush === 'eraser') ||
    area.width <= 0 ||
    area.height <= 0
  )
    return previous;
  return previous ? unionBounds(previous, area) : area;
}

/** The whole drawing in world coordinates, including a margin around its ink. */
export function sheetView(sheet: Sheet): Bounds {
  const b = sheet.bounds;
  if (!b) return { x: 0, y: 0, width: sheet.width, height: sheet.height };
  const margin = Math.max(16, Math.max(b.width, b.height) * 0.035);
  const x = Math.floor(b.x - margin),
    y = Math.floor(b.y - margin);
  return {
    x,
    y,
    width: Math.ceil(b.x + b.width + margin) - x,
    height: Math.ceil(b.y + b.height + margin) - y,
  };
}

const db = new Dexie('duoyu-canvas-' + pageAccountKey) as Dexie & {
  sheets: Table<Sheet, string>;
  entries: Table<Entry, [string, number]>;
};
db.version(1).stores({ sheets: 'id, created', entries: '[sheetId+step]' });
db.version(2)
  .stores({})
  .upgrade(async (tx) => {
    const sheets = tx.table<Sheet, string>('sheets');
    const entries = tx.table<Entry, [string, number]>('entries');
    for (const sheet of await sheets.toArray()) {
      let bounds: Bounds | undefined;
      let current: Bounds | undefined;
      // The compound primary key visits the original strokes in drawing order.
      // Include the redo tail so reopening an older, partly undone sheet is lossless.
      await entries
        .where('[sheetId+step]')
        .between([sheet.id, 1], [sheet.id, Infinity], true, true)
        .modify((entry) => {
          entry.area = markBounds(entry.mark);
          bounds = contentBounds(bounds, entry.mark, entry.area);
          entry.bounds = bounds;
          if (entry.step === sheet.head) current = bounds;
        });
      if (current) await sheets.update(sheet.id, { bounds: current });
    }
  });
guardAccountWrites(db);

export function newSheet(
  name: string,
  paper: Paper = '#ffffff',
  width = 1600,
  height = 1000,
): Sheet {
  return {
    id: crypto.randomUUID(),
    name,
    paper,
    width,
    height,
    created: Date.now(),
    head: 0,
    length: 0,
    branch: 0,
    revision: 0,
  };
}
export const sheets = db.sheets;
export async function ensureSheet() {
  await db.transaction('rw', sheets, async () => {
    if (!(await sheets.count())) await sheets.add(newSheet('画布 01'));
  });
}
export function removeSheet(id: string) {
  return db.transaction('rw', sheets, db.entries, async () => {
    await db.entries
      .where('[sheetId+step]')
      .between([id, 0], [id, Infinity])
      .delete();
    await sheets.delete(id);
    if (!(await sheets.count())) await sheets.add(newSheet('画布 01'));
  });
}
export async function addMark(id: string, mark: Mark) {
  return db.transaction('rw', sheets, db.entries, async () => {
    const sheet = await sheets.get(id);
    if (!sheet) throw Error('这张画布已被删除');
    const step = sheet.head + 1;
    const fork = sheet.head < sheet.length;
    if (fork)
      await db.entries
        .where('[sheetId+step]')
        .between([id, step], [id, Infinity])
        .delete();
    const area = markBounds(mark);
    const bounds = contentBounds(sheet.bounds, mark, area);
    await db.entries.add({ sheetId: id, step, mark, area, bounds });
    const revision = sheet.revision + 1;
    await sheets.update(id, {
      head: step,
      length: step,
      revision,
      bounds,
      branch: sheet.branch + Number(fork),
    });
    return revision;
  });
}
export async function stepHistory(id: string, delta: number) {
  await db.transaction('rw', sheets, db.entries, async () => {
    const sheet = await sheets.get(id);
    if (!sheet) return;
    const head = Math.min(sheet.length, Math.max(0, sheet.head + delta));
    if (head !== sheet.head) {
      const bounds = head
        ? (await db.entries.get([id, head]))?.bounds
        : undefined;
      await sheets.update(id, { head, bounds, revision: sheet.revision + 1 });
    }
  });
}

// Snapshot both the cursor and its entries in one transaction. A different
// tab can undo and replace the tail while a thumbnail is waiting to paint.
export function readInk(id: string, cachedBranch: number, cachedHead: number) {
  return db.transaction('r', sheets, db.entries, async () => {
    const sheet = await sheets.get(id);
    if (!sheet) return;
    const append = sheet.branch === cachedBranch && sheet.head >= cachedHead;
    const start = append ? cachedHead + 1 : 1;
    const entries =
      start > sheet.head
        ? []
        : await db.entries
            .where('[sheetId+step]')
            .between([id, start], [id, sheet.head], true, true)
            .toArray();
    return { sheet, append, entries };
  });
}
