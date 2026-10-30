<script setup lang="ts">
import { computed, onUnmounted, ref, watch, nextTick } from 'vue';
import { useGridSelection } from '../../shared/useGridSelection';
import { useWidgetGrid } from '../../shared/useWidgetGrid';
import type { GridStack, GridItemHTMLElement } from 'gridstack';
import type { LibraryItem } from '../../shared/storage/database';
import { database } from '../../shared/storage/database';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import FolderIconGrid from './FolderIconGrid.vue';
import GridItemMenu from './GridItemMenu.vue';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
import { beginPageDrag, pageDragActive } from './page-drag';
import {
  itemMaxColumns,
  itemMaxRows,
  FOLDER_DIALOG_COLUMNS,
  FOLDER_DIALOG_ROWS,
  DESKTOP_ICON_SIZE,
  DESKTOP_GRID_CELL_WIDTH,
  DESKTOP_GRID_CELL_HEIGHT,
  DESKTOP_GRID_COLUMNS,
  LIBRARY_GRID_ROWS,
} from './grid-config';
import { resizeLibraryItem } from './library';
import { normalizeSize, layoutLibraryItems } from './grid-layout';
const props = withDefaults(
  defineProps<{
    automatic?: boolean;
    rows?: number;
    alignment?: 'center' | 'end';
    items: LibraryItem[];
    all: LibraryItem[];
    managing: boolean;
    disabled: boolean;
    preview?: boolean;
  }>(),
  { rows: LIBRARY_GRID_ROWS, alignment: 'center' },
);
const emit = defineEmits<{
  open: [item: LibraryItem];
  edit: [item: LibraryItem];
  remove: [item: LibraryItem];
  drag: [event: DragEvent, item: LibraryItem];
  drop: [item: LibraryItem | undefined, intent: 'sort' | 'merge'];
  error: [message: string];
}>();
const expanded = ref('');
const folderPage = ref(0);
const dragging = ref('');
const target = ref('');
const intent = ref<'sort' | 'merge'>('sort');
const folder = computed(() => props.all.find((i) => i.id === expanded.value));
const children = (id: string) => props.all.filter((i) => i.parent === id);
const expandedLinks = computed(() => children(expanded.value));
const pageCount = computed(() =>
  Math.max(
    1,
    Math.ceil(
      expandedLinks.value.length / (FOLDER_DIALOG_COLUMNS * FOLDER_DIALOG_ROWS),
    ),
  ),
);
const size = (item: LibraryItem) =>
  normalizeSize(
    item.width || (item.kind === 'link' ? 1 : 3),
    Math.min(item.height || 1, props.rows),
    item.kind,
  );
// Keep each icon and caption together; a vertical run meets both outer edges.
function linkOffset(item: LibraryItem) {
  const current = layout.value.items.find((entry) => entry.item.id === item.id);
  if (!current) return 0;
  const column = layout.value.items.filter(
    (entry) =>
      entry.item.kind === 'link' &&
      entry.x === current.x &&
      size(entry.item).width === size(item).width,
  );
  let top = current.y;
  let bottom = current.y + size(item).height;
  let neighbor;
  while (
    (neighbor = column.find(
      (entry) => entry.y + size(entry.item).height === top,
    ))
  )
    top = neighbor.y;
  while ((neighbor = column.find((entry) => entry.y === bottom)))
    bottom += size(neighbor.item).height;
  const own = size(item);
  const travel = bottom - top - own.height;
  const slack = Math.max(
    0,
    own.height * DESKTOP_GRID_CELL_HEIGHT -
      16 -
      20 -
      DESKTOP_ICON_SIZE * Math.min(own.width, own.height),
  );
  return travel ? (slack * (current.y - top)) / travel : 0;
}
const resizePreview = ref<{ id: string; width: number; height: number }>();
// Content follows the live GridStack dimensions; persisted geometry still owns packing.
const displaySize = (item: LibraryItem) =>
  resizePreview.value?.id === item.id ? resizePreview.value : size(item);
