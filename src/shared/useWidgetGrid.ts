import { onMounted, onUnmounted, type Ref } from 'vue';
import { GridStack, type GridItemHTMLElement } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';
import './widget-grid.css';
import { BoundedWidgetEngine } from './BoundedWidgetEngine';

export function useWidgetGrid(
  element: Ref<HTMLElement | null>,
  container: Ref<HTMLElement | null>,
  options: {
    cellWidth: number;
    cellHeight: number;
    margin?: number | string;
    minColumns?: number;
    maxColumns?: () => number;
    resizable?: boolean;
    immediateDrag?: boolean;
    preserveGaps?: boolean;
    mode?: 'float' | 'top' | 'list';
    dragCancel?: string;
    dragHandle?: string;
    onDragMove?: (event: MouseEvent) => boolean | void;
    minResizeArea?: (el: GridItemHTMLElement) => number;
    fitViewport?: boolean;
    fixedGrid?: {
      columns: number;
      rows: number;
      cellWidth?: number;
      cellHeight?: number;
    };
    onDragStart?: (el: GridItemHTMLElement) => void;
    onReady?: (grid: GridStack) => void;
    onStop?: (grid: GridStack) => void;
    onResize?: (grid: GridStack, el: GridItemHTMLElement) => void;
    onResizeProgress?: (grid: GridStack, el: GridItemHTMLElement) => void;
  },
) {
  const CELL_WIDTH = options.cellWidth;
  const HOLD_DELAY = 300;
  let grid: GridStack | null | undefined;
  let observer: ResizeObserver | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let heldItem: HTMLElement | undefined;
  let startX = 0;
  let startY = 0;
  let armed = false;
  let dragging = false;

  let resizeStart:
    | {
        el: GridItemHTMLElement;
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | undefined;
  function constrainResize(event: MouseEvent | TouchEvent) {
    if (!resizeStart || !grid) return;
    const point = 'touches' in event ? event.touches[0] : event;
    if (!point) return;
    const { el, x, y, width, height } = resizeStart;
    const area = options.minResizeArea?.(el) || 1;
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
    const cw = grid.cellWidth(),
      ch = grid.getCellHeight(true);
    let w = Math.max(1, Math.round((width + (point.clientX - x) / scale) / cw));
    let h = Math.max(
      1,
      Math.round((height + (point.clientY - y) / scale) / ch),
    );
    if (w * h < area) {
      if (h > w || (h === w && height > width)) h = Math.ceil(area / w);
      else w = Math.ceil(area / h);
    }
    // Constrain the library's pixel helper before it paints, not only the saved node.
    GridStack.getDD()
      .resizable(el, 'option', 'minWidth', cw * Math.ceil(area / h))
      .resizable(el, 'option', 'minHeight', ch * Math.ceil(area / w));
  }
  function clearHold() {
    clearTimeout(holdTimer);
    heldItem?.classList.remove('hold-pending', 'ui-draggable-armed');
    heldItem = undefined;
    armed = false;
  }
  function mouseDown(event: MouseEvent) {
    // GridStack already implements a 300ms touch hold. Only delay real mouse input;
    // its synthetic touch events and our delayed event must reach the library.
    if (options.immediateDrag || !event.isTrusted || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('.widget-card');
    if (
      !card ||
      target.closest(
        'input,textarea,button:not(.folder-border),a,select,[contenteditable],.ui-resizable-handle',
      )
    )
      return;
    event.stopImmediatePropagation();
    event.preventDefault();
    clearHold();
    const item = card.closest<HTMLElement>('.grid-stack-item')!;
    heldItem = item;
    startX = event.clientX;
    startY = event.clientY;
    item.classList.add('hold-pending');
    holdTimer = setTimeout(() => {
      armed = true;
      item.classList.remove('hold-pending');
      item.classList.add('ui-draggable-armed');
      card.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          clientX: startX,
          clientY: startY,
          view: window,
        }),
      );
    }, HOLD_DELAY);
  }
  function mouseMove(event: MouseEvent) {
    if (dragging) {
      const merge = options.onDragMove?.(event);
      if (grid?.engine instanceof BoundedWidgetEngine)
        grid.engine.setMergeHover(merge === true);
    }
    if (
      heldItem &&
      !armed &&
      Math.hypot(event.clientX - startX, event.clientY - startY) > 8
    )
      clearHold();
  }
  function layout() {
    if (!grid || !container.value || !element.value || dragging) return;
    if (options.fixedGrid) {
      const { columns, rows } = options.fixedGrid;
      const cell =
        options.fixedGrid.cellWidth ??
        Math.max(
          1,
          Math.floor(
            Math.min(
              container.value.clientWidth / columns,
              container.value.clientHeight / rows,
            ),
          ),
        );
      element.value.style.width = `${columns * cell}px`;
      element.value.style.flexShrink = '0';
      element.value.style.setProperty('--grid-guide-columns', String(columns));
      element.value.style.setProperty('--grid-guide-rows', String(rows));
      const height = options.fixedGrid.cellHeight ?? cell;
      grid.cellHeight(height);
      if (options.fitViewport) {
        const scale = Math.min(
          1,
          container.value.clientWidth / (columns * cell),
          container.value.clientHeight / (rows * height),
        );
        const fitted = Math.max(0.01, scale);
        element.value.style.transform = `scale(${fitted})`;
        element.value.style.transformOrigin = 'center center';
        element.value.style.marginBlock = `${-(rows * height * (1 - fitted)) / 2}px`;
      }
      return;
    }
    const columns = Math.max(
      options.minColumns || 1,
      Math.min(
        options.maxColumns?.() ?? 100,
        Math.floor(container.value.clientWidth / CELL_WIDTH),
      ),
    );
    element.value.style.width = `${columns * CELL_WIDTH}px`;
    if (grid.getColumn() !== columns) grid.column(columns, 'move');
  }
  function cancelDrag() {
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, view: window }),
    );
    clearHold();
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') cancelDrag();
  }
  onMounted(() => {
    if (!element.value || !container.value) return;
    // Capture before GridStack sees mousedown, so a quick press cannot move cards.
    element.value.addEventListener('mousedown', mouseDown, true);
    grid = GridStack.init(
      {
        engineClass: options.fixedGrid ? BoundedWidgetEngine : undefined,
        column: options.fixedGrid?.columns || options.minColumns || 3,
        maxRow: options.fixedGrid?.rows,
        minRow: options.fixedGrid?.rows,
        cellHeight: options.cellHeight,
        margin: options.margin ?? 10,
        animate: true,
        mode: options.mode ?? (options.preserveGaps ? 'float' : 'top'),
        disableResize: !options.resizable,
        resizable: { handles: 'se' },
        draggable: {
          handle: options.dragHandle || '.widget-card',
          scroll: !options.fixedGrid,
          cancel:
            options.dragCancel ??
            'input,textarea,button:not(.folder-border),a,select,.cell-link,.cell-resize',
        },
      },
      element.value,
    );
    if (!grid) return;
    grid.on('dragstart', (_event, el) => {
      const node = (el as GridItemHTMLElement).gridstackNode;
      if (node && grid?.engine instanceof BoundedWidgetEngine)
        grid.engine.beginDrag(node);
      dragging = true;
      options.onDragStart?.(el as GridItemHTMLElement);
    });
    grid.on('drag', (event) => {
      const merge = options.onDragMove?.(event as MouseEvent);
      if (grid?.engine instanceof BoundedWidgetEngine)
        grid.engine.setMergeHover(merge === true);
    });
    grid.on('dragstop', (event) => {
      if (grid?.engine instanceof BoundedWidgetEngine) grid.engine.endDrag();
      options.onDragMove?.(event as MouseEvent);
      dragging = false;
      clearHold();
      if (!options.preserveGaps)
        grid?.compact(options.mode === 'list' ? 'list' : 'compact');
      layout();
      options.onStop?.(grid!);
    });
    grid.on('resizestart', (event, element) => {
      const el = element as GridItemHTMLElement;
      const point = event as MouseEvent;
      resizeStart = {
        el,
        x: point.clientX,
        y: point.clientY,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
      constrainResize(point);
    });
    grid.on('resize', (_event, el) => {
      options.onResizeProgress?.(grid!, el as GridItemHTMLElement);
    });
    grid.on('resizestop', (_event, el) => {
      resizeStart = undefined;
      options.onResize?.(grid!, el as GridItemHTMLElement);
      options.onStop?.(grid!);
    });
    layout();
    options.onReady?.(grid);
    observer = new ResizeObserver(layout);
    observer.observe(container.value);
    document.addEventListener('mousemove', constrainResize, true);
    document.addEventListener('touchmove', constrainResize, {
      capture: true,
      passive: true,
    });
    document.addEventListener('mousemove', mouseMove, true);
    document.addEventListener('mouseup', clearHold);
    document.addEventListener('keydown', keyDown);
    window.addEventListener('blur', cancelDrag);
  });
  onUnmounted(() => {
    cancelDrag();
    observer?.disconnect();
    element.value?.removeEventListener('mousedown', mouseDown, true);
    document.removeEventListener('mousemove', constrainResize, true);
    document.removeEventListener('touchmove', constrainResize, true);
    document.removeEventListener('mousemove', mouseMove, true);
    document.removeEventListener('mouseup', clearHold);
    document.removeEventListener('keydown', keyDown);
    window.removeEventListener('blur', cancelDrag);
    grid?.destroy(false);
  });

  return { getGrid: () => grid, layout };
}
