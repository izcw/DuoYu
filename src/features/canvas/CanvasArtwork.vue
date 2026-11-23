<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { readInk, sheetView, type Sheet } from './book';
import type { Bounds, Mark } from './drawing';
import type { Shape } from 'konva/lib/Shape';
import CanvasLayer from './CanvasLayer.vue';
import { drawingNode } from './renderer';

const props = defineProps<{
  sheet: Sheet;
  thumbnail?: boolean;
  view?: Bounds;
  pixelWidth?: number;
  pixelHeight?: number;
}>();
const emit = defineEmits<{
  painted: [revision: number];
  error: [message: string];
}>();
const surface = ref<InstanceType<typeof CanvasLayer>>();
const canvas = computed(() => surface.value?.canvas);
defineExpose({ canvas });

const width = computed(() => (props.thumbnail ? 240 : (props.pixelWidth ?? 1)));
const height = computed(() =>
  props.thumbnail ? 150 : (props.pixelHeight ?? 1),
);
const view = computed(() => {
  if (props.view) return props.view;
  const box = sheetView(props.sheet);
  const scale = Math.min(width.value / box.width, height.value / box.height);
  const w = width.value / scale,
    h = height.value / scale;
  return {
    x: box.x + (box.width - w) / 2,
    y: box.y + (box.height - h) / 2,
    width: w,
    height: h,
  };
});
type Entry = NonNullable<
  Awaited<ReturnType<typeof readInk>>
>['entries'][number];
let entries: Entry[] = [],
  branch = -1,
  revision = 0;
let frame = 0,
  generation = 0;
let last:
  | {
      view: Bounds;
      width: number;
      height: number;
      head: number;
      branch: number;
    }
  | undefined;
const images = new Map<Blob, Promise<ImageBitmap>>();
const nodes = new Map<Mark, Shape>();

function imageFor(mark: Extract<Mark, { kind: 'image' }>) {
  let image = images.get(mark.blob);
  if (!image) {
    // A card only needs a thumbnail-sized decode, independent of the source file.
    const scale = 240 / Math.max(mark.width, mark.height);
    image = props.thumbnail
      ? createImageBitmap(mark.blob, {
          resizeWidth: Math.max(1, Math.round(mark.width * scale)),
          resizeHeight: Math.max(1, Math.round(mark.height * scale)),
          resizeQuality: 'high',
        })
      : createImageBitmap(mark.blob);
    images.set(mark.blob, image);
  }
  return image;
}

function releaseImages(keep?: Set<Blob>) {
  for (const [blob, image] of images) {
    if (keep?.has(blob)) continue;
    images.delete(blob);
    void image.then(
      (bitmap) => bitmap.close(),
      () => {},
    );
  }
}

async function draw(ticket: number) {
  const target = canvas.value;
  const layer = surface.value?.layer;
  if (!target || !layer) return;
  const v = view.value,
    w = target.width,
    h = target.height;
  const append =
    last &&
    last.branch === branch &&
    last.head <= entries.length &&
    last.width === w &&
    last.height === h &&
    last.view.x === v.x &&
    last.view.y === v.y &&
    last.view.width === v.width &&
    last.view.height === v.height;
  const visible = entries
    .slice(append ? last!.head : 0)
    .filter(
      ({ area }) =>
        area.x <= v.x + v.width &&
        area.x + area.width >= v.x &&
        area.y <= v.y + v.height &&
        area.y + area.height >= v.y,
    );
  if (!append) {
    const keepMarks = new Set(visible.map(({ mark }) => mark));
    for (const [mark, node] of nodes) {
      if (keepMarks.has(mark)) continue;
      node.destroy();
      nodes.delete(mark);
    }
    const keep = new Set<Blob>();
    for (const { mark } of visible)
      if (mark.kind === 'image') keep.add(mark.blob);
    releaseImages(keep);
  }
  const bitmaps = new Map<Blob, ImageBitmap>();
  try {
    for (const { mark } of visible) {
      if (mark.kind !== 'image') continue;
      const bitmap = await imageFor(mark);
      if (ticket !== generation) return;
      bitmaps.set(mark.blob, bitmap);
    }
    const ctx = layer.getContext();
    if (!append) ctx.clearRect(0, 0, w, h);
    ctx.save();
    try {
      const sx = w / v.width,
        sy = h / v.height;
      ctx.setTransform(sx, 0, 0, sy, -v.x * sx, -v.y * sy);
      for (const { mark } of visible) {
        let node = nodes.get(mark);
        if (!node) {
          node = drawingNode(
            mark,
            mark.kind === 'image' ? bitmaps.get(mark.blob) : undefined,
          );
          if (!node) continue;
          nodes.set(mark, node);
        }
        node.drawScene(layer.getCanvas());
      }
    } finally {
      ctx.restore();
    }
    last = { view: v, width: w, height: h, head: entries.length, branch };
    emit('painted', revision);
  } catch {
    if (ticket === generation)
      emit('error', '画布内容绘制失败，请重新打开画布页');
  }
}

function scheduleDraw() {
  generation++;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    void draw(generation);
  });
}

// The camera only repaints cached commands. Database reads follow document edits.
watch(
  () => props.sheet.revision,
  async (next, _, cleanup) => {
    if (!next) {
      scheduleDraw();
      return;
    }
    let stale = false;
    cleanup(() => {
      stale = true;
    });
    try {
      const scene = await readInk(props.sheet.id, branch, entries.length);
      if (stale || !scene) return;
      if (scene.append) {
        for (const entry of scene.entries) entries.push(entry);
      } else {
        entries = scene.entries;
        last = undefined;
      }
      branch = scene.sheet.branch;
      revision = scene.sheet.revision;
      scheduleDraw();
    } catch {
      if (!stale) emit('error', '画布内容读取失败，请重新打开画布页');
    }
  },
  { immediate: true },
);
watch([canvas, view, width, height], scheduleDraw, { flush: 'post' });
onBeforeUnmount(() => {
  generation++;
  cancelAnimationFrame(frame);
  for (const node of nodes.values()) node.destroy();
  releaseImages();
});
</script>
<template>
  <CanvasLayer
    ref="surface"
    :width="width"
    :height="height"
    :style="{ '--drawing-paper': thumbnail ? sheet.paper : undefined }"
  />
</template>
