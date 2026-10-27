import { ref } from 'vue';
import { DESKTOP_GRID_COLUMNS, DESKTOP_GRID_CELL_HEIGHT } from './grid-config';
import type { GridStack } from 'gridstack';
import { BoundedWidgetEngine } from '../../shared/BoundedWidgetEngine';
import { database } from '../../shared/storage/database';

export const pageDragError = ref('');
let session:
  | {
      id: string;
      source: string;
      target: string;
      ghost: HTMLElement;
      original: HTMLElement;
      originalVisibility: string;
      sourceBounds?: DOMRect;
      switched: boolean;
      fromFolder?: boolean;
    }
  | undefined;
let hover = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let navigate: ((id: string) => void) | undefined;
let point = { x: 0, y: 0 };
export function beginPageDrag(
  id: string,
  source: string,
  element: HTMLElement,
) {
  cancelPageDrag();
  const visual =
    element.querySelector<HTMLElement>('.cell-icon, .folder-icon') || element;
  const rect = visual.getBoundingClientRect();
  const ghost = visual.cloneNode(true) as HTMLElement;
  const original = element.closest<HTMLElement>('.grid-stack-item') || element;
  ghost.removeAttribute('id');
  ghost.classList.add('desktop-transfer-preview');
  ghost.inert = true;
  for (const child of ghost.querySelectorAll<HTMLElement>('*'))
    child.style.setProperty('pointer-events', 'none', 'important');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '2147483002',
    right: 'auto',
    bottom: 'auto',
    boxShadow: 'none',
    outline: 'none',
    border: '0',
    opacity: '0.8',
    display: 'none',
    transform: 'none',
    transition: 'none',
  });
  if (visual !== element) {
    ghost.style.background = 'transparent';
    ghost
      .querySelectorAll<HTMLElement>('img, .workspace-favicon')
      .forEach((child) => {
        Object.assign(child.style, {
          width: '100%',
          height: '100%',
          background: 'transparent',
          objectFit: 'contain',
        });
      });
  }
  session = {
    id,
    source,
    target: source,
    ghost,
    switched: false,
    original,
    originalVisibility: original.style.visibility,
    sourceBounds: element
      .closest('.library-cell-grid')
      ?.getBoundingClientRect(),
  };
  pageDragError.value = '';
}
export function beginFolderDrag(
  id: string,
  source: string,
  element: HTMLElement,
  event: MouseEvent,
) {
  beginPageDrag(id, source, element);
  if (!session) return;
  session.fromFolder = true;
  session.switched = true;
  session.ghost.style.opacity = '1';
  session.ghost.style.display = 'block';
  session.ghost.style.boxShadow = 'none';
  session.ghost.style.border = '0';
  session.ghost.style.outline = 'none';
  document.body.append(session.ghost);
  move(event);
}
export function beginDockDrag(id: string, element: HTMLElement) {
  beginPageDrag(id, '__dock', element);
  if (!session) return;
  session.fromFolder = true;
  session.switched = true;
  session.target =
    document.querySelector<HTMLElement>(
      '[data-library-page-id]:has([aria-current="page"])',
    )?.dataset.libraryPageId ||
    document.querySelector<HTMLElement>('.library-cell-grid')?.dataset.pageId ||
    'home';
}
export function cancelPageDrag() {
  clearTimeout(timer);
  hover = '';
  session?.ghost.remove();
  if (session) session.original.style.visibility = session.originalVisibility;
  session = undefined;
}
function move(event: MouseEvent | DragEvent) {
  if (!session) return;
  point = { x: event.clientX, y: event.clientY };
  if (event.type === 'dragover') event.preventDefault();
  session.ghost.style.left = `${point.x - 30}px`;
  session.ghost.style.top = `${point.y - 30}px`;
  if (!session.switched && session.sourceBounds) {
    const r = session.sourceBounds;
    const outside =
      point.x < r.left ||
      point.x > r.right ||
      point.y < r.top ||
      point.y > r.bottom;
    session.original.style.visibility = outside
      ? 'hidden'
      : session.originalVisibility;
    if (outside) {
      document.body.append(session.ghost);
      session.ghost.style.display = 'block';
      session.ghost.style.opacity = '1';
    } else session.ghost.remove();
  }
  const row = [
    ...document.querySelectorAll<HTMLElement>('[data-library-page-id]'),
  ].find((el) => {
    const r = el.getBoundingClientRect();
    return (
      point.x >= r.left &&
      point.x <= r.right &&
      point.y >= r.top &&
      point.y <= r.bottom
    );
  });
  const id = row?.dataset.libraryPageId || '';
  if (id === hover) return;
  clearTimeout(timer);
  hover = id;
  if (!id || id === session.target) return;
  timer = setTimeout(() => {
    if (!session || hover !== id) return;
    session.target = id;
    session.switched = true;
    document.body.append(session.ghost);
    session.ghost.style.display = 'block';
    // End the old GridStack helper before its page unmounts. This is not a user drop.
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 }),
    );
    navigate?.(id);
  }, 320);
}
async function finish(event: MouseEvent | DragEvent) {
  if (!event.isTrusted || !session) return;
  const transfer = session;
  const dock = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest('.desktop-dock');
  if (dock && transfer.source !== '__dock') {
    cancelPageDrag();
    const item = await database.libraryItems.get(transfer.id);
    if (item?.kind === 'link')
      await database.libraryItems.update(item.id, {
        pageId: '__dock',
        parent: '',
      });
    return;
  }
  if (dock && transfer.source === '__dock') {
    cancelPageDrag();
    return;
  }
  if (!transfer.switched) {
    cancelPageDrag();
    return;
  }
  event.preventDefault();
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const valid = target?.closest(
    '.library-scroll,.library-page-menu,.desktop-library',
  );
  const grid = document.querySelector<HTMLElement & { gridstack?: GridStack }>(
    '.library-cell-grid',
  );
  const rect = grid?.getBoundingClientRect();
  const x = rect
    ? Math.max(
        0,
        Math.floor(
          (event.clientX - rect.left) / (rect.width / DESKTOP_GRID_COLUMNS),
        ),
      )
    : 0;
  const y = rect
    ? Math.max(
        0,
        Math.floor((event.clientY - rect.top) / DESKTOP_GRID_CELL_HEIGHT),
      )
    : 0;
  cancelPageDrag();
  if (!valid || (!transfer.fromFolder && transfer.target === transfer.source))
    return;
  if (
    transfer.fromFolder &&
    (!rect ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
  )
    return;
  try {
    await database.transaction(
      'rw',
      database.libraryItems,
      database.libraryPages,
      async () => {
        if (
          transfer.target !== 'home' &&
          !(await database.libraryPages.get(transfer.target))
        )
          throw new Error('目标页面已被删除');
        const item = await database.libraryItems.get(transfer.id);
        if (!item) return;
        const siblings = await database.libraryItems
          .filter((i) => i.pageId === transfer.target && !i.parent)
          .toArray();
        let dropX = x;
        let dropY = y;
        if (transfer.fromFolder && grid?.gridstack && rect) {
          const live = grid.gridstack;
          const rows = live.opts.maxRow || 8;
          const engine = new BoundedWidgetEngine({
            column: DESKTOP_GRID_COLUMNS,
            maxRow: rows,
            mode: 'float',
          });
          for (const node of live.engine.nodes)
            engine.addNode({
              id: node.id,
              x: node.x,
              y: node.y,
              w: node.w,
              h: node.h,
            });
          const w = Math.min(item.width || 1, DESKTOP_GRID_COLUMNS);
          const h = Math.min(item.height || 1, rows);
          const incoming = { id: item.id, w, h, autoPosition: true };
          if (!engine.willItFit(incoming))
            throw new Error('当前页面没有足够空间');
          const node = engine.addNode(incoming);
          dropX = Math.min(DESKTOP_GRID_COLUMNS - w, x);
          dropY = Math.max(
            0,
            Math.min(
              rows - h,
              Math.floor((event.clientY - rect.top) / (rect.height / rows)),
            ),
          );
          if (
            !engine.moveSelection(
              new Set([item.id]),
              dropX - node.x!,
              dropY - node.y!,
            )
          )
            throw new Error('当前页面没有足够空间');
          for (const placed of engine.nodes)
            if (placed.id !== item.id)
              await database.libraryItems.update(placed.id!, {
                gridX: placed.x,
                gridY: placed.y,
              });
        }
        await database.libraryItems.update(item.id, {
          pageId: transfer.target,
          parent: '',
          gridX: dropX,
          gridY: dropY,
          order: Math.max(-1, ...siblings.map((i) => i.order)) + 1,
        });
        if (item.kind === 'folder')
          await database.libraryItems
            .where('parent')
            .equals(item.id)
            .modify({ pageId: transfer.target });
      },
    );
  } catch (e) {
    pageDragError.value = e instanceof Error ? e.message : '跨页移动失败';
  }
}
function nativeEnd() {
  if (session && !session.switched) cancelPageDrag();
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') cancelPageDrag();
}
export function connectPageDrag(select: (id: string) => void) {
  navigate = select;
  document.addEventListener('mousemove', move, true);
  document.addEventListener('dragover', move, true);
  document.addEventListener('dragend', nativeEnd, true);
  document.addEventListener('mouseup', finish, true);
  document.addEventListener('drop', finish, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancelPageDrag);
  return () => {
    cancelPageDrag();
    navigate = undefined;
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('dragover', move, true);
    document.removeEventListener('dragend', nativeEnd, true);
    document.removeEventListener('mouseup', finish, true);
    document.removeEventListener('drop', finish, true);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancelPageDrag);
  };
}
