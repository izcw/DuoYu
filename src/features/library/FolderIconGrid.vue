<script setup lang="ts">
import { beginFolderDrag, folderDragItemId } from './page-drag';
import type { GridItemHTMLElement } from 'gridstack';
import { FOLDER_ICON_SIZE } from './grid-config';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { GridStack } from 'gridstack';
import { useWidgetGrid } from '../../shared/useWidgetGrid';
import { database, type LibraryItem } from '../../shared/storage/database';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
const props = withDefaults(
  defineProps<{
    items: LibraryItem[];
    columns: number;
    rows: number;
    page?: number;
    labels?: boolean;
    disabled?: boolean;
  }>(),
  { page: 0 },
);
const emit = defineEmits<{
  open: [item: LibraryItem];
  error: [message: string];
  escape: [];
  contextmenu: [event: MouseEvent, item: LibraryItem];
}>();
const container = ref<HTMLElement | null>(null);
const element = ref<HTMLElement | null>(null);
const visible = computed(() =>
  props.items.slice(
    props.page * props.columns * props.rows,
    (props.page + 1) * props.columns * props.rows,
  ),
);
let suppressUntil = 0;
let syncing = false;
let moving = false;
let dragged: GridItemHTMLElement | undefined;
let detached = false;
let dragBoundary: DOMRect | undefined;
function sync(grid: GridStack) {
  if (moving) return;
  syncing = true;
  grid.batchUpdate();
  grid.removeAll(false, false);
  grid.opts.maxRow = props.rows;
  grid.opts.minRow = props.rows;
  grid.engine.maxRow = props.rows;
  grid.column(props.columns, 'none');
  for (const [index, item] of visible.value.entries()) {
    const el = [...(element.value?.children || [])].find(
      (el) => (el as HTMLElement).dataset.folderItem === item.id,
    ) as HTMLElement | undefined;
    if (el)
      grid.makeWidget(el, {
        id: item.id,
        x: index % props.columns,
        y: Math.floor(index / props.columns),
        w: 1,
        h: 1,
        noResize: true,
      });
  }
  grid.batchUpdate(false);
  grid.enableMove(!props.disabled);
  syncing = false;
}
async function save(grid: GridStack) {
  if (syncing || props.disabled) return;
  const ids = [...grid.engine.nodes]
    .sort((a, b) => a.y! - b.y! || a.x! - b.x!)
    .map((n) => n.id!);
  try {
    await database.transaction('rw', database.libraryItems, async () => {
      const source = props.items[0];
      if (!source) return;
      const all = (
        await database.libraryItems
          .where('parent')
          .equals(source.parent)
          .sortBy('order')
      ).filter((item) => item.pageId === source.pageId);
      const positions = all
        .map((item, index) => (ids.includes(item.id) ? index : -1))
        .filter((index) => index >= 0);
      if (positions.length !== ids.length)
        throw new Error('文件夹内容已更新，请重新拖拽');
      for (const [index, id] of ids.entries())
        await database.libraryItems.update(id, {
          order: positions[index],
          gridX: undefined,
          gridY: undefined,
          updatedAt: Date.now(),
        });
    });
  } catch {
    emit('error', '文件夹排序保存失败，请重试');
    sync(grid);
  }
}
function trackDrag(event: MouseEvent) {
  if (!moving || detached || !dragged || !dragBoundary) return;
  const r = dragBoundary;
  if (
    event.clientX >= r.left &&
    event.clientX <= r.right &&
    event.clientY >= r.top &&
    event.clientY <= r.bottom
  )
    return;
  const item = props.items.find((i) => i.id === dragged?.gridstackNode?.id);
  const icon = dragged.querySelector<HTMLElement>('.folder-icon');
  if (!item || !icon) return;
  detached = true;
  beginFolderDrag(item.id, item.pageId || 'default', icon, event);
  // End the internal sorter before the popup unmounts; the shared transfer keeps following the pointer.
  document.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, button: 0 }),
  );
  emit('escape');
}
onMounted(() => document.addEventListener('mousemove', trackDrag));
onUnmounted(() => document.removeEventListener('mousemove', trackDrag));
const { getGrid, layout } = useWidgetGrid(element, container, {
  cellWidth: FOLDER_ICON_SIZE,
  cellHeight: 108,
  margin: 0,
  mode: 'list',
  resizable: false,
  immediateDrag: true,
  dragHandle: '.folder-link',
  dragCancel: '',
  fixedGrid: {
    get columns() {
      return props.columns;
    },
    get rows() {
      return props.rows;
    },
    get cellWidth() {
      return Math.max(
        1,
        (container.value?.clientWidth || FOLDER_ICON_SIZE * props.columns) /
          props.columns,
      );
    },
    get cellHeight() {
      return Math.max(
        1,
        (container.value?.clientHeight || 108 * props.rows) / props.rows,
      );
    },
  },
  onReady: sync,
  onDragStart: (el) => {
    dragged = el;
    detached = false;
    dragBoundary = (
      container.value?.closest('.folder-dialog-content') ||
      container.value?.closest('.cell-panel') ||
      container.value
    )?.getBoundingClientRect();
    moving = true;
    suppressUntil = Infinity;
  },
  onStop: (grid) => {
    moving = false;
    suppressUntil = performance.now() + 400;
    if (!detached) void save(grid);
    else sync(grid);
  },
});
watch(
  () => [
    props.columns,
    props.rows,
    props.page,
    props.disabled,
    visible.value.map((item) => item.id).join(','),
  ],
  async () => {
    await nextTick();
    const grid = getGrid();
    if (grid) {
      sync(grid);
      layout();
    }
  },
);
function open(item: LibraryItem) {
  if (performance.now() >= suppressUntil) emit('open', item);
}
</script>
<template>
  <div
    ref="container"
    class="folder-icon-grid"
    :style="{ '--folder-icon-size': FOLDER_ICON_SIZE + 'px' }"
    :class="{ 'with-labels': labels }"
    @mousedown.stop
    @pointerdown.stop
    @dragstart.prevent.stop
  >
    <div
      ref="element"
      class="grid-stack bottom-widget-grid icon-like-grid folder-auto-grid"
    >
      <div
        v-for="item in visible"
        :key="item.id"
        class="grid-stack-item"
        :class="{ 'folder-transfer-source': folderDragItemId === item.id }"
        :data-folder-item="item.id"
      >
        <button
          class="grid-stack-item-content widget-card folder-link glass-interaction-owner"
          :aria-label="'打开收藏 ' + item.name"
          @click.stop="open(item)"
          @contextmenu.prevent.stop="emit('contextmenu', $event, item)"
        >
          <span class="folder-icon cell-icon glass-interaction-target"
            ><WorkspaceFavicon
              :src="item.icon"
              :page-url="item.url"
              :title="item.name"
          /></span>
          <span v-if="labels" class="folder-icon-label">{{ item.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.folder-icon-grid {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  pointer-events: none;
}
.folder-auto-grid > .grid-stack-item {
  pointer-events: auto;
}
.folder-auto-grid > .folder-transfer-source {
  visibility: hidden !important;
  pointer-events: none;
}
.folder-auto-grid {
  width: 100%;
}
.folder-auto-grid > .grid-stack-item > .folder-link {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  border-radius: 16px;
  overflow: hidden;
}
.folder-icon {
  width: min(var(--folder-icon-size), 100%);
  height: auto;
  aspect-ratio: 1;
}
.folder-icon-label {
  font-size: 11px;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}
.folder-auto-grid :deep(.grid-stack-placeholder) {
  visibility: hidden;
}
.folder-auto-grid > .ui-draggable-dragging,
.folder-auto-grid > .ui-draggable-dragging > .folder-link,
.folder-auto-grid > .ui-draggable-dragging .folder-icon {
  box-shadow: none !important;
  border: 0;
  outline: none !important;
}
.folder-auto-grid > .ui-draggable-dragging > .folder-link {
  cursor: grabbing;
}
</style>
