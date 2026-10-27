<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue';
import { liveQuery } from 'dexie';
import { database, type LibraryItem } from '../../shared/storage/database';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
import { beginDockDrag, cancelPageDrag } from '../library/page-drag';
import { browser } from 'wxt/browser';
import { shortcutActions } from '../shortcuts/actions';
import ReorderTransition from '../../shared/components/base/ReorderTransition.vue';

const props = defineProps<{
  homeActive: boolean;
  workspaceActive: boolean;
  hidden?: boolean;
}>();
const emit = defineEmits<{ home: []; workspace: [] }>();
const defaults = [
  'duoyu-home',
  'duoyu-workspace',
  'duoyu-memo',
  'duoyu-translate',
  'duoyu-canvas',
];
const pinned = ['duoyu-home', 'duoyu-workspace'];
let dragImage: HTMLElement | undefined;
const storageKey = 'duoyu-dock-order';
function readOrder(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved))
      return [
        ...new Set([
          ...saved.filter((id): id is string => typeof id === 'string'),
          ...defaults,
        ]),
      ];
  } catch {
    /* Fall back to the default order if storage is unavailable. */
  }
  return [...defaults];
}
const order = ref(readOrder());
const links = ref<LibraryItem[]>([]);
const subscription = liveQuery(() =>
  database.libraryItems
    .filter((item) => item.pageId === '__dock' && item.kind === 'link')
    .toArray(),
).subscribe((value) => {
  links.value = value;
});
onUnmounted(() => {
  subscription.unsubscribe();
  dragImage?.remove();
});
const items = computed(() =>
  [
    ...new Set([
      ...pinned,
      ...order.value,
      ...links.value.map((item) => item.id),
    ]),
  ].flatMap((id) => {
    if (id === 'duoyu-home')
      return [
        {
          id,
          name: '首页',
          icon:
            !props.homeActive && !props.workspaceActive
              ? '/images/back.png'
              : '/images/home.svg',
          url: undefined as string | undefined,
        },
      ];
    const item =
      shortcutActions.find((item) => item.id === id) ||
      links.value.find((item) => item.id === id);
    return item
      ? [{ id: item.id, name: item.name, icon: item.icon, url: item.url }]
      : [];
  }),
);
const dragged = ref('');
let original: string[] = [];
let slots: { id: string; center: number }[] = [];
let suppressClick = false;
function isActive(id: string) {
  return id === 'duoyu-home'
    ? props.homeActive
    : id === 'duoyu-workspace' && props.workspaceActive;
}
function activate(item: (typeof items.value)[number]) {
  if (suppressClick || dragged.value) return;
  if (item.id === 'duoyu-home') emit('home');
  else if (item.id === 'duoyu-workspace') emit('workspace');
  else if (item.url) void browser.tabs.create({ url: item.url });
}
function start(event: DragEvent, id: string) {
  if (pinned.includes(id)) {
    event.preventDefault();
    return;
  }
  const source = event.currentTarget as HTMLElement;
  const tile = source.querySelector<HTMLElement>('.dock-tile')!;
  const bounds = tile.getBoundingClientRect();
  dragImage?.remove();
  dragImage = tile.cloneNode(true) as HTMLElement;
  dragImage.classList.add('dock-drag-image');
  Object.assign(dragImage.style, {
    position: 'fixed',
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    pointerEvents: 'none',
    zIndex: '2147483647',
    opacity: '1',
    transform: 'none',
    transition: 'none',
    outline: 'none',
    border: '0',
    boxShadow: 'none',
  });
  document.body.append(dragImage);
  event.dataTransfer?.setDragImage(
    dragImage,
    Math.max(0, event.clientX - bounds.left),
    Math.max(0, event.clientY - bounds.top),
  );
  // Keep the snapshot rendered until the browser has captured its drag image.
  requestAnimationFrame(() => {
    if (dragImage) dragImage.style.left = '-1000px';
  });
  source.blur();
  original = items.value.map((item) => item.id);
  if (links.value.some((item) => item.id === id))
    beginDockDrag(id, event.currentTarget as HTMLElement);
  slots = [
    ...(
      event.currentTarget as HTMLElement
    ).parentElement!.querySelectorAll<HTMLElement>('.dock-entry'),
  ].map((el) => {
    const bounds = el.getBoundingClientRect();
    return { id: el.dataset.dockId!, center: bounds.left + bounds.width / 2 };
  });
  dragged.value = id;
  suppressClick = true;
  event.dataTransfer?.setData('application/x-duoyu-dock', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function over(event: DragEvent) {
  if (!dragged.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  // Frozen slot positions prevent animated siblings from changing the target.
  const index = slots.filter(
    (slot) => slot.id !== dragged.value && event.clientX > slot.center,
  ).length;
  const next = original.filter((id) => id !== dragged.value);
  next.splice(Math.max(pinned.length, index), 0, dragged.value);
  if (next.some((id, i) => id !== order.value[i])) order.value = next;
}
function finish() {
  dragImage?.remove();
  dragImage = undefined;
  cancelPageDrag();
  if (dragged.value) order.value = original;
  dragged.value = '';
  slots = [];
  setTimeout(() => {
    suppressClick = false;
  }, 0);
}
function drop(event: DragEvent) {
  if (!dragged.value) return;
  over(event);
  try {
    localStorage.setItem(storageKey, JSON.stringify(order.value));
  } catch {
    /* Keep the current session order. */
  }
  dragged.value = '';
  finish();
}
</script>
<template>
  <Teleport to="body">
    <nav
      class="desktop-dock glass-surface"
      :class="{ 'dock-hidden': hidden }"
      :inert="hidden"
      :aria-hidden="hidden"
      aria-label="快捷 Dock"
      @pointerdown.stop
      @mousedown.stop
      @click.stop
      @contextmenu.prevent.stop
      @wheel.stop
      @dragover="over"
      @drop.prevent.stop="drop"
    >
      <ReorderTransition class="dock-items">
        <button
          v-for="(item, index) in items"
          :key="item.id"
          class="dock-entry"
          :class="{
            'dock-divider': index === 2,
            'dock-dragging': dragged === item.id,
          }"
          :data-dock-id="item.id"
          :draggable="!pinned.includes(item.id)"
          :aria-label="item.name"
          :title="item.name"
          :aria-current="isActive(item.id) ? 'page' : undefined"
          @dragstart.stop="start($event, item.id)"
          @dragend="finish"
          @click="activate(item)"
        >
          <span class="dock-tile"
            ><WorkspaceFavicon
              v-if="links.some((link) => link.id === item.id)"
              :src="item.icon"
              :page-url="item.url"
              :title="item.name" /><img
              v-else
              :src="item.icon"
              alt=""
              draggable="false"
          /></span>
          <span class="dock-dot" :class="{ active: isActive(item.id) }" />
        </button>
      </ReorderTransition>
    </nav>
  </Teleport>
</template>
<style scoped>
.desktop-dock {
  position: fixed;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 2147483001;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 4px;
  border-radius: 20px;
  background: rgb(255 255 255 / 24%);
  backdrop-filter: blur(24px) saturate(1.2);
  box-shadow:
    inset 0 0 0 1px #ffffff55,
    0 8px 24px #0002;
}
.desktop-dock {
  transition:
    opacity 260ms ease,
    visibility 0s;
}
.desktop-dock.dock-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 260ms ease,
    visibility 0s 260ms;
}
.dock-items {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dock-dragging {
  opacity: 0;
}
.dock-entry {
  user-select: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  outline: none;
  box-shadow: none;
}
.dock-tile {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: transparent;
  box-shadow: none;
  transition: transform 160ms ease;
}
.dock-tile :deep(.workspace-favicon) {
  background: transparent;
}
.dock-tile :deep(.workspace-favicon img),
.dock-tile img {
  width: 30px;
  height: 30px;
  object-fit: contain;
}
.dock-entry:hover .dock-tile {
  transform: translateY(-5px) scale(1.08);
}
.dock-entry:focus:not(:focus-visible),
.dock-dragging:focus-visible {
  outline: none;
  box-shadow: none;
}
.dock-entry:not(.dock-dragging):focus-visible {
  outline: 2px solid white;
  outline-offset: 3px;
  border-radius: 12px;
}
.dock-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: transparent;
}
.dock-dot.active {
  background: #fff;
}
.dock-divider {
  border-left: 1px solid #ffffff55;
  padding-left: 12px;
  margin-left: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .desktop-dock,
  .desktop-dock.dock-hidden,
  .dock-tile {
    transition: none;
  }
}
</style>
