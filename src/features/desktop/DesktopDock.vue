<script setup lang="ts">
import { guestMode } from '../../shared/storage/account';
import { accountStorage, scopedKey } from '../../shared/storage/account';
import { computed, ref, onUnmounted, watch } from 'vue';
import { liveQuery } from 'dexie';
import { database, type LibraryItem } from '../../shared/storage/database';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
import {
  beginDockDrag,
  cancelPageDrag,
  dockIncomingItemId,
  dockInsertBeforeId,
} from '../library/page-drag';
import { openWebTab } from '../../shared/open-web-tab';
import { shortcutActions } from '../shortcuts/actions';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import FolderIconGrid from '../library/FolderIconGrid.vue';
import {
  FOLDER_DIALOG_COLUMNS,
  FOLDER_DIALOG_ROWS,
} from '../library/grid-config';
import { createDragLanding } from '../../shared/drag-landing';
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
const dragPreview = createDragLanding();
const storageKey = 'duoyu-dock-order';
function readOrder(): string[] {
  try {
    const saved: unknown = JSON.parse(
      accountStorage.getItem(storageKey) || '[]',
    );
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
const savingOrder = ref(false);
function cloudOrder() {
  if (dragged.value || savingOrder.value) return;
  order.value = readOrder();
}
window.addEventListener('duoyu-sync-preferences', cloudOrder);
const links = ref<LibraryItem[]>([]);
const subscription = liveQuery(() =>
  database.libraryItems.filter((item) => item.pageId === '__dock').toArray(),
).subscribe((value) => {
  links.value = value;
  if (value.some((item) => item.id === dockIncomingItemId.value))
    dockIncomingItemId.value = '';
});
onUnmounted(() => {
  window.removeEventListener('duoyu-sync-preferences', cloudOrder);
  stopGesture?.();
  subscription.unsubscribe();
  dragPreview.dispose();
});
const items = computed(() =>
  [
    ...new Set([
      ...pinned,
      ...order.value,
      ...links.value.filter((item) => !item.parent).map((item) => item.id),
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
      links.value.find((item) => item.id === id && !item.parent);
    return item
      ? [{ id: item.id, name: item.name, icon: item.icon, url: item.url }]
      : [];
  }),
);
const dockEntries = computed(() => {
  const entries = [...items.value];
  if (
    dockIncomingItemId.value &&
    !entries.some((item) => item.id === dockIncomingItemId.value)
  ) {
    const index = entries.findIndex(
      (item) => item.id === dockInsertBeforeId.value,
    );
    entries.splice(
      index < 0 ? entries.length : Math.max(pinned.length, index),
      0,
      { id: '__dock-incoming', name: '', icon: '', url: undefined },
    );
  }
  entries.splice(pinned.length, 0, {
    id: '__dock-divider',
    name: '',
    icon: '',
    url: undefined,
  });
  return entries;
});
const openedFolder = ref('');
const dockError = ref('');
watch(openedFolder, () => {
  dockError.value = '';
});
const folderPage = ref(0);
const folder = computed(() =>
  links.value.find(
    (item) => item.id === openedFolder.value && item.kind === 'folder',
  ),
);
const children = (id: string) =>
  links.value
    .filter((item) => item.parent === id)
    .sort((a, b) => a.order - b.order);
const folderChildren = computed(() => children(openedFolder.value));
const folderPages = computed(() =>
  Math.max(
    1,
    Math.ceil(
      folderChildren.value.length /
        (FOLDER_DIALOG_COLUMNS * FOLDER_DIALOG_ROWS),
    ),
  ),
);
watch(folderPages, (count) => {
  folderPage.value = Math.min(folderPage.value, count - 1);
});
async function openFolderLink(item: { url?: string }) {
  dockError.value = '';
  if (!item.url) return;
  try {
    await openWebTab(item.url);
  } catch (error) {
    dockError.value = error instanceof Error ? error.message : '无法打开网页';
  }
}
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
  dockError.value = '';
  if (item.id === 'duoyu-home') emit('home');
  else if (item.id === 'duoyu-workspace') emit('workspace');
  else if (
    links.value.some((link) => link.id === item.id && link.kind === 'folder')
  ) {
    openedFolder.value = item.id;
    folderPage.value = 0;
  } else void openFolderLink(item);
}
let stopGesture: (() => void) | undefined;
function press(event: MouseEvent, id: string) {
  if (guestMode || event.button !== 0 || savingOrder.value || pinned.includes(id)) return;
  const source = event.currentTarget as HTMLElement;
  const dock = source.closest('.desktop-dock')!;
  stopGesture?.();
  function move(e: MouseEvent) {
    if (!dragged.value) {
      if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5)
        return;
      start(event, id, source);
    }
    if (dock.contains(document.elementFromPoint(e.clientX, e.clientY))) over(e);
  }
  function release(e: MouseEvent) {
    cleanup();
    if (!dragged.value) return;
    if (dock.contains(document.elementFromPoint(e.clientX, e.clientY)))
      void drop(e);
    else finish();
  }
  function cancel() {
    cleanup();
    if (dragged.value) finish();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') cancel();
  }
  function cleanup() {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', release);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', key);
    stopGesture = undefined;
  }
  stopGesture = cancel;
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', release);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', key);
}
function start(event: MouseEvent, id: string, source: HTMLElement) {
  if (savingOrder.value || pinned.includes(id)) {
    event.preventDefault();
    return;
  }
  const tile = source.querySelector<HTMLElement>('.dock-tile')!;
  const artwork =
    tile.querySelector<HTMLElement>(
      '.dock-folder-preview, .workspace-favicon, img',
    ) ?? tile;
  dragPreview.capture(event, artwork, '', { transparentSurface: true });
  source.blur();
  original = items.value.map((item) => item.id);
  if (links.value.some((item) => item.id === id)) beginDockDrag(id, source);
  slots = [
    ...source.parentElement!.querySelectorAll<HTMLElement>('.dock-entry'),
  ].map((el) => {
    const bounds = el.getBoundingClientRect();
    return { id: el.dataset.dockId!, center: bounds.left + bounds.width / 2 };
  });
  dragged.value = id;
  suppressClick = true;
}
function over(event: MouseEvent) {
  if (!dragged.value) return;
  event.preventDefault();
  // Frozen slot positions prevent animated siblings from changing the target.
  const index = slots.filter(
    (slot) => slot.id !== dragged.value && event.clientX > slot.center,
  ).length;
  const next = original.filter((id) => id !== dragged.value);
  next.splice(Math.max(pinned.length, index), 0, dragged.value);
  if (next.some((id, i) => id !== order.value[i])) order.value = next;
}
function finish() {
  dragPreview.dispose();
  cancelPageDrag();
  if (dragged.value) order.value = original;
  dragged.value = '';
  slots = [];
  setTimeout(() => {
    suppressClick = false;
  }, 0);
}
async function drop(event: MouseEvent) {
  if (!dragged.value || savingOrder.value) return;
  event.preventDefault();
  // Commit the position already shown by dragover, not a second hit test against
  // siblings which may still be animating underneath the pointer.
  const next = [...order.value];
  const previous = [...original];
  savingOrder.value = true;
  dragged.value = '';
  finish();
  try {
    // Persist the sync source before publishing the local projection. An
    // asynchronous preference event used to leave a window for stale resets.
    await database.preferences.put({ id: 'dockOrder', value: next });
    localStorage.setItem(scopedKey(storageKey), JSON.stringify(next));
    order.value = next;
  } catch (error) {
    order.value = previous;
    dockError.value =
      error instanceof Error ? error.message : 'Dock 排序保存失败';
  } finally {
    savingOrder.value = false;
  }
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
      <p v-if="dockError && !folder" role="alert" class="dock-error">
        {{ dockError }}
      </p>
      <ReorderTransition class="dock-items">
        <template v-for="item in dockEntries" :key="item.id">
          <span
            v-if="item.id === '__dock-divider'"
            key="dock-divider"
            class="dock-divider"
            aria-hidden="true"
          />
          <span
            v-else-if="item.id === '__dock-incoming'"
            class="dock-incoming"
            aria-hidden="true"
          />
          <button
            v-else
            :key="item.id"
            class="dock-entry"
            :class="{
              'dock-dragging': dragged === item.id,
            }"
            :data-dock-id="item.id"
            :draggable="false"
            :data-drag-handle="
              (!pinned.includes(item.id) && !savingOrder) || undefined
            "
            :aria-label="item.name"
            :title="item.name"
            :aria-current="isActive(item.id) ? 'page' : undefined"
            @mousedown.left="press($event, item.id)"
            @dragstart.prevent
            @click="activate(item)"
          >
            <span class="dock-tile">
              <span
                v-if="
                  links.some(
                    (link) => link.id === item.id && link.kind === 'folder',
                  )
                "
                class="dock-folder-preview"
              >
                <WorkspaceFavicon
                  v-for="child in children(item.id).slice(0, 9)"
                  :key="child.id"
                  :src="child.icon"
                  :page-url="child.url"
                  :title="child.name"
                />
              </span>
              <WorkspaceFavicon
                v-else-if="links.some((link) => link.id === item.id)"
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
        </template>
      </ReorderTransition>
    </nav>
  </Teleport>
  <BaseDialog
    :open="!!folder"
    folder
    :title="folder?.name || '文件夹'"
    @update:open="openedFolder = ''"
  >
    <div class="dock-folder-content">
      <p v-if="dockError" role="alert">{{ dockError }}</p>
      <FolderIconGrid
        :items="folderChildren"
        :columns="FOLDER_DIALOG_COLUMNS"
        :rows="FOLDER_DIALOG_ROWS"
        :page="Math.min(folderPage, folderPages - 1)"
        labels
        :disabled="false"
        @open="openFolderLink"
        @escape="openedFolder = ''"
      />
    </div>
    <nav
      v-if="folderPages > 1"
      class="dock-folder-pages"
      aria-label="文件夹翻页"
    >
      <button
        v-for="n in folderPages"
        :key="n"
        :aria-pressed="folderPage === n - 1"
        @click="folderPage = n - 1"
      >
        {{ n }}
      </button>
    </nav>
  </BaseDialog>
