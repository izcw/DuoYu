<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { createGlassRenderer, type GlassMode } from '../glass/renderer';
const props = defineProps<{ mode: GlassMode }>();
const canvas = ref<HTMLCanvasElement>();
let renderer: ReturnType<typeof createGlassRenderer> | undefined;
let frame = 0;
let until = 0;
let disposed = false;
let lastSource = '';
let frames = 0;
let resize: ResizeObserver | undefined;
let mutation: MutationObserver | undefined;
let wallpaper: MutationObserver | undefined;
let wallpaperElement: Element | null = null;
function draw() {
  frame = 0;
  if (disposed || document.hidden || !renderer || !lastSource) return;
  try {
    const painted = renderer.render(
      [...document.querySelectorAll<HTMLElement>('[data-liquid-card]')].map(
        (card) =>
          Object.assign(card.getBoundingClientRect(), {
            radius: parseFloat(getComputedStyle(card).borderTopLeftRadius),
          }),
      ),
      props.mode,
    );
    if (painted && canvas.value) {
      // Reveal the GPU surface only after its first wallpaper-backed frame.
      canvas.value.style.visibility = 'visible';
      document.documentElement.classList.add('webgl-glass-ready');
      canvas.value.dataset.frames = String(++frames);
    }
  } catch {
    fallback();
  }
  if (performance.now() < until && renderer)
    frame = requestAnimationFrame(draw);
}
function schedule(duration = 0) {
  until = Math.max(until, performance.now() + duration);
  if (!frame && !document.hidden && renderer && lastSource)
    frame = requestAnimationFrame(draw);
}
function changed() {
  schedule(280);
}
function pointer(event: PointerEvent) {
  if (
    event.buttons === 1 &&
    document.querySelector('.bottom-widget-grid .ui-draggable-dragging')
  )
    schedule(280);
}
function visibility() {
  if (document.hidden) {
    cancelAnimationFrame(frame);
    frame = 0;
    until = 0;
  } else schedule();
}
function imageChanged() {
  const image = document.querySelector<HTMLImageElement>(
    '.wallpaper > img.loaded',
  );
  if (image?.complete && image.naturalWidth && image.src !== lastSource) {
    try {
      if (renderer?.setImage(image)) {
        lastSource = image.src;
        schedule(650);
      }
    } catch {
      fallback();
    }
  }
}
function fallback() {
  document.documentElement.classList.remove('webgl-glass-ready');
  if (canvas.value) canvas.value.style.visibility = 'hidden';
  cancelAnimationFrame(frame);
  frame = 0;
  renderer?.destroy();
  renderer = undefined;
}
function init() {
  if (!canvas.value) return;
  try {
    renderer = createGlassRenderer(canvas.value);
    canvas.value.style.visibility = 'hidden';
    lastSource = '';
    imageChanged();
    schedule();
  } catch {
    fallback();
  }
}
function lost(event: Event) {
  event.preventDefault();
  fallback();
}
watch(
  () => props.mode,
  () => {
    document.documentElement.dataset.glassMode = props.mode;
    schedule();
  },
  { immediate: true },
);
onMounted(() => {
  init();
  resize = new ResizeObserver(changed);
  document
    .querySelectorAll('[data-liquid-card],.bottom-widgets,.start-panel')
    .forEach((el) => resize?.observe(el));
  mutation = new MutationObserver(changed);
  document
    .querySelectorAll('.bottom-widget-grid > .grid-stack-item')
    .forEach((el) =>
      mutation?.observe(el, {
        attributes: true,
        attributeFilter: ['style', 'class', 'gs-x', 'gs-y'],
      }),
    );
  wallpaper = new MutationObserver(imageChanged);
  wallpaperElement = document.querySelector('.wallpaper');
  wallpaperElement?.addEventListener('load', imageChanged, true);
  if (wallpaperElement)
    wallpaper.observe(wallpaperElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'class'],
    });
  document.addEventListener('pointermove', pointer, { passive: true });
  document.addEventListener('pointerup', changed);
  document.addEventListener('scroll', changed, true);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', changed);
  canvas.value?.addEventListener('webglcontextlost', lost);
  canvas.value?.addEventListener('webglcontextrestored', init);
});
onUnmounted(() => {
  disposed = true;
  delete document.documentElement.dataset.glassMode;
  cancelAnimationFrame(frame);
  resize?.disconnect();
  mutation?.disconnect();
  wallpaper?.disconnect();
  wallpaperElement?.removeEventListener('load', imageChanged, true);
  document.removeEventListener('pointermove', pointer);
  document.removeEventListener('pointerup', changed);
  document.removeEventListener('scroll', changed, true);
  document.removeEventListener('visibilitychange', visibility);
  window.removeEventListener('resize', changed);
  canvas.value?.removeEventListener('webglcontextlost', lost);
  canvas.value?.removeEventListener('webglcontextrestored', init);
  fallback();
});
</script>
<template>
  <Teleport to="body"
    ><canvas ref="canvas" class="liquid-glass-canvas" aria-hidden="true"
  /></Teleport>
</template>
<style scoped>
.liquid-glass-canvas {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
  visibility: hidden;
}
</style>
