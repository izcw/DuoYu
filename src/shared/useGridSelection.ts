import { onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import type { GridStack, GridStackNode } from 'gridstack';
import { BoundedWidgetEngine } from './BoundedWidgetEngine';

/** Shared desktop marquee selection and rigid group dragging over the existing grid. */
export function useGridSelection(
  container: Ref<HTMLElement | null>,
  element: Ref<HTMLElement | null>,
  options: {
    getGrid: () => GridStack | null | undefined;
    disabled: () => boolean;
    save: (grid: GridStack) => Promise<void>;
    error: (message: string) => void;
  },
) {
  const selected = ref(new Set<string>());
  const marquee = ref<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();
  const active = ref(false);
  const blocked = ref(false);
  let suppressUntil = 0;
  const pushed = new Set<HTMLElement>();
  function clearPushed() {
    for (const el of pushed) {
      el.style.removeProperty('transform');
      el.classList.remove('grid-selection-pushed');
    }
    pushed.clear();
  }
  let gesture:
    | {
        kind: 'box' | 'move';
        x: number;
        y: number;
        base: Set<string>;
        nodes: GridStackNode[];
        moved: boolean;
        dx: number;
        dy: number;
      }
    | undefined;
  function paint() {
    for (const node of options.getGrid()?.engine.nodes || [])
      node.el?.classList.toggle('grid-selected', selected.value.has(node.id!));
  }
  watch(selected, paint, { flush: 'post' });
  function down(event: MouseEvent) {
    if (event.button !== 0 || options.disabled()) return;
    const rect = element.value?.getBoundingClientRect();
    if (
      !rect ||
      event.clientX < rect.left ||
      event.clientX >= rect.right ||
      event.clientY < rect.top ||
      event.clientY >= rect.bottom
    )
      return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        'input,textarea,select,[contenteditable],.ui-resizable-handle,.cell-resize,.cell-actions,.folder-icon-grid',
      )
    )
      return;
    const tile = target.closest<HTMLElement>('.grid-stack-item');
    const id = tile?.getAttribute('gs-id');
    const extend = event.ctrlKey || event.metaKey || event.shiftKey;
    if (id && extend) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const next = new Set(selected.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selected.value = next;
      suppressUntil = performance.now() + 500;
      return;
    }
    if (id && (!selected.value.has(id) || selected.value.size < 2)) {
      selected.value = new Set([id]);
      return; // Single-card dragging remains owned by GridStack.
    }
    if (!id && target.closest('button,a')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    gesture = {
      kind: id ? 'move' : 'box',
      x: event.clientX,
      y: event.clientY,
      base: extend ? new Set(selected.value) : new Set(),
      nodes: (options.getGrid()?.engine.nodes || []).filter((n) =>
        selected.value.has(n.id!),
      ),
      moved: false,
      dx: 0,
      dy: 0,
    };
    if (!id && !extend) selected.value = new Set();
  }
  function move(event: MouseEvent) {
    if (!gesture) return;
    if (
      !gesture.moved &&
      Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 4
    )
      return;
    gesture.moved = true;
    active.value = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    const grid = options.getGrid();
    if (!grid || !element.value) return;
    if (gesture.kind === 'box') {
      const bounds = container.value!.getBoundingClientRect();
      const x = Math.max(bounds.left, Math.min(event.clientX, bounds.right));
      const y = Math.max(bounds.top, Math.min(event.clientY, bounds.bottom));
      const rect = {
        left: Math.min(x, gesture.x),
        top: Math.min(y, gesture.y),
        width: Math.abs(x - gesture.x),
        height: Math.abs(y - gesture.y),
      };
      marquee.value = rect;
      const next = new Set(gesture.base);
      for (const node of grid.engine.nodes) {
        const r = node.el
          ?.querySelector('.widget-card')
          ?.getBoundingClientRect();
        if (
          r &&
          r.right > rect.left &&
          r.left < rect.left + rect.width &&
          r.bottom > rect.top &&
          r.top < rect.top + rect.height
        )
          next.add(node.id!);
      }
      selected.value = next;
    } else {
      const nodes = gesture.nodes;
      const scale =
        element.value.getBoundingClientRect().width /
          element.value.offsetWidth || 1;
      const cw = grid.cellWidth(),
        ch = grid.getCellHeight(true);
      const minX = Math.min(...nodes.map((n) => n.x!)),
        maxX = Math.max(...nodes.map((n) => n.x! + n.w!));
      const minY = Math.min(...nodes.map((n) => n.y!)),
        maxY = Math.max(...nodes.map((n) => n.y! + n.h!));
      const px = Math.max(
        -minX * cw,
        Math.min(
          (event.clientX - gesture.x) / scale,
          (grid.getColumn() - maxX) * cw,
        ),
      );
      const py = Math.max(
        -minY * ch,
        Math.min(
          (event.clientY - gesture.y) / scale,
          (grid.opts.maxRow! - maxY) * ch,
        ),
      );
      gesture.dx = Math.round(px / cw);
      gesture.dy = Math.round(py / ch);
      const nextPushed = new Set<HTMLElement>();
      blocked.value = !(grid.engine as BoundedWidgetEngine).moveSelection(
        selected.value,
        gesture.dx,
        gesture.dy,
        false,
        (plan) => {
          for (const [node, target] of plan) {
            if (selected.value.has(node.id!) || !node.el) continue;
            const x = (target.x - node.x!) * cw;
            const y = (target.y - node.y!) * ch;
            if (!x && !y) continue;
            node.el.classList.add('grid-selection-pushed');
            node.el.style.setProperty('transform', `translate(${x}px, ${y}px)`);
            nextPushed.add(node.el);
          }
        },
      );
      for (const el of pushed) {
        if (nextPushed.has(el)) continue;
        el.style.removeProperty('transform');
        el.classList.remove('grid-selection-pushed');
      }
      pushed.clear();
      for (const el of nextPushed) pushed.add(el);
      element.value.classList.add('grid-guides-visible');
      for (const n of nodes) {
        n.el?.classList.add('grid-selection-dragging');
        n.el?.classList.toggle('grid-selection-blocked', blocked.value);
        n.el?.style.setProperty(
          'transform',
          'translate(' + px + 'px,' + py + 'px)',
        );
      }
    }
  }
  function clearPreview() {
    clearPushed();
    for (const n of gesture?.nodes || []) {
      n.el?.classList.remove(
        'grid-selection-dragging',
        'grid-selection-blocked',
      );
      n.el?.style.removeProperty('transform');
    }
    element.value?.classList.remove('grid-guides-visible');
    marquee.value = undefined;
    active.value = false;
    blocked.value = false;
  }
  function finish(event?: MouseEvent, cancel = false) {
    if (!gesture) return;
    const current = gesture;
    if (current.moved) {
      event?.preventDefault();
      event?.stopImmediatePropagation();
      suppressUntil = performance.now() + 500;
    }
    // Commit grid coordinates and remove preview transforms in one layout pass,
    // so drop never animates from the cards' old grid coordinates.
    const settling = new Map<HTMLElement, string>();
    if (current.kind === 'move') {
      for (const el of [
        ...pushed,
        ...current.nodes.flatMap((n) => (n.el ? [n.el] : [])),
      ]) {
        settling.set(el, el.style.transition);
        el.style.transition = 'none';
      }
    }
    if (!cancel && current.kind === 'move' && current.moved) {
      const grid = options.getGrid();
      if (
        grid &&
        (grid.engine as BoundedWidgetEngine).moveSelection(
          selected.value,
          current.dx,
          current.dy,
        )
      )
        void options.save(grid);
    }
    if (current.kind === 'move' && current.moved) clear();
    clearPreview();
    gesture = undefined;
    if (settling.size) {
      void element.value?.offsetHeight;
      for (const [el, transition] of settling) {
        if (transition) el.style.transition = transition;
        else el.style.removeProperty('transition');
      }
    }
  }
  const up = (event: MouseEvent) => finish(event);
  const cancel = () => finish(undefined, true);
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      cancel();
      selected.value = new Set();
    }
  }
  function click(event: MouseEvent) {
    if (performance.now() < suppressUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function clear() {
    selected.value = new Set();
    paint();
  }
  function refresh() {
    if (gesture) cancel();
    const ids = new Set(options.getGrid()?.engine.nodes.map((n) => n.id!));
    selected.value = new Set([...selected.value].filter((id) => ids.has(id)));
    paint();
  }
  onMounted(() => {
    container.value?.addEventListener('mousedown', down, true);
    container.value?.addEventListener('click', click, true);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
  });
  onUnmounted(() => {
    cancel();
    container.value?.removeEventListener('mousedown', down, true);
    container.value?.removeEventListener('click', click, true);
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mouseup', up, true);
    document.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
  });
  return { selected, marquee, active, refresh, clear };
}