// Each collection page owns one bounded grid. Keep overflow records in storage.
const layout = computed(() => layoutLibraryItems(props.items, props.rows));
watch(
  () => layout.value.overflow,
  (count) => {
    if (count)
      emit(
        'error',
        `当前网格已满，${count} 项暂未显示，可通过搜索找到并移至其他收藏页`,
      );
  },
  { immediate: true },
);
const gridElement = ref<HTMLElement | null>(null);
const gridContainer = ref<HTMLElement | null>(null);
// Keep Vue from replacing classes owned by GridStack when guide visibility changes.
watch(
  () =>
    [
      gridElement.value,
      !!dragging.value || !!resizePreview.value || pageDragActive.value,
    ] as const,
  ([element, visible]) =>
    element?.classList.toggle('grid-guides-visible', visible),
  { flush: 'post' },
);
let syncing = false;
function syncGrid(grid: GridStack) {
  syncing = true;
  grid.batchUpdate();
  grid.removeAll(false, false);
  for (const { item, x, y } of layout.value.items) {
    const el = gridElement.value?.querySelector<HTMLElement>(
      `[gs-id="${item.id}"]`,
    );
    if (!el) continue;
    const dimensions = size(item);
    grid.makeWidget(el, {
      id: item.id,
      x,
      y,
      autoPosition: false,
      w: dimensions.width,
      h: dimensions.height,
      minW: 1,
      minH: 1,
      maxW: itemMaxColumns(item.kind),
      maxH: Math.min(props.rows, itemMaxRows(item.kind)),
      noResize: false,
      noMove: false,
    });
  }
  grid.batchUpdate(false);
  grid.mode(props.automatic ? 'top' : 'float');
  grid.enableMove(!props.disabled);
  grid.enableResize(!props.disabled);
  syncing = false;
  selection.refresh();
}
async function saveGrid(grid: GridStack) {
  if (syncing || props.preview || props.disabled) return;
  const nodes = grid.engine.nodes.map((n) => ({
    id: n.id!,
    x: n.x!,
    y: n.y!,
    w: n.w!,
    h: n.h!,
  }));
  try {
    await database.transaction('rw', database.libraryItems, async () => {
      for (const n of nodes)
        await database.libraryItems.update(n.id, {
          gridX: n.x,
          gridY: n.y,
          width: n.w,
          height: n.h,
        });
    });
  } catch {
    emit('error', '布局保存失败，请重试');
  }
}
const itemMenu = ref<{ item: LibraryItem; x: number; y: number }>();
function showItemMenu(event: MouseEvent, item: LibraryItem) {
  if (props.disabled || dragging.value) return;
  itemMenu.value = { item, x: event.clientX, y: event.clientY };
}
async function chooseSize(width: number, height: number) {
  if (itemMenu.value?.item.parent) {
    await resizeLibraryItem(itemMenu.value.item.id, width, height);
    itemMenu.value = undefined;
    return;
  }
  const grid = getGrid();
  const node = grid?.engine.nodes.find((n) => n.id === itemMenu.value?.item.id);
  if (!grid || !node) return;
  if (node.w === width && node.h === height) {
    itemMenu.value = undefined;
    return;
  }
  if (
    (node.x ?? 0) + width > DESKTOP_GRID_COLUMNS ||
    (node.y ?? 0) + height > props.rows ||
    !grid.engine.moveNodeCheck(node, { w: width, h: height, resizing: true })
  ) {
    return;
  }
  itemMenu.value = undefined;
  await saveGrid(grid);
}
watch(
  () => props.items,
  () => {
    itemMenu.value = undefined;
  },
);

