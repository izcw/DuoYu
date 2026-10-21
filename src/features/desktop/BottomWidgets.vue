<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';
import LiquidGlassLayer from './components/LiquidGlassLayer.vue';
import type { GlassMode } from './glass/renderer';
import { initialGlassModeKey } from './glass/preferences';
import WidgetLinks from './components/WidgetLinks.vue';
import { useWidgetLinks } from './useWidgetLinks';

const container = useTemplateRef<HTMLElement>('container');
const element = useTemplateRef<HTMLDivElement>('widgetGrid');
const { cards, ready, linkDrag, notice, startLinkDrag } = useWidgetLinks();
const glassMode = ref<GlassMode>(inject(initialGlassModeKey, 'real'));
const glassModes = [
  { id: 'real', label: '真实' },
  { id: 'natural', label: '自然' },
  { id: 'soft', label: '柔和' },
] as const;
let modeQueue = Promise.resolve();
function setGlassMode(mode: GlassMode) {
  glassMode.value = mode;
  modeQueue = modeQueue
    .then(() => browser.storage.local.set({ glassMode: mode }))
    .catch(() => {
      notice.value = '玻璃效果保存失败，当前选择仅在本页生效';
    });
}
const CELL_WIDTH = 320;
const HOLD_DELAY = 300;
let grid: GridStack | null | undefined;
let observer: ResizeObserver | undefined;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let heldItem: HTMLElement | undefined;
let startX = 0;
let startY = 0;
let armed = false;
let dragging = false;

function clearHold() {
  clearTimeout(holdTimer);
  heldItem?.classList.remove('hold-pending', 'ui-draggable-armed');
  heldItem = undefined;
  armed = false;
}
function mouseDown(event: MouseEvent) {
  // GridStack already implements a 300ms touch hold. Only delay real mouse input;
  // its synthetic touch events and our delayed event must reach the library.
  if (!event.isTrusted || event.button !== 0) return;
  const target = event.target as HTMLElement;
  const card = target.closest<HTMLElement>('.widget-card');
  if (
    !card ||
    target.closest('input,textarea,button,a,select,[contenteditable]')
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
  if (
    heldItem &&
    !armed &&
    Math.hypot(event.clientX - startX, event.clientY - startY) > 8
  )
    clearHold();
}
function layout() {
  if (!grid || !container.value || !element.value || dragging) return;
  const columns = Math.max(
    1,
    Math.min(
      cards.value.length,
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
      column: 3,
      cellHeight: 180,
      margin: 10,
      animate: true,
      disableResize: true,
      draggable: { handle: '.widget-card', scroll: true },
    },
    element.value,
  );
  if (!grid) return;
  grid.on('dragstart', () => {
    dragging = true;
  });
  grid.on('dragstop', () => {
    dragging = false;
    clearHold();
    grid?.compact();
    layout();
  });
  layout();
  observer = new ResizeObserver(layout);
  observer.observe(container.value);
  document.addEventListener('mousemove', mouseMove, true);
  document.addEventListener('mouseup', clearHold);
  document.addEventListener('keydown', keyDown);
  window.addEventListener('blur', cancelDrag);
});
onUnmounted(() => {
  cancelDrag();
  observer?.disconnect();
  element.value?.removeEventListener('mousedown', mouseDown, true);
  document.removeEventListener('mousemove', mouseMove, true);
  document.removeEventListener('mouseup', clearHold);
  document.removeEventListener('keydown', keyDown);
  window.removeEventListener('blur', cancelDrag);
  grid?.destroy(false);
});
</script>

<template>
  <section
    ref="container"
    class="bottom-widgets"
    aria-label="组件卡片，长按拖动排序"
    :data-glass-mode="glassMode"
  >
    <div
      class="glass-mode-switch glass-surface"
      role="group"
      aria-label="玻璃效果"
    >
      <button
        v-for="mode in glassModes"
        :key="mode.id"
        type="button"
        class="glass-control glass-interactive"
        :aria-pressed="glassMode === mode.id"
        @click="setGlassMode(mode.id)"
      >
        {{ mode.label }}
      </button>
    </div>
    <LiquidGlassLayer :mode="glassMode" />
    <div
      ref="widgetGrid"
      class="grid-stack bottom-widget-grid"
      @contextmenu.prevent
    >
      <div
        v-for="(card, index) in cards"
        :key="card.id"
        class="grid-stack-item"
        :gs-id="card.id"
        :gs-x="index"
        gs-y="0"
        gs-w="1"
        gs-h="1"
        gs-no-resize="true"
      >
        <div
          class="grid-stack-item-content widget-card liquid-glass"
          data-liquid-card
          :aria-label="card.title"
          :aria-busy="!ready"
          title="长按拖动排序"
        >
          <WidgetLinks
            v-if="ready"
            :group-id="card.id"
            :title="card.title"
            :links="card.links"
            :drag-id="linkDrag?.active ? linkDrag.link.id : undefined"
            @drag-start="startLinkDrag"
          />
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="linkDrag?.active"
        class="widget-link-drag-preview glass-surface"
        :data-link-id="linkDrag.link.id"
        :style="{ left: `${linkDrag.x}px`, top: `${linkDrag.y}px` }"
      >
        <img :src="linkDrag.link.icon" alt="" />
      </div>
      <p v-if="notice" class="widget-layout-notice glass-surface" role="status">
        {{ notice }}
      </p>
    </Teleport>
  </section>
</template>

<style scoped>
.glass-mode-switch {
  display: flex;
  width: max-content;
  margin: 0 auto 12px;
  padding: 3px;
  gap: 2px;
  border-radius: 20px;
  border: 0;
}
.glass-mode-switch button {
  padding: 6px 15px;
  border: 0;
  border-radius: 16px;
  color: #fff;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  transition:
    background 160ms ease,
    box-shadow 160ms ease;
}
.widget-link-drag-preview {
  position: fixed;
  z-index: 2147483000;
  pointer-events: none;
  width: 38px;
  height: 38px;
  padding: 6px;
  border-radius: 12px;

  transform: translate(-50%, -50%) scale(1.1);
}
.widget-link-drag-preview img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.widget-layout-notice {
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  border-radius: 8px;
  color: #fff;
  z-index: 2147483001;
}

.bottom-widgets {
  width: 100%;
  max-width: 1500px;
  margin: auto auto 0;
  padding-top: 48px;
  overflow-x: auto;
  overflow-y: hidden;
}
.bottom-widget-grid {
  margin: 0 auto;
}
.bottom-widget-grid .widget-card {
  width: 300px;
  height: 160px;
  overflow: hidden;
  border-radius: 22px;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    background 180ms ease;
}
.hold-pending .widget-card {
  background-color: rgb(255 255 255 / 8%);
}
.ui-draggable-armed .widget-card,
.ui-draggable-dragging .widget-card {
  cursor: grabbing;
  transform: scale(1.025);
}
.bottom-widget-grid :deep(.grid-stack-placeholder > .placeholder-content) {
  border: 1px dashed rgb(255 255 255 / 65%);
  border-radius: 22px;
  background: rgb(255 255 255 / 12%);
}
.bottom-widget-grid.grid-stack-animate
  > .grid-stack-item:not(.ui-draggable-dragging) {
  transition:
    left 220ms ease,
    top 220ms ease;
}
</style>
