import { computed, ref, type Ref } from 'vue';
import { scopedKey } from '../../shared/storage/account';
import type { Memo } from '../../shared/storage/database';

type Point = { x: number; y: number };
type Camera = Point & { scale: number };
const defaultCamera = (): Camera => ({ x: 0, y: 0, scale: 1 });
export const minZoom = 0.25,
  maxZoom = 3;
const limitScale = (value: number) =>
  Math.min(maxZoom, Math.max(minZoom, value));

export function useMemoCanvas(
  view: Ref<string>,
  viewport: Ref<HTMLElement | undefined>,
  notes: Readonly<Ref<Memo[]>>,
) {
  const camera = ref(defaultCamera());
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
      localStorage.setItem(key(), JSON.stringify(camera.value));
  }
  function restoreCamera() {
    camera.value = defaultCamera();
    try {
      const data = JSON.parse(
        localStorage.getItem(key()) || 'null',
      ) as Camera | null;
      if (data && [data.x, data.y, data.scale].every(Number.isFinite))
        camera.value = { x: data.x, y: data.y, scale: limitScale(data.scale) };
    } catch {
      /* Use the initial view if the stored preference is invalid. */
    }
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
    const at = anchor ?? {
      x: viewport.value.clientWidth / 2,
      y: viewport.value.clientHeight / 2,
    };
    const point = world(at);
    scale = limitScale(scale);
    camera.value = {
      scale,
      x: at.x - point.x * scale,
      y: at.y - point.y * scale,
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
        target.closest('button,input,.memo-resize,.memo-format-bar')
      )
        return false;
      if (target.closest('[contenteditable="true"]:focus')) return false;
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
    ids,
    spaceHeld,
    gesture,
    rectangle,
    world,
    local,
    zoom,
    centerOn,
    restoreCamera,
    start,
    move,
    finish,
    cancel,
  };
}
