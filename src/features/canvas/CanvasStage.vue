<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { requireAccount } from '../auth/edit-access';
import CanvasArtwork from './CanvasArtwork.vue';
import CanvasLayer from './CanvasLayer.vue';
import { drawMark } from './renderer';
import { addMark, sheetView, type Sheet } from './book';
import {
  type Bounds,
  type Mark,
  type PenSettings,
  type Point,
  type StampImage,
  type Tool,
} from './drawing';

const props = defineProps<{
  sheet: Sheet;
  tool: Tool;
  settings: PenSettings;
  image?: StampImage;
  safeArea?: HTMLElement | null;
}>();
const emit = defineEmits<{
  error: [message: string];
  saving: [active: boolean];
  choosePhoto: [place: (image: StampImage) => Promise<void>];
}>();
const viewport = ref<HTMLElement>(),
  paper = ref<HTMLElement>(),
  overlay = ref<InstanceType<typeof CanvasLayer>>();
const artwork = ref<InstanceType<typeof CanvasArtwork>>(),
  field = ref<HTMLTextAreaElement>();
const zoom = ref(1),
  center = shallowRef<Point>({ x: 0, y: 0 }),
  space = ref(false),
  moving = ref(false);
const size = shallowRef({ width: 1, height: 1, density: 1 });
const pixelWidth = computed(() =>
  Math.max(1, Math.round(size.value.width * size.value.density)),
);
const pixelHeight = computed(() =>
  Math.max(1, Math.round(size.value.height * size.value.density)),
);
const view = computed<Bounds>(() => {
  const width = size.value.width / zoom.value;
  const height = size.value.height / zoom.value;
  return {
    x: center.value.x - width / 2,
    y: center.value.y - height / 2,
    width,
    height,
  };
});
let fitted = true,
  disposed = false,
  rendered = -1,
  frame = 0,
  observer: ResizeObserver;
function local(event: { clientX: number; clientY: number }) {
  const r = paper.value!.getBoundingClientRect();
  return {
    x: event.clientX - r.left - r.width / 2,
    y: event.clientY - r.top - r.height / 2,
  };
}
function world(p: Point) {
  return {
    x: center.value.x + p.x / zoom.value,
    y: center.value.y + p.y / zoom.value,
  };
}
function usableFrame() {
  const full = paper.value?.getBoundingClientRect();
  const safe = props.safeArea?.getBoundingClientRect();
  if (full && safe) {
    const left = Math.max(full.left, safe.left);
    const right = Math.min(full.right, safe.right);
    const top = Math.max(full.top, safe.top);
    const bottom = Math.min(full.bottom, safe.bottom);
    if (left < right && top < bottom)
      return {
        width: right - left,
        height: bottom - top,
        anchor: {
          x: (left + right - full.left - full.right) / 2,
          y: (top + bottom - full.top - full.bottom) / 2,
        },
      };
  }
  return {
    width: size.value.width,
    height: size.value.height,
    anchor: { x: 0, y: 0 },
  };
}
function fit() {
  const { width, height, anchor } = usableFrame();
  let focus = { x: 0, y: 0 };
  if (props.sheet.bounds) {
    const bounds = sheetView(props.sheet);
    zoom.value = Math.min(width / bounds.width, height / bounds.height, 1);
    focus = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
  } else {
    zoom.value = 1;
  }
  center.value = {
    x: focus.x - anchor.x / zoom.value,
    y: focus.y - anchor.y / zoom.value,
  };
  fitted = true;
}
function resizeSurface() {
  if (!paper.value) return;
  const { width, height } = paper.value.getBoundingClientRect();
  if (!width || !height) return;
  const density = Math.min(window.devicePixelRatio || 1, 2);
  if (
    width !== size.value.width ||
    height !== size.value.height ||
    density !== size.value.density
  )
    size.value = { width, height, density };
  if (fitted) fit();
}
const minZoom = 0.001,
  maxZoom = 5;
