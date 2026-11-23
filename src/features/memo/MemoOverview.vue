<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Fit from '@icon-park/vue-next/es/icons/FullScreen';
import Minus from '@icon-park/vue-next/es/icons/Minus';
import Plus from '@icon-park/vue-next/es/icons/Plus';
import type { Memo } from '../../shared/storage/database';
import { maxZoom, noteBounds } from './useMemoCanvas';

const props = defineProps<{
  viewport?: HTMLElement;
  minimumScale: number;
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
  fit: [overlay: DOMRectReadOnly];
}>();
const overview = ref<HTMLElement>();
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
const extent = computed(() => noteBounds(props.notes));
const bounds = computed(() => {
  const f = frame.value;
  const left = Math.min(f.x, extent.value.left);
  const top = Math.min(f.y, extent.value.top);
  const right = Math.max(f.x + f.width, extent.value.right);
  const bottom = Math.max(f.y + f.height, extent.value.bottom);
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
function wheel(event: WheelEvent) {
  if (drag || !event.deltaY) return;
  const unit =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.value.height : 1;
  emit('zoom', props.camera.scale * Math.exp(-event.deltaY * unit * 0.002));
}
function fit() {
  if (overview.value) emit('fit', overview.value.getBoundingClientRect());
}
const percent = computed(() => props.camera.scale * 100);
const scaleText = computed(() =>
  percent.value < 0.01
    ? '<0.01%'
    : Number(percent.value.toFixed(percent.value < 10 ? 2 : 0)) + '%',
);
</script>
<template>
  <aside
    ref="overview"
    class="memo-overview"
    aria-label="画布导航"
    @wheel.stop.prevent="wheel"
  >
    <svg
      class="memo-map"
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
      <title>点击定位，拖动平移，滚轮缩放</title>
      <rect class="map-frame" v-bind="frame" />
      <g v-memo="[notes, selected]">
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
      </g>
    </svg>
    <div class="memo-zoom-controls">
      <button
        class="memo-control glass-control glass-interactive"
        aria-label="缩小"
        title="缩小"
        :disabled="camera.scale <= minimumScale"
        @click="emit('zoom', camera.scale / 1.2)"
      >
        <Minus size="14" aria-hidden="true" />
      </button>
      <input
        type="range"
        aria-label="画布缩放"
        :min="minimumScale * 100"
        :max="maxZoom * 100"
        :value="percent"
        step="any"
        :aria-valuetext="scaleText"
        @input="
          emit('zoom', ($event.target as HTMLInputElement).valueAsNumber / 100)
        "
      />
      <button
        class="memo-control glass-control glass-interactive"
        aria-label="放大"
        title="放大"
        :disabled="camera.scale >= maxZoom"
        @click="emit('zoom', camera.scale * 1.2)"
      >
        <Plus size="14" aria-hidden="true" />
      </button>
      <output class="memo-scale" aria-label="当前缩放">{{ scaleText }}</output>
    </div>
    <div class="memo-map-actions">
      <button
        class="memo-control glass-control glass-interactive"
        aria-label="恢复到 100%"
        title="恢复到 100%"
        @click="emit('zoom', 1)"
      >
        恢复 100%
      </button>
      <button
        class="memo-control glass-control glass-interactive"
        aria-label="查看全部便签"
        title="查看全部便签"
        :disabled="!notes.length"
        @click="fit"
      >
        <Fit size="14" aria-hidden="true" /> 查看全部
      </button>
    </div>
  </aside>
</template>
<style scoped>
.memo-overview {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: min(190px, calc(100% - 16px));
  padding: 3px;
  color: inherit;
  z-index: 1;
}
.memo-map {
  touch-action: none;
  user-select: none;
  cursor: crosshair;
  display: block;
  width: 100%;
  height: clamp(52px, 9vh, 86px);
  outline: none;
  border: 0;
  box-shadow: none;
}
.memo-map:focus-visible {
  background: var(--glass-interaction-fill);
}
rect[data-color] {
  fill: var(--paper);
  stroke: color-mix(in srgb, currentColor 30%, transparent);
  stroke-width: 0.7;
}
rect.map-selected {
  stroke: currentColor;
  stroke-width: 1.5;
}
.map-frame {
  cursor: grab;
  fill: color-mix(in srgb, currentColor 12%, transparent);
  stroke: none;
}
.memo-map:active,
.memo-map:active .map-frame {
  cursor: grabbing;
}
.memo-zoom-controls,
.memo-map-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 2px;
}
.memo-zoom-controls input {
  flex: 1;
  min-width: 0;
  width: 100%;
  color: inherit;
  accent-color: currentColor;
  cursor: pointer;
}
.memo-map-actions {
  justify-content: flex-end;
}
.memo-map-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding-inline: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.memo-zoom-controls :is(input, button):focus-visible,
.memo-map-actions button:focus-visible {
  outline: 2px solid currentColor !important;
  outline-offset: 1px;
}
.memo-scale {
  min-width: 36px;
  text-align: end;
}
</style>