function placement(
  point: { x: number; y: number } | undefined,
  width: number,
  height: number,
) {
  const grid = getGrid();
  const rect = gridElement.value?.getBoundingClientRect();
  if (!grid || !rect) throw new Error('网格尚未准备好');
  const inside =
    point &&
    point.x >= rect.left &&
    point.x < rect.right &&
    point.y >= rect.top &&
    point.y < rect.bottom;
  const fits = (x: number, y: number) =>
    x + width <= DESKTOP_GRID_COLUMNS &&
    y + height <= props.rows &&
    grid.engine.nodes.every(
      (n) =>
        x + width <= n.x! ||
        x >= n.x! + n.w! ||
        y + height <= n.y! ||
        y >= n.y! + n.h!,
    );
  let start = inside
    ? Math.min(
        props.rows - height,
        Math.floor((point.y - rect.top) / (rect.height / props.rows)),
      ) *
        DESKTOP_GRID_COLUMNS +
      Math.min(
        DESKTOP_GRID_COLUMNS - width,
        Math.floor((point.x - rect.left) / (rect.width / DESKTOP_GRID_COLUMNS)),
      )
    : Math.max(
        -1,
        ...grid.engine.nodes.map(
          (n) => (n.y! + n.h! - 1) * DESKTOP_GRID_COLUMNS + n.x! + n.w! - 1,
        ),
      ) + 1;
  const slots = Array.from(
    { length: DESKTOP_GRID_COLUMNS * props.rows },
    (_, i) => i,
  );
  if (inside)
    slots.sort(
      (a, b) =>
        Math.abs((a % DESKTOP_GRID_COLUMNS) - (start % DESKTOP_GRID_COLUMNS)) +
        Math.abs(
          Math.floor(a / DESKTOP_GRID_COLUMNS) -
            Math.floor(start / DESKTOP_GRID_COLUMNS),
        ) -
        Math.abs((b % DESKTOP_GRID_COLUMNS) - (start % DESKTOP_GRID_COLUMNS)) -
        Math.abs(
          Math.floor(b / DESKTOP_GRID_COLUMNS) -
            Math.floor(start / DESKTOP_GRID_COLUMNS),
        ),
    );
  const slot = slots.find(
    (i) =>
      (inside || i >= start) &&
      fits(i % DESKTOP_GRID_COLUMNS, Math.floor(i / DESKTOP_GRID_COLUMNS)),
  );
  if (slot == null)
    throw new Error('当前页面没有足够的空位，请调整布局或切换页面');
  return {
    gridX: slot % DESKTOP_GRID_COLUMNS,
    gridY: Math.floor(slot / DESKTOP_GRID_COLUMNS),
    width,
    height,
  };
}
defineExpose({ placement });
watch(
  () => props.automatic,
  (automatic) => {
    const grid = getGrid();
    if (!grid) return;
    grid.mode(automatic ? 'top' : 'float');
    if (automatic) grid.compact();
    void saveGrid(grid);
  },
);
const renamingFolder = ref(false);
const folderName = ref('');
function focusFolderTitle() {
  void nextTick(() =>
    document.querySelector<HTMLInputElement>('.folder-dialog input')?.focus(),
  );
}
async function renameFolder() {
  const name = folderName.value.trim().slice(0, 80);
  if (!folder.value || !name) return;
  try {
    await database.libraryItems.update(folder.value.id, {
      name,
      updatedAt: Date.now(),
    });
    renamingFolder.value = false;
  } catch {
    emit('error', '文件夹名称保存失败');
  }
}
let lastFolderWheel = 0;
function wheelFolder(event: WheelEvent) {
  if (!event.deltaY || performance.now() - lastFolderWheel < 300) return;
  lastFolderWheel = performance.now();
  folderPage.value = Math.max(
    0,
    Math.min(
      pageCount.value - 1,
      folderPage.value + (event.deltaY > 0 ? 1 : -1),
    ),
  );
}
watch(expanded, () => {
  renamingFolder.value = false;
});
let mergeCandidate: LibraryItem | undefined;
let previousDragPoint: { x: number; y: number } | undefined;
const folderEntries = new Map<string, boolean>();
function folderEntry(id: string, rect: DOMRect, x: number, y: number) {
  if (!folderEntries.has(id)) {
    const p = previousDragPoint;
    const vertical =
      p && (p.y < rect.top || p.y > rect.bottom)
        ? true
        : p && (p.x < rect.left || p.x > rect.right)
          ? false
          : Math.abs((y - rect.top) / rect.height - 0.5) >=
            Math.abs((x - rect.left) / rect.width - 0.5);
    folderEntries.set(id, vertical);
  }
  return folderEntries.get(id);
}
let dragBounds: { item: LibraryItem; rect: DOMRect }[] = [];
function captureDragBounds() {
  dragBounds = props.items.flatMap((entry) => {
    const tile = gridElement.value?.querySelector<HTMLElement>(
      `[gs-id="${entry.id}"]`,
    );
    return tile ? [{ item: entry, rect: tile.getBoundingClientRect() }] : [];
  });
}
let suppressClickUntil = 0;
function openItem(item: LibraryItem) {
  if (performance.now() < suppressClickUntil) return;
  emit('open', item);
}
const { getGrid } = useWidgetGrid(gridElement, gridContainer, {
  fixedGrid: {
    columns: DESKTOP_GRID_COLUMNS,
    rows: props.rows,
    cellWidth: DESKTOP_GRID_CELL_WIDTH,
    cellHeight: DESKTOP_GRID_CELL_HEIGHT,
  },
  minResizeArea: (el) =>
    props.items.find((i) => i.id === el.gridstackNode?.id)?.kind === 'link'
      ? 1
      : 3,
  fitViewport: true,
  cellWidth: DESKTOP_GRID_CELL_WIDTH,
  cellHeight: DESKTOP_GRID_CELL_HEIGHT,
  margin: 8,
  minColumns: 3,
  resizable: true,
  immediateDrag: true,
  preserveGaps: true,
  dragHandle: '.widget-card, .widget-card > .cell-link, .folder-border',
  dragCancel:
    'input,textarea,a,select,.folder-cells,.folder-caption,.cell-actions,.cell-resize,.ui-resizable-handle',
  onDragMove: (event) => {
    const source = props.items.find((i) => i.id === dragging.value);
    mergeCandidate = undefined;
    target.value = '';
    if (source?.kind !== 'link') return;
    const hit = dragBounds.find(
      ({ item, rect }) =>
        item.id !== source.id &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    );
    for (const { item, rect } of dragBounds) {
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        folderEntries.delete(item.id);
    }
    const vertical =
      hit?.item.kind === 'folder' &&
      folderEntry(hit.item.id, hit.rect, event.clientX, event.clientY);
    previousDragPoint = { x: event.clientX, y: event.clientY };
    if (!hit) return;
    if (
      vertical ||
      (hit.item.kind === 'link' &&
        event.clientY > hit.rect.top + hit.rect.height * 0.6 &&
        event.clientX > hit.rect.left + hit.rect.width * 0.25)
    ) {
      mergeCandidate = hit.item;
      target.value = hit.item.id;
      intent.value = 'merge';
      return true;
    }
  },
  onReady: syncGrid,
  onDragStart: (el) => {
    const item = props.items.find((i) => i.id === el.gridstackNode?.id);
    if (item) {
      dragging.value = item.id;
      folderEntries.clear();
      previousDragPoint = undefined;
      mergeCandidate = undefined;
      emit('drag', new DragEvent('dragstart'), item);
      beginPageDrag(
        item.id,
        item.pageId || 'default',
        el.querySelector<HTMLElement>('.widget-card') || el,
      );
    }
  },
  onStop: (grid) => {
    selection.clear();
    if (dragging.value) suppressClickUntil = performance.now() + 400;
    dragging.value = '';
    target.value = '';
    if (mergeCandidate) {
      const destination = mergeCandidate;
      mergeCandidate = undefined;
      emit('drop', destination, 'merge');
      return;
    }
    if (props.automatic) grid.compact();
    void saveGrid(grid).finally(() => {
      resizePreview.value = undefined;
    });
  },
  onResizeProgress: (_grid, el) => {
    const n = el.gridstackNode;
    if (n?.id)
      resizePreview.value = { id: n.id, width: n.w || 1, height: n.h || 1 };
  },
  onResize: (grid, el: GridItemHTMLElement) => {
    const n = el.gridstackNode;
    if (!n) return;
    const dimensions = normalizeSize(
      n.w || 1,
      n.h || 1,
      props.items.find((i) => i.id === n.id)?.kind,
    );
    grid.update(el, { w: dimensions.width, h: dimensions.height });
  },
});
const selection = useGridSelection(gridContainer, gridElement, {
  getGrid,
  disabled: () => props.disabled || !!expanded.value || !!itemMenu.value,
  save: saveGrid,
  error: (message) => emit('error', message),
});
const { marquee } = selection;
watch(
  () =>
    [
      props.disabled,
      ...props.items.map((i) =>
        [i.id, i.order, i.width, i.height, i.gridX, i.gridY].join(':'),
      ),
    ].join('|'),
  async () => {
    await nextTick();
    const grid = getGrid();
    if (grid) syncGrid(grid);
  },
);

