import { computed, ref, type Ref } from 'vue';
import { scopedKey } from '../../shared/storage/account';
import type { Memo } from '../../shared/storage/database';

type Point = { x: number; y: number };
type Camera = Point & { scale: number };
const defaultCamera = (): Camera => ({ x: 0, y: 0, scale: 1 });
export const minZoom = 0.25,
  maxZoom = 3;

export function noteBounds(
  notes: ReadonlyArray<Pick<Memo, 'x' | 'y' | 'width' | 'height'>>,
) {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const note of notes) {
    left = Math.min(left, note.x);
    top = Math.min(top, note.y);
    right = Math.max(right, note.x + note.width);
    bottom = Math.max(bottom, note.y + note.height);
  }
  return { left, top, right, bottom };
}

export function useMemoCanvas(
  view: Ref<string>,
  viewport: Ref<HTMLElement | undefined>,
  notes: Readonly<Ref<Memo[]>>,
) {
  const camera = ref(defaultCamera());
  const minimumScale = ref(minZoom);
  const ids = ref(new Set<string>());
  const spaceHeld = ref(false);
  const gesture = ref<{
    pointer: number;
    pan: boolean;
    start: Point;
    current: Point;
    origin: Camera;
    cardId?: string;
    previous: Set<string>;
    additive: boolean;
  }>();
  const key = () => scopedKey('memo-camera:' + view.value);
  function saveCamera() {
    if (view.value !== 'archive')
      localStorage.setItem(
        key(),
        JSON.stringify({ ...camera.value, minimumScale: minimumScale.value }),
      );
  }
  function restoreCamera() {
    camera.value = defaultCamera();
    minimumScale.value = minZoom;
    try {
      const data = JSON.parse(localStorage.getItem(key()) || 'null') as
        (Camera & { minimumScale?: number }) | null;
      if (data && [data.x, data.y, data.scale].every(Number.isFinite)) {
        if (
          data.minimumScale &&
          Number.isFinite(data.minimumScale) &&
          data.minimumScale > 0
        )
          minimumScale.value = Math.min(minZoom, data.minimumScale);
        camera.value = { x: data.x, y: data.y, scale: limitScale(data.scale) };
      }
    } catch {
      /* Use the initial view if the stored preference is invalid. */
    }
  }
  function limitScale(value: number) {
    return Math.min(maxZoom, Math.max(minimumScale.value, value));
  }
  function world(point: Point): Point {
    const { x, y, scale } = camera.value;
    return { x: (point.x - x) / scale, y: (point.y - y) / scale };
  }
  function local(event: Pick<MouseEvent, 'clientX' | 'clientY'>): Point {
    const bounds = viewport.value!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function centerOn(point: Point, commit: boolean) {
    const el = viewport.value;
    if (!el || gesture.value || view.value === 'archive') return;
    const scale = camera.value.scale;
    camera.value = {
      x: el.clientWidth / 2 - point.x * scale,
      y: el.clientHeight / 2 - point.y * scale,
      scale,
    };
    if (commit) saveCamera();
  }
  function zoom(scale: number, anchor?: Point) {
    if (!viewport.value || gesture.value) return;
    scale = limitScale(scale);
    if (scale === camera.value.scale) return;
    const at = anchor ?? {
      x: viewport.value.clientWidth / 2,
      y: viewport.value.clientHeight / 2,
    };
    const point = world(at);
    camera.value = {
      scale,
      x: at.x - point.x * scale,
      y: at.y - point.y * scale,
    };
    saveCamera();
  }
  function fitNotes(overlay: DOMRectReadOnly) {
    const el = viewport.value;
    if (!el || !notes.value.length || gesture.value || view.value === 'archive')
      return;
    const { left, top, right, bottom } = noteBounds(notes.value);
    const contentWidth = right - left,
      contentHeight = bottom - top;
    if (!(contentWidth > 0 && contentHeight > 0)) return;

    const viewportRect = el.getBoundingClientRect();
    const margin = Math.min(16, el.clientWidth / 8, el.clientHeight / 8);
    const width = el.clientWidth - 2 * margin,
      height = el.clientHeight - 2 * margin;
    const fitScale = (w: number, h: number) =>
      Math.min(w / contentWidth, h / contentHeight);
    let availableWidth = width,
      availableHeight = height;
    if (
      overlay.left < viewportRect.right &&
      overlay.top < viewportRect.bottom &&
      overlay.right > viewportRect.left &&
      overlay.bottom > viewportRect.top
    ) {
      // The map sits in the bottom-right corner. Fit the wall above or beside it.
      const above = Math.min(
        height,
        overlay.top - viewportRect.top - 2 * margin,
      );
      const beside = Math.min(
        width,
        overlay.left - viewportRect.left - 2 * margin,
      );
      if (above > 0 && fitScale(width, above) >= fitScale(beside, height))
        availableHeight = above;
      else if (beside > 0) availableWidth = beside;
    }
    const scale = Math.min(1, fitScale(availableWidth, availableHeight));
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    // Distant notes may require zooming out farther than the normal 25% floor.
    minimumScale.value = Math.min(minZoom, scale);
    camera.value = {
      x: margin + availableWidth / 2 - (left + contentWidth / 2) * scale,
      y: margin + availableHeight / 2 - (top + contentHeight / 2) * scale,
      scale,
    };
    saveCamera();
  }
  function revealNote(note: Memo) {
    const el = viewport.value;
    if (!el || gesture.value || view.value === 'archive') return;
    const scale = Math.max(
      minZoom,
      Math.min(
        camera.value.scale < minZoom ? 1 : camera.value.scale,
        (el.clientWidth - 16) / note.width,
        (el.clientHeight - 16) / note.height,
      ),
    );
    camera.value = {
      x: el.clientWidth / 2 - (note.x + note.width / 2) * scale,
      y: el.clientHeight / 2 - (note.y + note.height / 2) * scale,
      scale,
    };
    saveCamera();
  }
  const rectangle = computed(() => {
    const g = gesture.value;
    if (!g || g.pan) return;
    return {
      x: Math.min(g.start.x, g.current.x),
      y: Math.min(g.start.y, g.current.y),
      width: Math.abs(g.start.x - g.current.x),
      height: Math.abs(g.start.y - g.current.y),
    };
  });
  function start(event: PointerEvent) {
    if (
      view.value === 'archive' ||
      gesture.value ||
      !event.isPrimary ||
      ![0, 1].includes(event.button)
    )
      return false;
    const pan = event.button === 1 || spaceHeld.value;
    const target = event.target as Element;
    const card = target.closest<HTMLElement>('[data-memo-id]');
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (card && !pan) {
      if (
        !additive ||
        target.closest(
          'button:not(.memo-distant-card),input,textarea,a[href],.memo-resize',
        )
      )
        return false;
    }
    const point = local(event);
    gesture.value = {
      pointer: event.pointerId,
      pan,
      start: point,
      current: point,
      origin: { ...camera.value },
      cardId: card?.dataset.memoId,
      previous: new Set(ids.value),
      additive,
    };
    if (!pan && !additive) ids.value = new Set();
    event.preventDefault();
    event.stopPropagation();
    viewport.value!.focus({ preventScroll: true });
    viewport.value!.setPointerCapture(event.pointerId);
    return true;
  }
  function move(event: PointerEvent) {
    const g = gesture.value;
    if (!g || event.pointerId !== g.pointer) return;
    g.current = local(event);
    if (g.pan) {
      camera.value = {
        ...g.origin,
        x: g.origin.x + g.current.x - g.start.x,
        y: g.origin.y + g.current.y - g.start.y,
      };
      return;
    }
    const r = rectangle.value!;
    const a = world({ x: r.x, y: r.y }),
      b = world({ x: r.x + r.width, y: r.y + r.height });
    const next = g.additive ? new Set(g.previous) : new Set<string>();
    for (const note of notes.value)
      if (
        note.x < b.x &&
        note.x + note.width > a.x &&
        note.y < b.y &&
        note.y + note.height > a.y
      )
        next.add(note.id);
    ids.value = next;
  }
  function finish(event: PointerEvent) {
    if (gesture.value?.pointer !== event.pointerId) return false;
    move(event);
    const g = gesture.value;
    if (g.pan) {
      if (g.start.x !== g.current.x || g.start.y !== g.current.y) saveCamera();
      else if (event.button === 0 && !spaceHeld.value) ids.value = new Set();
    }
    if (
      !g.pan &&
      g.cardId &&
      Math.hypot(g.current.x - g.start.x, g.current.y - g.start.y) < 3
    ) {
      const next = g.additive ? new Set(g.previous) : new Set<string>();
      if (!g.additive || !next.delete(g.cardId)) next.add(g.cardId);
      ids.value = next;
    }
    gesture.value = undefined;
    return true;
  }
  function cancel() {
    const g = gesture.value;
    if (!g) return;
    camera.value = g.origin;
    ids.value = g.previous;
    gesture.value = undefined;
  }
  restoreCamera();
  return {
    camera,
    minimumScale,
    ids,
    spaceHeld,
    gesture,
    rectangle,
    world,
    local,
    zoom,
    centerOn,
    fitNotes,
    revealNote,
    restoreCamera,
    start,
    move,
    finish,
    cancel,
  };
}