const canZoomOut = computed(() => zoom.value > minZoom);
const canZoomIn = computed(() => zoom.value < maxZoom);
function scaleAt(factor: number, anchor: Point, target = anchor) {
  const next = Math.min(
    maxZoom,
    Math.max(Math.min(zoom.value, minZoom), zoom.value * factor),
  );
  const fixed = world(anchor);
  center.value = { x: fixed.x - target.x / next, y: fixed.y - target.y / next };
  zoom.value = next;
  fitted = false;
}
function zoomIn() {
  if (canZoomIn.value) scaleAt(1.25, usableFrame().anchor);
}
function zoomOut() {
  if (canZoomOut.value) scaleAt(1 / 1.25, usableFrame().anchor);
}
defineExpose({
  zoom,
  canZoomIn,
  canZoomOut,
  zoomIn,
  zoomOut,
  fit,
  preparePhotoPlacement,
});
function wheel(e: WheelEvent) {
  if (pointers.size || textDraft.value) return;
  const delta =
    e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 200 : 1);
  scaleAt(Math.exp(-Math.max(-180, Math.min(180, delta)) * 0.0025), local(e));
}

type Preview = { mark: Mark; source?: HTMLCanvasElement; revision?: number };
let draft: Preview | undefined;
const pending = new Set<Preview>();
const previewVisible = ref(false);
function refresh() {
  if (disposed || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const surface = overlay.value,
      base = artwork.value?.canvas;
    if (!surface || !base) return;
    const { canvas: target, layer } = surface;
    previewVisible.value = !!draft || pending.size > 0;
    if (!previewVisible.value) return;
    const ctx = layer.getContext();
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(base, 0, 0);
    const { x, y, width, height } = view.value;
    ctx.save();
    ctx.scale(target.width / width, target.height / height);
    ctx.translate(-x, -y);
    for (const preview of pending)
      drawMark(layer, preview.mark, preview.source);
    if (draft) drawMark(layer, draft.mark, draft.source);
    ctx.restore();
  });
}
watch([view, pixelWidth, pixelHeight], refresh, { flush: 'post' });
function reconcile(revision: number) {
  rendered = revision;
  for (const item of pending) {
    if (item.revision !== undefined && item.revision <= rendered)
      pending.delete(item);
  }
  refresh();
}
let saving = 0;
async function commit(item: Preview) {
  pending.add(item);
  refresh();
  saving++;
  emit('saving', true);
  try {
    item.revision = await addMark(props.sheet.id, item.mark);
    reconcile(rendered);
  } catch (e) {
    pending.delete(item);
    refresh();
    emit('error', e instanceof Error ? e.message : '画布保存失败');
  } finally {
    emit('saving', --saving > 0);
  }
}
const textDraft = shallowRef<{ at: Point; size: number; color: string }>();
const text = ref('');
const eraserAt = shallowRef<Point>();
const textStyle = computed(() => {
  const draft = textDraft.value;
  if (!draft) return;
  const left = (draft.at.x - view.value.x) * zoom.value;
  const top = (draft.at.y - view.value.y) * zoom.value;
  const fontSize = draft.size * zoom.value;
  return {
    left: left + 'px',
    top: top + 'px',
    fontSize: fontSize + 'px',
    color: draft.color,
    width: Math.max(80, size.value.width - left) + 'px',
    height:
      Math.max(2, text.value.split('\n').length + 1) * fontSize * 1.35 + 'px',
  };
});
function finishText(save = true) {
  const t = textDraft.value;
  textDraft.value = undefined;
  if (t && save && text.value.trim())
    void commit({ mark: { kind: 'text', ...t, text: text.value } });
}
function textKey(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault();
    finishText(e.key !== 'Escape');
    viewport.value?.focus({ preventScroll: true });
  }
}
function photoPreview(image: StampImage, at: Point, size: number): Preview {
  const ratio = size / Math.max(image.source.width, image.source.height);
  return {
    mark: {
      kind: 'image',
      at,
      width: image.source.width * ratio,
      height: image.source.height * ratio,
      blob: image.blob,
    },
    source: image.source,
  };
}
function preparePhotoPlacement(at = world(usableFrame().anchor)) {
  // Clipboard reads and file dialogs can finish after the user pans or switches sheets.
  const size = props.settings.stickerSize;
  const sheetId = props.sheet.id;
  return async (image: StampImage) => {
    const preview = photoPreview(image, at, size);
    if (disposed) {
      await addMark(sheetId, preview.mark);
      return;
    }
    fitted = false;
    await commit(preview);
  };
}
function beginDraw(at: Point) {
  const s = props.settings;
  switch (props.tool) {
    case 'brush':
    case 'eraser':
      draft = {
        mark: {
          kind: 'ink',
          brush: props.tool === 'eraser' ? 'eraser' : s.brush,
          width: props.tool === 'eraser' ? s.eraserWidth : s.width,
          color: s.color,
          points: [at],
        },
      };
      break;
    case 'shape':
    case 'arrow':
      draft = {
        mark: {
          kind: 'shape',
          shape: props.tool === 'arrow' ? 'arrow' : s.shape,
          start: at,
          end: at,
          width: s.width,
          color: s.color,
          filled: s.filled,
        },
      };
      break;
    case 'sticker':
      if (props.image) draft = photoPreview(props.image, at, s.stickerSize);
      break;
    case 'text':
      text.value = '';
      textDraft.value = { at, size: s.textSize, color: s.color };
      void nextTick(() => field.value?.focus({ preventScroll: true }));
      break;
  }
}
function updateDraw(at: Point, shift: boolean) {
  const mark = draft?.mark;
  if (!mark) return;
  if (mark.kind === 'ink') {
    const last = mark.points[mark.points.length - 1]!;
    if (Math.hypot(last.x - at.x, last.y - at.y) * zoom.value >= 0.5)
      mark.points.push(at);
  } else if (mark.kind === 'shape') {
    let dx = at.x - mark.start.x,
      dy = at.y - mark.start.y;
    if (shift) {
      if (mark.shape === 'line' || mark.shape === 'arrow') {
        const angle =
          (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
        const length = Math.hypot(dx, dy);
        dx = length * Math.cos(angle);
        dy = length * Math.sin(angle);
      } else {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        dx = (dx < 0 ? -1 : 1) * side;
        dy = (dy < 0 ? -1 : 1) * side;
      }
    }
    mark.end = { x: mark.start.x + dx, y: mark.start.y + dy };
  } else if (mark.kind === 'image') mark.at = at;
}
const pointers = new Map<number, Point>();
function pair() {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return;
  return {
    at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
  };
}
function down(e: PointerEvent) {
  if ((e.button !== 0 && e.button !== 1) || pointers.size >= 2) return;
  const el = viewport.value!;
  const p = local(e),
    at = world(p);
  if (pointers.size && e.pointerType !== 'touch') return;
  e.preventDefault();
  finishText();
  el.focus({ preventScroll: true });
  const hand = space.value || props.tool === 'hand' || e.button === 1;
  if (!hand && !pointers.size && !requireAccount()) return;
  pointers.set(e.pointerId, p);
  el.setPointerCapture(e.pointerId);
  if (pointers.size === 2) {
    draft = undefined;
    moving.value = true;
  } else if (hand) moving.value = true;
  else {
    fitted = false;
    beginDraw(at);
  }
  refresh();
}
function move(e: PointerEvent) {
  if (props.tool === 'eraser' && e.pointerType !== 'touch') {
    eraserAt.value = local(e);
  }
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const before = pair(),
    p = local(e);
  pointers.set(e.pointerId, p);
  const after = pair();
  if (before && after)
    scaleAt(after.distance / before.distance, before.at, after.at);
  else if (moving.value) {
    fitted = false;
    center.value = {
      x: center.value.x - (p.x - prev.x) / zoom.value,
      y: center.value.y - (p.y - prev.y) / zoom.value,
    };
  } else {
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const sample of samples)
      updateDraw(world(local(sample)), sample.shiftKey);
    updateDraw(world(p), e.shiftKey);
    refresh();
  }
}
function release(e: PointerEvent, save: boolean) {
  if (!pointers.has(e.pointerId)) return;
  if (
    save &&
    !draft &&
    !moving.value &&
    props.tool === 'sticker' &&
    !props.image
  )
    emit('choosePhoto', preparePhotoPlacement(world(local(e))));
  if (draft && save) {
    updateDraw(world(local(e)), e.shiftKey);
    const mark = draft.mark;
    if (
      mark.kind !== 'shape' ||
      Math.hypot(mark.end.x - mark.start.x, mark.end.y - mark.start.y) >= 1
    )
      void commit(draft);
  }
  draft = undefined;
  pointers.delete(e.pointerId);
  if (!pointers.size) moving.value = false;
  if (viewport.value?.hasPointerCapture(e.pointerId))
    viewport.value.releasePointerCapture(e.pointerId);
  refresh();
}
function resetInput() {
  for (const id of pointers.keys())
    if (viewport.value?.hasPointerCapture(id))
      viewport.value.releasePointerCapture(id);
  pointers.clear();
  eraserAt.value = undefined;
  draft = undefined;
  moving.value = space.value = false;
  refresh();
}
watch(
  () => props.tool,
  () => {
    resetInput();
    finishText();
  },
);
function spaceKey(e: KeyboardEvent) {
  if (e.code !== 'Space') return;
  if (e.type === 'keyup') {
    space.value = false;
    return;
  }
  const target = e.target;
  if (
    !(target instanceof HTMLElement) ||
    !target.closest('.workspace-overlay') ||
    target.closest('input, textarea, select, [contenteditable]') ||
    (target.closest('button') && !viewport.value?.matches(':hover'))
  )
    return;
  e.preventDefault();
  space.value = true;
}
onMounted(() => {
  resizeSurface();
  observer = new ResizeObserver(resizeSurface);
  observer.observe(paper.value!);
  if (props.safeArea) observer.observe(props.safeArea);
  window.addEventListener('resize', resizeSurface);
  window.addEventListener('keydown', spaceKey);
  window.addEventListener('keyup', spaceKey);
  window.addEventListener('blur', resetInput);
});
watch(
  () => props.safeArea,
  (next, previous) => {
    if (previous) observer?.unobserve(previous);
    if (next) observer?.observe(next);
    resizeSurface();
  },
  { flush: 'post' },
);
onBeforeUnmount(() => {
  finishText();
  disposed = true;
  observer?.disconnect();
  window.removeEventListener('resize', resizeSurface);
  window.removeEventListener('keydown', spaceKey);
  window.removeEventListener('keyup', spaceKey);
  window.removeEventListener('blur', resetInput);
  cancelAnimationFrame(frame);
});
</script>
<template>
  <div
    ref="viewport"
    class="canvas-viewport"
    tabindex="0"
    aria-label="绘图区域"
    :data-view-x="view.x"
    :data-view-y="view.y"
    :data-view-width="view.width"
    :data-view-height="view.height"
    :data-cursor="
      moving
        ? 'grabbing'
        : space || tool === 'hand'
          ? 'grab'
          : tool === 'text'
            ? 'text'
            : 'crosshair'
    "
    @wheel.stop.prevent="wheel"
    @pointerdown="down"
    @pointermove="move"
    @pointerleave="eraserAt = undefined"
    @pointerup="release($event, true)"
    @pointercancel="release($event, false)"
    @lostpointercapture="release($event, false)"
  >
    <div ref="paper" class="canvas-paper" :style="{ background: sheet.paper }">
      <CanvasArtwork
        ref="artwork"
        :sheet="sheet"
        :view="view"
        :pixel-width="pixelWidth"
        :pixel-height="pixelHeight"
        @painted="reconcile"
        @error="emit('error', $event)"
      />
      <CanvasLayer
        ref="overlay"
        v-show="previewVisible"
        :width="pixelWidth"
        :height="pixelHeight"
        :style="{ '--drawing-paper': sheet.paper }"
      />
      <textarea
        v-if="textDraft"
        ref="field"
        v-model="text"
        aria-label="画布文字"
        placeholder="输入文字"
        wrap="off"
        spellcheck="false"
        class="canvas-text-input"
        :style="textStyle"
        @pointerdown.stop
        @keydown.stop="textKey"
        @blur="finishText()"
      />
      <span
        v-if="tool === 'eraser' && eraserAt && !moving && !space"
        aria-hidden="true"
        class="canvas-eraser-tip"
        :style="{
          left: size.width / 2 + eraserAt.x + 'px',
          top: size.height / 2 + eraserAt.y + 'px',
          width: settings.eraserWidth * zoom + 'px',
          height: settings.eraserWidth * zoom + 'px',
          borderWidth: '1px',
        }"
      />
    </div>
  </div>
</template>