function leaveFolder() {
  expanded.value = '';
  suppressClickUntil = performance.now() + 400;
}
function show(item: LibraryItem) {
  if (performance.now() < suppressClickUntil) return;
  expanded.value = item.id;
  folderPage.value = 0;
}
function start(event: DragEvent, item: LibraryItem) {
  if (props.disabled) {
    event.preventDefault();
    return;
  }
  dragging.value = item.id;
  beginPageDrag(
    item.id,
    item.pageId || 'default',
    event.currentTarget as HTMLElement,
  );
  emit('drag', event, item);
}
function over(event: DragEvent, item: LibraryItem) {
  if (!dragging.value || dragging.value === item.id) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const source = props.all.find((i) => i.id === dragging.value);
  intent.value =
    source?.kind === 'link' &&
    ((item.kind === 'folder' &&
      source.parent !== item.id &&
      folderEntry(item.id, rect, event.clientX, event.clientY)) ||
      (item.kind === 'link' &&
        !source.parent &&
        !item.parent &&
        event.clientY > rect.top + rect.height * 0.6 &&
        event.clientX > rect.left + rect.width * 0.25))
      ? 'merge'
      : 'sort';
  target.value = item.id;
}
function drop(item?: LibraryItem) {
  if (!dragging.value) return;
  emit('drop', item, intent.value);
  dragging.value = '';
  target.value = '';
}
async function keyboardResize(event: KeyboardEvent, item: LibraryItem) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return;
  event.preventDefault();
  const s = size(item);
  try {
    await resizeLibraryItem(
      item.id,
      s.width +
        (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0),
      s.height +
        (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0),
    );
  } catch {
    emit('error', '尺寸保存失败');
  }
}
const today = ref(new Date());
const timer = setInterval(() => (today.value = new Date()), 60000);
onUnmounted(() => clearInterval(timer));
const monthDays = computed(() =>
  new Date(today.value.getFullYear(), today.value.getMonth() + 1, 0).getDate(),
);
const monthOffset = computed(
  () =>
    (new Date(today.value.getFullYear(), today.value.getMonth(), 1).getDay() +
      6) %
    7,
);
async function note(event: Event, id: string) {
  if (props.preview || props.disabled) return;
  try {
    await database.libraryItems.update(id, {
      text: (event.target as HTMLTextAreaElement).value,
    });
  } catch {
    emit('error', '便签保存失败');
  }
}
</script>
<template>
  <div
    ref="gridContainer"
    class="library-grid-container"
    :class="{ 'library-preview': preview }"
    :inert="preview || undefined"
    :style="{
      justifyContent: alignment === 'end' ? 'flex-end' : 'center',
      '--desktop-icon-size': DESKTOP_ICON_SIZE + 'px',
    }"
  >
    <div
      ref="gridElement"
      @pointerdown.capture="captureDragBounds"
      class="grid-stack bottom-widget-grid library-cell-grid icon-like-grid grid-guides"
      @dragover.prevent
      @drop.prevent.self="drop()"
      @dragend="
        dragging = '';
        target = '';
      "
    >
      <div class="grid-guide-cells" aria-hidden="true">
        <span v-for="cell in DESKTOP_GRID_COLUMNS * rows" :key="cell" />
      </div>
      <article
        v-for="{ item } in layout.items"
        :key="item.id"
        class="grid-stack-item"
        :data-kind="item.kind"
        :gs-id="item.id"
        :gs-no-move="false"
        :gs-no-resize="false"
        :gs-w="size(item).width"
        :gs-h="size(item).height"
        :data-library-id="item.id"
        :style="
          item.kind === 'link'
            ? {
                '--cell-icon-size': `${DESKTOP_ICON_SIZE * Math.min(size(item).width, size(item).height)}px`,
                '--link-content-offset': `${linkOffset(item)}px`,
              }
            : undefined
        "
        :data-width="size(item).width"
        :data-height="size(item).height"
        draggable="false"
        @contextmenu.prevent.stop="showItemMenu($event, item)"
        @dragover.stop="over($event, item)"
        @drop.prevent.stop="drop(item)"
      >
        <div
          class="grid-stack-item-content widget-card cell-tile"
          :class="{
            'cell-panel glass-surface desktop-card-glass': item.kind !== 'link',
            'is-dragging': dragging === item.id,
            'cell-sort': target === item.id && intent === 'sort',
            'cell-merge': target === item.id && intent === 'merge',
          }"
        >
          <button
            v-if="item.kind === 'link'"
            class="cell-link glass-interaction-owner"
            :aria-label="'打开收藏 ' + item.name"
            @click="openItem(item)"
          >
            <span class="cell-icon glass-interaction-target"
              ><WorkspaceFavicon
                :src="item.icon"
                :page-url="item.url"
                :title="item.name"
            /></span>
          </button>
          <template v-else-if="item.kind === 'folder'">
            <button
              class="folder-border"
              :aria-label="'打开文件夹 ' + item.name"
              @click="show(item)"
            ></button>
            <div
              class="folder-cells"
              :data-columns="displaySize(item).width"
              :data-rows="displaySize(item).height"
              :style="{
                gridTemplateColumns: '1fr',
                gridTemplateRows: '1fr',
              }"
            >
              <FolderIconGrid
                :items="children(item.id)"
                :columns="displaySize(item).width"
                :rows="displaySize(item).height"
                :disabled="disabled"
                @open="emit('open', $event)"
                @error="emit('error', $event)"
              />
            </div>
          </template>
          <div v-else class="cell-widget">
            <template v-if="item.widget === 'calendar'"
              ><header>
                {{ today.getFullYear() }}年{{ today.getMonth() + 1 }}月
              </header>
              <div
                v-if="
                  displaySize(item).width > 1 && displaySize(item).height > 1
                "
                class="calendar"
              >
                <span
                  v-for="day in ['一', '二', '三', '四', '五', '六', '日']"
                  :key="day"
                  >{{ day }}</span
                ><i v-for="blank in monthOffset" :key="'b' + blank"></i
                ><b
                  v-for="day in monthDays"
                  :key="day"
                  :class="{ today: day === today.getDate() }"
                  >{{ day }}</b
                >
              </div>
              <strong v-else>{{ today.getDate() }}</strong></template
            >
            <template v-else-if="item.widget === 'weather'"
              ><strong>☀ 24°</strong><span>晴 · 18°～26°</span
              ><small>示例天气</small></template
            >
            <template v-else
              ><header>{{ item.name }}</header>
              <textarea
                :value="item.text"
                :aria-label="item.name"
                placeholder="记下一点灵感…"
                @pointerdown.stop
                @dragstart.prevent.stop
                @input="note($event, item.id)"
              ></textarea>
            </template>
          </div>
          <div v-if="managing" class="cell-actions">
            <button
              v-if="item.kind === 'link'"
              class="glass-control glass-interactive"
              :aria-label="'编辑 ' + item.name"
              @click="emit('edit', item)"
            >
              编辑</button
            ><button
              class="glass-control glass-interactive"
              :aria-label="'删除 ' + item.name"
              @click="emit('remove', item)"
            >
              删除
            </button>
          </div>
          <button
            v-if="!preview"
            class="cell-resize"
            :aria-label="'调整大小 ' + item.name"
            title="拖动调整大小，也可用方向键"
            @keydown="keyboardResize($event, item)"
            @dragstart.prevent.stop
          ></button>
        </div>
        <component
          :is="item.kind === 'widget' ? 'span' : 'button'"
          class="tile-caption cell-label desktop-icon-caption"
          :class="{ 'folder-caption': item.kind === 'folder' }"
          :title="item.name"
          :aria-label="
            item.kind === 'folder'
              ? '展开 ' + item.name
              : item.kind === 'link'
                ? '打开收藏 ' + item.name
                : undefined
          "
          @click.stop="
            item.kind === 'folder'
              ? show(item)
              : item.kind === 'link'
                ? openItem(item)
                : undefined
          "
          >{{ item.name }}</component
        >
      </article>
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="marquee"
      class="grid-selection-box"
      aria-hidden="true"
      :style="{
        left: marquee.left + 'px',
        top: marquee.top + 'px',
        width: marquee.width + 'px',
        height: marquee.height + 'px',
      }"
    />
  </Teleport>
  <GridItemMenu
    v-if="itemMenu"
    :key="itemMenu.item.id"
    :item="itemMenu.item"
    :max-rows="rows"
    :x="itemMenu.x"
    :y="itemMenu.y"
    @close="itemMenu = undefined"
    @resize="chooseSize"
    @edit="
      emit('edit', itemMenu.item);
      itemMenu = undefined;
    "
    @remove="
      emit('remove', itemMenu.item);
      itemMenu = undefined;
    "
  />
  <BaseDialog
    :open="!!folder"
    folder
    :title="folder?.name || '文件夹'"
    @update:open="expanded = ''"
  >
    <template #title>
      <form v-if="renamingFolder" @submit.prevent="renameFolder">
        <input
          v-model="folderName"
          aria-label="文件夹名称"
          maxlength="80"
          required
          @keydown.esc.stop="renamingFolder = false"
          @blur="renameFolder"
        />
      </form>
      <button
        v-else
        class="folder-title"
        @click="
          renamingFolder = true;
          folderName = folder?.name || '';
          focusFolderTitle();
        "
      >
        {{ folder?.name }}
      </button>
    </template>
    <div class="expanded-folder" @wheel.stop.prevent="wheelFolder">
      <FolderIconGrid
        :items="expandedLinks"
        :columns="FOLDER_DIALOG_COLUMNS"
        :rows="FOLDER_DIALOG_ROWS"
        :page="folderPage"
        labels
        :disabled="disabled"
        @open="openItem"
        @escape="leaveFolder"
        @contextmenu="showItemMenu"
        @error="emit('error', $event)"
      />
    </div>
    <nav v-if="pageCount > 1" class="folder-pages" aria-label="文件夹翻页">
      <button
        v-for="n in pageCount"
        :key="n"
        class="glass-control glass-interactive"
        :aria-pressed="folderPage === n - 1"
        :aria-label="`文件夹第 ${n} 页`"
        @click="folderPage = n - 1"
      >
        <span aria-hidden="true" class="folder-page-dot" />
      </button>
    </nav>
  </BaseDialog>