</template>
<style scoped>
.dock-error {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: min(90vw, 30rem);
  padding: 6px 12px;
  color: white;
  background: rgb(24 25 30 / 90%);
  border-radius: 8px;
  font-size: 13px;
}
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
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
}
.dock-incoming {
  flex: 0 0 46px;
  width: 46px;
  height: 55px;
  pointer-events: none;
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
.dock-folder-preview {
  width: 46px;
  height: 46px;
  box-sizing: border-box;
  padding: 5px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: repeat(3, minmax(0, 1fr));
  gap: 2px;
  border-radius: 10px;
  background: #ffffff30;
  overflow: hidden;
}
.dock-folder-preview :deep(.workspace-favicon),
.dock-folder-preview :deep(.workspace-favicon img) {
  width: 100%;
  height: 100%;
  min-width: 0;
  border-radius: 2px;
}
.dock-folder-content {
  display: grid;
  height: min(480px, calc(100svh - 180px));
}
.dock-folder-pages {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 16px;
}
.dock-folder-pages button {
  background: #ffffff30;
  color: white;
  border: 0;
  border-radius: 8px;
  padding: 4px 10px;
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
  flex: 0 0 1px;
  width: 1px;
  height: 46px;
  align-self: flex-start;
  background: #ffffff55;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .desktop-dock,
  .desktop-dock.dock-hidden,
  .dock-tile {
    transition: none;
  }
}
</style>
