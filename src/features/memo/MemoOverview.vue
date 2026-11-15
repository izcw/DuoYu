<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Memo } from '../../shared/storage/database';
import { minZoom, maxZoom } from './useMemoCanvas';

const props = defineProps<{
  viewport?: HTMLElement;
  camera: { x: number; y: number; scale: number };
  notes: Pick<
    Memo,
    'id' | 'color' | 'x' | 'y' | 'width' | 'height' | 'layer'
  >[];
  selected: Set<string>;
}>();
type Point = { x: number; y: number };
const emit = defineEmits<{
  zoom: [value: number];
  navigate: [center: Point, commit: boolean];
}>();
const size = ref({ width: 1, height: 1 });
watch(
  () => props.viewport,
  (el, _, cleanup) => {
    if (!el) return;
    const measure = () => {
      size.value = { width: el.clientWidth, height: el.clientHeight };
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(el);
    cleanup(() => observer.disconnect());
  },
  { immediate: true },
);
const frame = computed(() => {
  const { x, y, scale } = props.camera;
  return {
    x: -x / scale,
    y: -y / scale,
    width: size.value.width / scale,
    height: size.value.height / scale,
  };
});
const bounds = computed(() => {
  const f = frame.value;
  let left = f.x,
    top = f.y,
    right = f.x + f.width,
    bottom = f.y + f.height;
  for (const n of props.notes) {
    left = Math.min(left, n.x);
    top = Math.min(top, n.y);
    right = Math.max(right, n.x + n.width);
    bottom = Math.max(bottom, n.y + n.height);
  }
  const pad = Math.max(1, Math.max(right - left, bottom - top) * 0.05);
  return [
    left - pad,
    top - pad,
    right - left + 2 * pad,
    bottom - top + 2 * pad,
  ].join(' ');
});
// Keep the world-to-map projection fixed while the viewport itself is moving.
const frozenBounds = ref('');
let drag:
  | {
      pointer: number;
      inverse: DOMMatrix;
      start: Point;
      origin: Point;
      inside: boolean;
      moved: boolean;
    }
  | undefined;
function pointAt(event: PointerEvent, inverse: DOMMatrix) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
}
function press(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || drag) return;
  const svg = event.currentTarget as SVGSVGElement;
  const inverse = svg.getScreenCTM()?.inverse();
  if (!inverse) return;
  const point = pointAt(event, inverse);
  const f = frame.value;
  const inside =
    point.x >= f.x &&
    point.x <= f.x + f.width &&
    point.y >= f.y &&
    point.y <= f.y + f.height;
  frozenBounds.value = bounds.value;
  drag = {
    pointer: event.pointerId,
    inverse,
    start: point,
    origin: { x: f.x + f.width / 2, y: f.y + f.height / 2 },
    inside,
    moved: false,
  };
  svg.setPointerCapture(event.pointerId);
  if (!inside) emit('navigate', point, false);
}
function track(event: PointerEvent, commit: boolean) {
  if (!drag || event.pointerId !== drag.pointer) return;
  const p = pointAt(event, drag.inverse);
  const dx = p.x - drag.start.x,
    dy = p.y - drag.start.y;
  // A click centers its location; a drag keeps the grab point under the pointer.
  if (Math.hypot(dx, dy) > 3 * Math.hypot(drag.inverse.a, drag.inverse.b))
    drag.moved = true;
  if (drag.moved || commit || !drag.inside)
    emit(
      'navigate',
      drag.inside && drag.moved
        ? { x: drag.origin.x + dx, y: drag.origin.y + dy }
        : p,
      commit,
    );
  if (commit) {
    drag = undefined;
    frozenBounds.value = '';
  }
}
function cancel(event: PointerEvent) {
  if (drag?.pointer !== event.pointerId) return;
  emit('navigate', drag.origin, false);
  drag = undefined;
  frozenBounds.value = '';
}
function keyPan(event: KeyboardEvent) {
  const f = frame.value;
  const step: Record<string, Point> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  };
  const dir = step[event.key];
  if (!dir || drag) return;
  event.preventDefault();
  event.stopPropagation();
  emit(
    'navigate',
    {
      x: f.x + f.width * (0.5 + dir.x / 4),
      y: f.y + f.height * (0.5 + dir.y / 4),
    },
    true,
  );
}
const percent = computed(() => Math.round(props.camera.scale * 100));
</script>
<template>
  <aside class="memo-overview glass-surface" aria-label="画布导航">
    <svg
      role="group"
      aria-label="便签缩略地图"
      tabindex="0"
      :viewBox="frozenBounds || bounds"
      @pointerdown="press"
      @pointermove="track($event, false)"
      @pointerup="track($event, true)"
      @pointercancel="cancel"
      @lostpointercapture="cancel"
      @keydown="keyPan"
    >
      <title>点击定位，拖动视野框移动画布</title>
      <rect
        v-for="note in notes"
        :key="note.id"
        :data-color="note.color"
        :class="{ 'map-selected': selected.has(note.id) }"
        :x="note.x"
        :y="note.y"
        :width="note.width"
        :height="note.height"
        rx="5"
        vector-effect="non-scaling-stroke"
      />
      <rect
        class="map-frame"
        v-bind="frame"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div class="memo-zoom-controls">
      <button
        class="memo-control"
        aria-label="缩小"
        @click="emit('zoom', camera.scale / 1.2)"
      >
        −
      </button>
      <input
        type="range"
        aria-label="画布缩放"
        :min="minZoom * 100"
        :max="maxZoom * 100"
        :value="percent"
        :aria-valuetext="percent + '%'"
        @input="
          emit('zoom', ($event.target as HTMLInputElement).valueAsNumber / 100)
        "
      />
      <button
        class="memo-control"
        aria-label="放大"
        @click="emit('zoom', camera.scale * 1.2)"
      >
        ＋
      </button>
      <button
        class="memo-control memo-scale"
        aria-label="恢复原始缩放"
        title="恢复原始缩放"
        @click="emit('zoom', 1)"
      >
        {{ percent }}%
      </button>
    </div>
  </aside>
</template>
<style scoped>
.memo-overview {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: min(190px, 65%);
  padding: 8px;
  border-radius: 14px;
  color: var(--theme-text);
  background-color: var(--theme-panel);
  z-index: 1;
}
svg {
  touch-action: none;
  user-select: none;
  cursor: crosshair;
  display: block;
  width: 100%;
  height: clamp(52px, 9vh, 86px);
  border-radius: 7px;
  background: var(--theme-hover);
}
rect[data-color] {
  fill: var(--paper);
  stroke: color-mix(in srgb, currentColor 30%, transparent);
  stroke-width: 0.7;
}
rect.map-selected {
  stroke: #568bba;
  stroke-width: 1.5;
}
.map-frame {
  cursor: grab;
  fill: #568bba12;
  stroke: #568bba;
  stroke-width: 1.4;
}
svg:active,
svg:active .map-frame {
  cursor: grabbing;
}
.memo-zoom-controls {
  display: flex;
  align-items: center;
  margin-top: 4px;
}
.memo-zoom-controls input {
  flex: 1;
  min-width: 0;
  width: 100%;
  accent-color: #5285ad;
  cursor: pointer;
}
.memo-zoom-controls button {
  min-width: 22px;
}
.memo-scale {
  width: 40px;
}
</style>