</template>
<style scoped>
.library-grid-container {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.cell-tile {
  min-width: 0;
  min-height: 0;
  border-radius: 20px;
}
.cell-panel {
  overflow: hidden;
}
.cell-link {
  border: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  height: 100%;
  padding: 6px;
  border-radius: 16px;
  background: transparent;
  color: white;
  font-size: 11px;
  overflow: hidden;
}
.cell-label {
  display: block;
  min-width: 0;
  flex-shrink: 0;
  width: 100%;
  white-space: nowrap;
  text-align: center;
  text-overflow: ellipsis;
  overflow: hidden;
}
.folder-border {
  border: 0;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  cursor: pointer;
  border-radius: inherit;
}
.folder-cells {
  position: absolute;
  inset: 14px;
  inset-block: clamp(0px, calc((100% - 48px) / 2), 14px);
  display: grid;
  gap: 0;
  pointer-events: none;
}
.folder-cells .cell-icon {
  width: min(48px, 100%);
  height: auto;
  aspect-ratio: 1;
}
.folder-cells .cell-link {
  pointer-events: auto;
  padding: 0;
}
/* Captions and drag guides use the same reserved space below the content. */
.library-cell-grid {
  margin-inline: 0;
  --grid-caption-space: 20px;
}
/* Keep every name outside the card, within its allocated grid cell. */
.library-cell-grid > .grid-stack-item > .cell-tile {
  bottom: calc(var(--gs-item-margin-bottom, 8px) + var(--grid-caption-space));
}
.tile-caption {
  border: 0;
  position: absolute;
  bottom: var(--gs-item-margin-bottom, 8px);
  left: var(--gs-item-margin-left, 8px);
  right: var(--gs-item-margin-right, 8px);
  width: auto;
}

.library-cell-grid > [data-kind='link'] > .tile-caption {
  top: calc(
    var(--gs-item-margin-top, 8px) + var(--link-content-offset, 0px) +
      min(
        var(--cell-icon-size),
        100% - var(--gs-item-margin-top, 8px) -
          var(--gs-item-margin-bottom, 8px) - var(--grid-caption-space)
      ) +
      4px
  );
  bottom: auto;
}
.cell-tile > .cell-link {
  padding: var(--link-content-offset, 0px) 0 0;
  justify-content: flex-start;
}

.cell-tile > .cell-link > .cell-icon {
  max-width: 100%;
  max-height: 100%;
}
.cell-resize {
  position: absolute;
  z-index: 5;
  right: 0;
  bottom: 0;
  width: 23px;
  height: 23px;
  background: transparent;
  color: white;
  font-size: 22px !important;
  cursor: nwse-resize;
  touch-action: none;
  pointer-events: none;
}
.cell-resize:focus-visible {
  transform: rotate(90deg);
  background: url('/images/resize-corner.png') center / 16px 16px no-repeat;
}
.cell-sort {
  box-shadow: -5px 0 0 -2px white;
}
.cell-merge::after {
  box-shadow: none !important;
  border: 0 !important;
}
.cell-merge {
  outline: none;
  border-color: transparent !important;
  box-shadow: none !important;
}
.cell-actions {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 6;
  display: flex;
  gap: 3px;
  font-size: 10px;
}
.cell-actions button {
  border-radius: 6px;
  padding: 4px;
}
.cell-widget {
  height: 100%;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
}
.cell-widget header {
  font-size: 12px;
  font-weight: 600;
}
.cell-widget strong {
  font-size: 30px;
  line-height: 1;
}
.cell-widget small {
  font-size: 10px;
  opacity: 0.65;
}
.cell-widget textarea {
  border: 0 !important;
  flex: 1;
  min-height: 0;
  width: 100%;
  resize: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
}
.calendar {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
  font-size: 11px;
  text-align: center;
  overflow: hidden;
}
.calendar b {
  font-weight: 400;
  border-radius: 5px;
}
.calendar .today {
  background: #ffffff44;
}
.expanded-folder {
  display: grid;
  height: min(480px, calc(100svh - 180px));
}
.folder-close {
  margin-top: 12px;
  padding: 6px 12px;
  border-radius: 10px;
}
.folder-pages {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
}
.folder-pages button {
  border-radius: 8px;
  padding: 6px 10px;
}

.folder-title {
  color: inherit;
  background: none;
  border: 0;
  font: inherit;
  cursor: text;
}
.folder-dialog input {
  max-width: 100%;
  color: inherit;
  background: rgb(239 239 237 / 12%);
  border: 0;
  border-radius: 8px;
  padding: 8px;
  text-align: center;
}
.folder-pages button {
  width: 20px;
  height: 20px;
  padding: 6px;
  background: transparent;
  border: 0;
}
.folder-page-dot {
  display: block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #efefed;
  opacity: 0.35;
}
.folder-pages button[aria-pressed='true'] .folder-page-dot {
  opacity: 1;
}
</style>
