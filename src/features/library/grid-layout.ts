import type { LibraryItem } from '../../shared/storage/database';
import {
  DESKTOP_GRID_COLUMNS,
  itemMaxColumns,
  itemMaxRows,
} from './grid-config';
export function normalizeSize(
  width: number,
  height: number,
  kind: LibraryItem['kind'] = 'folder',
) {
  let w = Math.max(1, Math.min(itemMaxColumns(kind), Math.round(width))),
    h = Math.max(1, Math.min(itemMaxRows(kind), Math.round(height)));
  if (kind !== 'link' && w * h < 3) {
    if (h > w) h = 3;
    else w = 3;
  }
  return { width: w, height: h };
}
export function layoutLibraryItems(
  source: LibraryItem[],
  rows: number,
  priority: ReadonlySet<string> = new Set(),
) {
  const items: { item: LibraryItem; x: number; y: number }[] = [],
    occupied = new Set<number>();
  let overflow = 0;
  const positioned = (item: LibraryItem) =>
    item.gridX != null && item.gridY != null;
  const ordered = [...source].sort(
    (a, b) =>
      Number(positioned(b) && priority.has(b.id)) -
        Number(positioned(a) && priority.has(a.id)) ||
      Number(positioned(b)) - Number(positioned(a)),
  );
  for (const item of ordered) {
    const { width: w, height: h } = normalizeSize(
      item.width || (item.kind === 'link' ? 1 : 3),
      Math.min(item.height || 1, rows),
      item.kind,
    );
    const fits = (x: number, y: number) =>
      x >= 0 &&
      y >= 0 &&
      x + w <= DESKTOP_GRID_COLUMNS &&
      y + h <= rows &&
      Array.from({ length: h }, (_, dy) =>
        Array.from(
          { length: w },
          (_, dx) => (y + dy) * DESKTOP_GRID_COLUMNS + x + dx,
        ),
      )
        .flat()
        .every((k) => !occupied.has(k));
    let x =
        item.gridX == null
          ? -1
          : Math.min(item.gridX, DESKTOP_GRID_COLUMNS - w),
      y = item.gridY == null ? -1 : Math.min(item.gridY, rows - h);
    if (!fits(x, y)) {
      const slot = Array.from(
        { length: DESKTOP_GRID_COLUMNS * rows },
        (_, k) => k,
      ).find((k) =>
        fits(k % DESKTOP_GRID_COLUMNS, Math.floor(k / DESKTOP_GRID_COLUMNS)),
      );
      if (slot == null) {
        overflow++;
        continue;
      }
      x = slot % DESKTOP_GRID_COLUMNS;
      y = Math.floor(slot / DESKTOP_GRID_COLUMNS);
    }
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        occupied.add((y + dy) * DESKTOP_GRID_COLUMNS + x + dx);
    items.push({ item, x, y });
  }
  return { items, overflow };
}
