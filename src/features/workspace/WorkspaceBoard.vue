<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import {
  createCollection,
  updateSavedTab,
  hostname,
  moveSavedTab,
  renameCollection,
  reorderCollection,
} from './collections';
import { useWorkspace, type BrowserTab } from './useWorkspace';
import { createDragLanding } from '../../shared/drag-landing';
import ReorderTransition from '../../shared/components/base/ReorderTransition.vue';
import WorkspaceFavicon from './WorkspaceFavicon.vue';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import type { SavedTab, TabCollection } from '../../shared/storage/database';
import './workspace.css';
import '../../shared/side-menu.css';
import { saveSpace, deleteSpace } from './spaces';

const {
  spaces,
  syncAfterDrop,
  isMarkedSpace,
  activeSpace,
  currentSpace,
  collections,
  visibleCollections,
  visibleTabs,
  windowOptions,
  tabGroups,
  savedCount,
  loading,
  tabsLoading,
  needsTabPermission,
  tabTitle,
  query,
  selectedWindow,
  destination,
  notice,
  error,
  busy,
  undo,
  run,
  save,
  activate,
  toggleBrowserGroup,
  saveBrowserGroup,
  openSaved,
  removeGroup,
  removeTab,
  undoDelete,
} = useWorkspace();
const selectedBrowserTabs = ref(new Set<number>());
const selectedOpenTabs = computed(() =>
  visibleTabs.value.filter(
    (tab) => tab.id !== undefined && selectedBrowserTabs.value.has(tab.id),
  ),
);
watch(selectedWindow, () => selectedBrowserTabs.value.clear());
watch(visibleTabs, (tabs) => {
  const ids = new Set(tabs.map((tab) => tab.id));
  selectedBrowserTabs.value = new Set(
    [...selectedBrowserTabs.value].filter((id) => ids.has(id)),
  );
});
function toggleBrowserTab(id: number | undefined) {
  if (id === undefined) return;
  if (selectedBrowserTabs.value.has(id)) selectedBrowserTabs.value.delete(id);
  else selectedBrowserTabs.value.add(id);
}
async function actOnBrowserSelection(action: 'group' | 'ungroup' | 'close') {
  const windowId = selectedWindow.value;
  if (windowId === undefined) return;
  // Recheck live membership so closed or moved tabs are never acted on from stale UI state.
  const ids = (await browser.tabs.query({ windowId }))
    .filter(
      (tab) => tab.id !== undefined && selectedBrowserTabs.value.has(tab.id),
    )
    .map((tab) => tab.id!);
  if (!ids.length) {
    selectedBrowserTabs.value.clear();
    return;
  }
  const tabIds = ids as [number, ...number[]];
  if (action === 'close') {
    await browser.tabs.remove(ids);
    notice.value = `已关闭 ${ids.length} 个标签页`;
  } else if (action === 'ungroup') {
    await browser.tabs.ungroup(tabIds);
    notice.value = '已取消所选标签页的群组';
  } else {
    const groups = await browser.tabGroups.query({ windowId });
    const next =
      groups.reduce(
        (n, group) =>
          Math.max(n, Number(/^群组(\d+)$/.exec(group.title || '')?.[1] || 0)),
        0,
      ) + 1;
    const groupId = await browser.tabs.group({
      tabIds,
      createProperties: { windowId },
    });
    await browser.tabGroups.update(groupId, {
      title: `群组${String(next).padStart(2, '0')}`,
      color: 'blue',
    });
    notice.value = `已将 ${ids.length} 个标签页加入新群组`;
  }
  selectedBrowserTabs.value.clear();
}
const selected = ref(new Set<string>());
const menu = ref('');
const selectedEntries = computed(() =>
  collections.value.flatMap((group) =>
    group.tabs
      .filter((tab) => selected.value.has(tab.id))
      .map((tab) => ({ group: group.id, tab })),
  ),
);
watch(activeSpace, () => {
  selected.value.clear();
  menu.value = '';
});
watch(collections, () => {
  const ids = new Set(
    collections.value.flatMap((c) => c.tabs.map((t) => t.id)),
  );
  selected.value = new Set([...selected.value].filter((id) => ids.has(id)));
});
function toggleSelected(id: string) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
}
async function copyLinks(tabs: SavedTab[]) {
  await navigator.clipboard.writeText(tabs.map((t) => t.url).join('\n'));
  notice.value =
    tabs.length > 1 ? `已复制 ${tabs.length} 个链接` : '链接已复制';
}
const editTabOpen = ref(false);
const editTabTarget = ref<{ group: string; id: string }>();
const tabName = ref('');
const tabUrl = ref('');
const editTabError = ref('');
function editTab(group: string, tab: SavedTab) {
  menu.value = '';
  editTabTarget.value = { group, id: tab.id };
  tabName.value = tab.title;
  tabUrl.value = tab.url;
  editTabError.value = '';
  editTabOpen.value = true;
}
function submitTab() {
  void run(async () => {
    if (!editTabTarget.value) return;
    try {
      await updateSavedTab(editTabTarget.value.group, editTabTarget.value.id, {
        title: tabName.value,
        url: tabUrl.value,
      });
      editTabOpen.value = false;
      notice.value = '标签页已修改';
    } catch (e) {
      editTabError.value = e instanceof Error ? e.message : '修改失败';
    }
  });
}
const viewMode = ref<'grid' | 'list'>('grid');
const spaceMenu = ref<{ id: string; x: number; y: number }>();
const spaceMenuPanel = ref<HTMLElement>();
function closeSpaceMenu() {
  spaceMenu.value = undefined;
}
function outsideSpaceMenu(event: PointerEvent) {
  if (!spaceMenuPanel.value?.contains(event.target as Node)) closeSpaceMenu();
}
async function showSpaceMenu(event: MouseEvent, id: string) {
  if (busy.value) return;
  spaceMenu.value = {
    id,
    x: Math.max(8, Math.min(event.clientX, innerWidth - 188)),
    y: Math.max(8, Math.min(event.clientY, innerHeight - 112)),
  };
  await nextTick();
  spaceMenuPanel.value?.focus();
}
async function manageSpace(action: 'rename' | 'delete') {
  if (!spaceMenu.value) return;
  activeSpace.value = spaceMenu.value.id;
  closeSpaceMenu();
  await nextTick();
  if (action === 'rename') void editSpace();
  else deletingSpace.value = true;
}
onMounted(() => {
  document.addEventListener('pointerdown', outsideSpaceMenu, true);
  window.addEventListener('resize', closeSpaceMenu);
  window.addEventListener('blur', closeSpaceMenu);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', outsideSpaceMenu, true);
  window.removeEventListener('resize', closeSpaceMenu);
  window.removeEventListener('blur', closeSpaceMenu);
});
const spaceForm = ref(false);
const spaceEditing = ref<string>();
const spaceName = ref('');
const spaceInput = ref<HTMLInputElement>();
const deletingSpace = ref(false);
function addSpace() {
  void run(async () => {
    activeSpace.value = await saveSpace();
    spaceForm.value = false;
    deletingSpace.value = false;
  });
}
async function editSpace() {
  spaceEditing.value = activeSpace.value;
  spaceName.value = currentSpace.value?.name || '';
  spaceForm.value = true;
  deletingSpace.value = false;
  await nextTick();
  spaceInput.value?.focus();
}
function submitSpace() {
  void run(async () => {
    activeSpace.value = await saveSpace(spaceName.value, spaceEditing.value);
    spaceForm.value = false;
  });
}
const editing = ref('');
const editName = ref('');
const editInput = ref<HTMLInputElement[]>();
const deleting = ref('');
const collapsed = ref(new Set<string>());
type Drag =
  | { kind: 'tab'; id: number }
  | { kind: 'saved'; group: string; id: string }
  | { kind: 'collection'; id: string };
const landing = createDragLanding();
onUnmounted(() => {
  clearTimeout(dragVisualTimer);
  landing.dispose();
});
function commitDrop(action: () => Promise<void>) {
  void landing
    .commit(
      () => run(action),
      () => endDrag(true),
      syncAfterDrop,
    )
    .catch((e) => {
      error.value = e instanceof Error ? e.message : '拖拽失败';
    });
}
const drag = ref<Drag>();
const dragVisualActive = ref(false);
let dragVisualTimer: ReturnType<typeof setTimeout> | undefined;
function hideDragSource() {
  clearTimeout(dragVisualTimer);
  // Let the browser capture its native drag image before collapsing the source.
  dragVisualTimer = setTimeout(() => {
    dragVisualActive.value = true;
  }, 0);
}
const draggedGroup = ref<number>();
const groupDrop = ref<{
  id?: number;
  tabId?: number;
  end?: boolean;
  after: boolean;
}>();
function startGroupDrag(event: DragEvent, id: number) {
  if (landing.committing || busy.value || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  const source = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    '.workspace-browser-group',
  );
  if (source) landing.capture(event, source, `[data-group-id="${id}"]`);
  draggedGroup.value = id;
  hideDragSource();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-duoyu-group', String(id));
}
function overGroup(event: DragEvent, id: number) {
  if (
    draggedGroup.value === undefined ||
    draggedGroup.value === id ||
    id === -1
  )
    return;
  event.preventDefault();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  groupDrop.value = {
    id,
    after: event.clientY > bounds.top + bounds.height / 2,
  };
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function overUngroupedTab(event: DragEvent, tab: BrowserTab) {
  if (draggedGroup.value === undefined || (tab.groupId ?? -1) !== -1) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  groupDrop.value = {
    tabId: tab.id,
    after: event.clientY > bounds.top + bounds.height / 2,
  };
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function overGroupEnd(event: DragEvent) {
  if (draggedGroup.value === undefined) return;
  event.preventDefault();
  groupDrop.value = { end: true, after: true };
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function dropGroup() {
  const source = draggedGroup.value,
    target = groupDrop.value;
  if (source === undefined || !target) {
    endDrag();
    return;
  }
  commitDrop(async () => {
    const sourceGroup = await browser.tabGroups.get(source);
    if (target.id !== undefined) {
      const targetGroup = await browser.tabGroups.get(target.id);
      if (sourceGroup.windowId !== targetGroup.windowId) return;
    }
    const tabs = (
      await browser.tabs.query({ windowId: sourceGroup.windowId })
    ).sort((a, b) => a.index - b.index);
    const remaining = tabs.filter((tab) => tab.groupId !== source);
    const targetTabs = remaining.filter((tab) =>
      target.tabId !== undefined
        ? tab.id === target.tabId
        : tab.groupId === target.id,
    );
    const edge = target.after ? targetTabs.at(-1) : targetTabs[0];
    if (!target.end && !edge) return;
    const index = Math.max(
      remaining.filter((tab) => tab.pinned).length,
      target.end
        ? remaining.length
        : remaining.indexOf(edge!) + (target.after ? 1 : 0),
    );
    await browser.tabGroups.move(source, { index });
  });
}
const dropTarget = ref('');
function previewTabs(
  group: TabCollection,
): (SavedTab & { placeholder?: boolean })[] {
  const items: (SavedTab & { placeholder?: boolean })[] = [...group.tabs];
  if (!drag.value || drag.value.kind === 'collection') return items;
  const index = items.findIndex((tab) => tab.id === dropTarget.value);
  if (dropTarget.value !== group.id && index < 0) return items;
  if (drag.value.kind === 'saved' && dropTarget.value === drag.value.id)
    return items;
  items.splice(index < 0 ? items.length : index, 0, {
    id: 'drop-placeholder',
    title: '松开以放置',
    url: '',
    icon: '',
    savedAt: 0,
    placeholder: true,
  });
  return items;
}
function startDrag(event: DragEvent, value: Drag) {
  if (
    landing.committing ||
    isMarkedSpace.value ||
    !event.dataTransfer ||
    busy.value
  ) {
    event.preventDefault();
    return;
  }
  const attr =
    value.kind === 'saved'
      ? 'data-saved-id'
      : value.kind === 'collection'
        ? 'data-collection-id'
        : 'data-browser-tab-id';
  const selector = `[${attr}="${value.id}"]`;
  const source = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    selector,
  );
  if (source) landing.capture(event, source, selector);
  drag.value = value;
  hideDragSource();
  event.dataTransfer.effectAllowed = value.kind === 'tab' ? 'copyMove' : 'move';
  event.dataTransfer.setData('application/x-duoyu-tab', JSON.stringify(value));
}
function endDrag(force = false) {
  if (landing.committing && force !== true) return;
  clearTimeout(dragVisualTimer);
  dragVisualActive.value = false;
  draggedGroup.value = undefined;
  groupDrop.value = undefined;
  drag.value = undefined;
  dropTarget.value = '';
}
function over(event: DragEvent, target: string) {
  if (isMarkedSpace.value || !drag.value) return;
  event.preventDefault();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = drag.value.kind === 'tab' ? 'copy' : 'move';
  dropTarget.value = target;
}
function drop(group: string, before?: string) {
  const value = drag.value;
  if (!value) {
    endDrag();
    return;
  }
  commitDrop(async () => {
    if (value.kind === 'tab') {
      const tab = await browser.tabs.get(value.id);
      await save([tab], group, before);
      landing.setTarget(
        `[data-collection-id="${group}"] .workspace-saved-tab:has(.workspace-link[title="${CSS.escape(tab.pendingUrl || tab.url || '')}"])`,
      );
    } else if (value.kind === 'saved')
      await moveSavedTab(value.group, value.id, group, before);
    else await reorderCollection(value.id, group);
  });
}
function dropOnTab(tab: BrowserTab) {
  if (draggedGroup.value !== undefined) {
    dropGroup();
    return;
  }
  const value = drag.value;
  if (value?.kind !== 'tab' || value.id === tab.id) {
    endDrag();
    return;
  }
  commitDrop(async () => {
    const [source, target] = await Promise.all([
      browser.tabs.get(value.id),
      browser.tabs.get(tab.id!),
    ]);
    // Only specify a destination window when moving between windows.
    // Resolve fresh indices because browser tab events can arrive during a drag.
    await browser.tabs.move(value.id, {
      ...(source.windowId !== target.windowId
        ? { windowId: target.windowId }
        : {}),
      index: target.index,
    });
  });
}
function showCreate() {
  if (isMarkedSpace.value) return;
  void run(async () => {
    destination.value = await createCollection('', [], activeSpace.value);
    query.value = '';
  });
}
async function edit(group: TabCollection) {
  editing.value = group.id;
  editName.value = group.name;
  await nextTick();
  editInput.value?.[0]?.focus();
  editInput.value?.[0]?.select();
}
function rename(id: string) {
  if (!editName.value.trim()) return;
  void run(async () => {
    await renameCollection(id, editName.value);
    editing.value = '';
  });
}
function collapse(id: string) {
  if (collapsed.value.has(id)) collapsed.value.delete(id);
  else collapsed.value.add(id);
}
function moveWithSelect(event: Event, group: string, id: string) {
  const select = event.target as HTMLSelectElement;
  const target = select.value;
  select.value = '';
  if (target) void run(() => moveSavedTab(group, id, target));
}
function shiftCollection(index: number, direction: -1 | 1) {
  const current = collections.value[index];
  const next = collections.value[index + direction];
  if (!current || !next) return;
  void run(() =>
    direction < 0
      ? reorderCollection(current.id, next.id)
      : reorderCollection(next.id, current.id),
  );
}
</script>

<template>
  <section
    class="workspace-board"
    :class="{ 'is-list-view': viewMode === 'list' }"
    aria-label="标签页管理"
    @click.stop="menu = ''"
    @pointerdown.stop
    @contextmenu.stop
    @drop.capture="landing.track($event)"
    @dragend="endDrag()"
    @keydown.esc="endDrag()"
  >
    <aside class="workspace-spaces side-menu" aria-label="空间切换">
      <h2>我的空间</h2>
      <nav aria-label="选择空间">
        <button
          class="workspace-space side-menu-choice"
          :aria-pressed="isMarkedSpace"
          :disabled="busy"
          @click="
            activeSpace = 'marked';
            spaceForm = false;
            deletingSpace = false;
          "
        >
          <svg
            class="workspace-space-symbol side-menu-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z"
            /></svg
          ><small>标记</small>
        </button>
        <button
          v-for="space in spaces"
          :key="space.id"
          class="workspace-space side-menu-choice"
          :aria-pressed="activeSpace === space.id"
          @contextmenu.prevent.stop="showSpaceMenu($event, space.id)"
          :disabled="busy"
          @click="
            activeSpace = space.id;
            spaceForm = false;
            deletingSpace = false;
          "
        >
          <svg
            class="workspace-space-symbol side-menu-icon"
            viewBox="0 0 28 28"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="22" height="22" rx="6" />
            <text
              x="14"
              y="14"
              text-anchor="middle"
              dominant-baseline="central"
            >
              {{ space.name.slice(0, 1) }}
            </text></svg
          ><small>{{ space.name }}</small>
        </button>
      </nav>
      <button
        class="workspace-space-add side-menu-add"
        aria-label="新建空间"
        :disabled="busy || loading"
        @click="addSpace()"
      >
        <img
          src="/images/add.png"
          width="28"
          height="28"
          alt=""
          draggable="false"
        />
      </button>
      <BaseDialog v-model:open="spaceForm" title="重命名空间">
        <form
          class="workspace-space-form side-menu-form"
          @submit.prevent="submitSpace"
          @keydown.esc.stop="spaceForm = false"
        >
          <input
            ref="spaceInput"
            v-model="spaceName"
            maxlength="40"
            aria-label="空间名称"
            placeholder="空间名称"
          />
          <button
            class="workspace-button glass-control glass-interactive"
            :disabled="busy || !spaceName.trim()"
          >
            保存空间</button
          ><button
            type="button"
            class="workspace-button glass-control glass-interactive"
            @click="spaceForm = false"
          >
            取消
          </button>
        </form>
      </BaseDialog>
      <div
        v-if="spaceMenu"
        ref="spaceMenuPanel"
        class="workspace-space-menu side-menu-context glass-surface"
        role="menu"
        aria-label="空间操作"
        tabindex="-1"
        :style="{ left: spaceMenu.x + 'px', top: spaceMenu.y + 'px' }"
        @click.stop
        @pointerdown.stop
        @contextmenu.prevent.stop
        @keydown.esc.stop="closeSpaceMenu"
      >
        <button
          role="menuitem"
          class="workspace-button glass-control glass-interactive"
          @click="manageSpace('rename')"
        >
          重命名空间
        </button>
        <button
          role="menuitem"
          class="workspace-button glass-control glass-interactive"
          :disabled="spaceMenu.id === 'default' || busy"
          @click="manageSpace('delete')"
        >
          删除空间
        </button>
      </div>
      <BaseDialog v-model:open="deletingSpace" title="删除空间">
        <div class="workspace-space-confirm" role="alert">
          <p>删除此空间？集合会移回默认空间，保留其中的标签页。</p>
          <button
            class="workspace-button glass-control glass-interactive"
            :disabled="busy"
            @click="
              run(async () => {
                await deleteSpace(activeSpace);
                activeSpace = 'default';
                deletingSpace = false;
              })
            "
          >
            确认删除空间</button
          ><button
            class="workspace-button glass-control glass-interactive"
            @click="deletingSpace = false"
          >
            取消
          </button>
        </div>
      </BaseDialog>
    </aside>
    <header class="workspace-toolbar">
      <div class="workspace-heading">
        <img src="/icons/32.png" width="28" height="28" alt="" />
        <h1>{{ currentSpace?.name || '标签工作区' }}</h1>
        <span>{{ collections.length }} 个集合 · {{ savedCount }} 个标签页</span>
      </div>
      <label class="workspace-search glass-surface"
        ><span aria-hidden="true">⌕</span
        ><input
          v-model="query"
          type="search"
          placeholder="搜索集合、标签页或网址"
          aria-label="搜索工作区"
        /><button
          v-if="query"
          class="workspace-icon glass-control glass-interactive"
          aria-label="清空工作区搜索"
          @click="query = ''"
        >
          ×
        </button></label
      >
    </header>
    <div class="workspace-columns">
      <section class="workspace-library" aria-label="已保存的集合">
        <header class="workspace-section-heading">
          <div>
            <h2>
              我的集合 <span>{{ collections.length }}</span>
            </h2>
          </div>
          <div
            class="workspace-view-controls"
            role="group"
            aria-label="集合视图"
          >
            <button
              class="workspace-button glass-control glass-interactive"
              :aria-pressed="viewMode === 'grid'"
              @click="viewMode = 'grid'"
            >
              网格
            </button>
            <button
              class="workspace-button glass-control glass-interactive"
              :aria-pressed="viewMode === 'list'"
              @click="viewMode = 'list'"
            >
              列表
            </button>
            <button
              class="workspace-button glass-control glass-interactive"
              @click="collapsed = new Set()"
            >
              展开全部
            </button>
            <button
              class="workspace-button glass-control glass-interactive"
              @click="collapsed = new Set(collections.map((c) => c.id))"
            >
              收起全部
            </button>
          </div>
          <button
            class="workspace-button glass-control glass-interactive"
            :disabled="busy || loading"
            v-if="!isMarkedSpace"
            @click="showCreate"
          >
            ＋ 新建集合
          </button>
        </header>
        <div
          v-if="selectedEntries.length"
          class="workspace-selection glass-surface"
        >
          <span>已选择 {{ selectedEntries.length }} 项</span>
          <button
            class="glass-control glass-interactive"
            @click="
              selected = new Set(
                visibleCollections.flatMap((c) => c.tabs.map((t) => t.id)),
              )
            "
          >
            全选
          </button>
          <button
            class="glass-control glass-interactive"
            :disabled="busy"
            @click="run(() => copyLinks(selectedEntries.map((e) => e.tab)))"
          >
            复制所选链接
          </button>
          <button
            class="glass-control glass-interactive"
            :disabled="busy"
            @click="
              run(async () => {
                for (const entry of selectedEntries)
                  await updateSavedTab(entry.group, entry.tab.id, {
                    starred: true,
                  });
              })
            "
          >
            标记所选
          </button>
          <button
            class="glass-control glass-interactive"
            @click="selected.clear()"
          >
            取消选择
          </button>
        </div>
        <div class="workspace-collections" :aria-busy="loading">
          <p v-if="loading" class="workspace-empty">正在读取收藏…</p>
          <div
            v-else-if="isMarkedSpace && !collections.length"
            class="workspace-empty"
          >
            暂无标记的标签页，点击卡片上的收藏图标后会显示在这里。
          </div>
          <p
            v-else-if="collections.length && !visibleCollections.length"
            class="workspace-empty"
          >
            没有找到匹配的收藏
          </p>
          <ReorderTransition
            :key="activeSpace"
            class="workspace-collection-order"
          >
            <article
              v-for="group in visibleCollections"
              :key="group.id"
              class="workspace-collection"
              :class="{
                'is-drop-target': dropTarget === group.id,
                'is-collection-drop':
                  drag?.kind === 'collection' &&
                  drag.id !== group.id &&
                  dropTarget === group.id,
                'is-drag-source':
                  dragVisualActive &&
                  drag?.kind === 'collection' &&
                  drag.id === group.id,
              }"
              :data-collection-id="group.id"
              @dragover="over($event, group.id)"
              @dragleave.self="dropTarget = ''"
              @drop.prevent.stop="drop(group.id)"
            >
              <header class="workspace-collection-heading">
                <button
                  v-if="!isMarkedSpace"
                  class="workspace-icon collection-handle glass-control glass-interactive"
                  :draggable="!isMarkedSpace"
                  :aria-label="`拖动集合 ${group.name}`"
                  title="拖动集合排序"
                  @dragstart.stop="
                    startDrag($event, { kind: 'collection', id: group.id })
                  "
                >
                  ⠿
                </button>
                <form
                  v-if="editing === group.id"
                  class="workspace-rename"
                  @submit.prevent="rename(group.id)"
                  @keydown.esc.stop="editing = ''"
                >
                  <input
                    ref="editInput"
                    v-model="editName"
                    maxlength="80"
                    aria-label="重命名集合"
                  /><button
                    class="workspace-icon glass-control glass-interactive"
                    aria-label="保存集合名称"
                    :disabled="busy || !editName.trim()"
                  >
                    ✓</button
                  ><button
                    type="button"
                    class="workspace-icon glass-control glass-interactive"
                    aria-label="取消重命名"
                    @click="editing = ''"
                  >
                    ×
                  </button>
                </form>
                <button
                  v-else
                  class="workspace-collection-name"
                  :aria-expanded="!collapsed.has(group.id)"
                  @click="collapse(group.id)"
                >
                  <span>{{
                    isMarkedSpace
                      ? `${spaces.find((s) => s.id === (group.spaceId || 'default'))?.name || '个人空间'} / ${group.name}`
                      : group.name
                  }}</span
                  ><small>{{ group.tabs.length }}</small
                  ><span aria-hidden="true">{{
                    collapsed.has(group.id) ? '▸' : '▾'
                  }}</span>
                </button>
                <div v-if="!isMarkedSpace" class="workspace-collection-actions">
                  <button
                    class="workspace-icon glass-control glass-interactive"
                    :disabled="busy || !group.tabs.length"
                    :aria-label="`打开集合 ${group.name} 的全部标签页`"
                    title="全部打开"
                    @click="run(() => openSaved(group.tabs))"
                  >
                    ↗
                  </button>
                  <button
                    class="workspace-icon glass-control glass-interactive"
                    :disabled="busy"
                    :aria-label="`重命名 ${group.name}`"
                    title="重命名"
                    @click="edit(group)"
                  >
                    ✎
                  </button>
                  <button
                    class="workspace-icon glass-control glass-interactive"
                    :disabled="busy || collections[0]?.id === group.id"
                    :aria-label="`上移集合 ${group.name}`"
                    title="上移"
                    @click="
                      shiftCollection(
                        collections.findIndex((c) => c.id === group.id),
                        -1,
                      )
                    "
                  >
                    ↑
                  </button>
                  <button
                    class="workspace-icon glass-control glass-interactive"
                    :disabled="busy || collections.at(-1)?.id === group.id"
                    :aria-label="`下移集合 ${group.name}`"
                    title="下移"
                    @click="
                      shiftCollection(
                        collections.findIndex((c) => c.id === group.id),
                        1,
                      )
                    "
                  >
                    ↓
                  </button>
                  <button
                    class="workspace-icon glass-control glass-interactive"
                    :disabled="busy"
                    :aria-label="`删除集合 ${group.name}`"
                    title="删除集合"
                    @click="deleting = group.id"
                  >
                    ×
                  </button>
                </div>
              </header>
              <div
                v-if="deleting === group.id"
                class="workspace-confirm glass-surface"
                role="alert"
                @keydown.esc.stop="deleting = ''"
              >
                <span>删除此集合和其中的收藏？</span
                ><button
                  class="workspace-button glass-control glass-interactive"
                  :disabled="busy"
                  @click="
                    run(async () => {
                      await removeGroup(group.id);
                      deleting = '';
                    })
                  "
                >
                  确认删除</button
                ><button
                  class="workspace-button glass-control glass-interactive"
                  @click="deleting = ''"
                >
                  取消
                </button>
              </div>
              <ReorderTransition
                v-if="!collapsed.has(group.id)"
                class="workspace-saved-tabs"
              >
                <template v-for="tab in previewTabs(group)" :key="tab.id">
                  <div
                    v-if="tab.placeholder"
                    class="workspace-drag-placeholder"
                    aria-hidden="true"
                    @dragover.prevent.stop
                    @drop.prevent.stop="
                      drop(
                        group.id,
                        dropTarget === group.id ? undefined : dropTarget,
                      )
                    "
                  >
                    <span>松开以放置</span>
                  </div>
                  <div
                    v-else
                    class="workspace-saved-tab glass-surface"
                    :class="{
                      'is-drag-source':
                        dragVisualActive &&
                        drag?.kind === 'saved' &&
                        drag.id === tab.id,
                      'is-selected': selected.has(tab.id),
                    }"
                    :data-saved-id="tab.id"
                    :draggable="!isMarkedSpace"
                    @dragstart.stop="
                      startDrag($event, {
                        kind: 'saved',
                        group: group.id,
                        id: tab.id,
                      })
                    "
                    @dragover.stop="over($event, tab.id)"
                    @drop.prevent.stop="drop(group.id, tab.id)"
                  >
                    <input
                      class="workspace-card-checkbox"
                      type="checkbox"
                      :checked="selected.has(tab.id)"
                      :aria-label="`选择标签页 ${tab.title}`"
                      @click.stop
                      @dragstart.prevent.stop
                      @change="toggleSelected(tab.id)"
                    />
                    <button
                      class="workspace-link glass-control"
                      :title="tab.url"
                      @click="run(() => openSaved([tab]))"
                    >
                      <WorkspaceFavicon
                        :src="tab.icon"
                        :page-url="tab.url"
                        :title="tab.title"
                      /><span
                        ><strong>{{ tab.title }}</strong
                        ><small>{{ hostname(tab.url) }}</small></span
                      >
                    </button>
                    <div
                      class="workspace-card-actions"
                      @click.stop
                      @dragstart.prevent.stop
                    >
                      <button
                        class="glass-control glass-interactive"
                        :aria-label="`标记收藏 ${tab.title}`"
                        :aria-pressed="!!tab.starred"
                        :disabled="busy"
                        title="标记收藏"
                        @click="
                          run(() =>
                            updateSavedTab(group.id, tab.id, {
                              starred: !tab.starred,
                            }),
                          )
                        "
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M6 4h12v17l-6-4-6 4Z"
                            :fill="tab.starred ? 'currentColor' : 'none'"
                          />
                        </svg>
                      </button>
                      <button
                        class="glass-control glass-interactive"
                        :aria-label="`复制链接 ${tab.title}`"
                        title="复制链接"
                        :disabled="busy"
                        @click="run(() => copyLinks([tab]))"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="8" y="8" width="12" height="13" rx="2" />
                          <path d="M15 8V3H3v13h5" />
                        </svg>
                      </button>
                      <button
                        class="glass-control glass-interactive"
                        :aria-label="`更多 ${tab.title}`"
                        :aria-expanded="menu === tab.id"
                        title="更多"
                        @click="menu = menu === tab.id ? '' : tab.id"
                      >
                        ···
                      </button>
                      <div
                        v-if="menu === tab.id"
                        class="workspace-card-menu glass-surface"
                        @keydown.esc.stop="menu = ''"
                      >
                        <button
                          class="glass-control glass-interactive"
                          :disabled="busy"
                          @click="editTab(group.id, tab)"
                        >
                          修改
                        </button>
                        <select
                          v-if="!isMarkedSpace && collections.length > 1"
                          class="glass-control glass-interactive"
                          :aria-label="`移动收藏 ${tab.title}`"
                          @change="
                            moveWithSelect($event, group.id, tab.id);
                            menu = '';
                          "
                        >
                          <option value="">移动到集合</option>
                          <option
                            v-for="other in collections.filter(
                              (c) => c.id !== group.id,
                            )"
                            :key="other.id"
                            :value="other.id"
                          >
                            {{ other.name }}
                          </option>
                        </select>
                        <button
                          class="glass-control glass-interactive"
                          :disabled="busy"
                          :aria-label="`移除收藏 ${tab.title}`"
                          @click="
                            menu = '';
                            run(() => removeTab(group.id, tab.id));
                          "
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                </template>
                <p
                  v-if="!group.tabs.length && !previewTabs(group).length"
                  key="empty"
                  class="workspace-drop-hint"
                >
                  拖入右侧标签页即可保存
                </p>
              </ReorderTransition>
            </article>
          </ReorderTransition>
        </div>
      </section>
      <aside
        class="workspace-tabs glass-surface"
        aria-label="浏览器打开的标签页"
      >
        <header class="workspace-section-heading">
          <div>
            <h2>
              打开的标签页 <span>{{ visibleTabs.length }}</span>
            </h2>
          </div>
        </header>
        <div
          class="workspace-tab-scope glass-surface"
          role="group"
          aria-label="标签页范围"
        >
          <button
            v-for="window in windowOptions"
            :key="window.id"
            class="glass-control glass-interactive"
            :aria-pressed="selectedWindow === window.id"
            @click="selectedWindow = window.id"
          >
            {{ window.label }}
          </button>
        </div>
        <div
          v-if="selectedOpenTabs.length"
          class="workspace-browser-selection glass-surface"
          aria-label="所选浏览器标签页操作"
        >
          <span>已选择 {{ selectedOpenTabs.length }} 项</span>
          <button
            class="glass-control glass-interactive"
            :disabled="busy"
            @click="
              selectedBrowserTabs = new Set(
                visibleTabs
                  .filter((tab) => tab.id !== undefined)
                  .map((tab) => tab.id!),
              )
            "
          >
            全选标签页
          </button>
          <button
            class="glass-control glass-interactive"
            :disabled="busy"
            @click="run(() => actOnBrowserSelection('group'))"
          >
            新建群组
          </button>
          <button
            v-if="
              selectedOpenTabs.some(
                (tab) => tab.groupId !== undefined && tab.groupId !== -1,
              )
            "
            class="glass-control glass-interactive"
            :disabled="busy"
            @click="run(() => actOnBrowserSelection('ungroup'))"
          >
            取消群组
          </button>
          <button
            class="glass-control glass-interactive"
            :disabled="busy"
            title="关闭所选浏览器标签页"
            @click="run(() => actOnBrowserSelection('close'))"
          >
            删除所选
          </button>
          <button
            class="glass-control glass-interactive"
            :disabled="busy"
            @click="selectedBrowserTabs.clear()"
          >
            取消选择标签页
          </button>
        </div>
        <div class="workspace-open-tabs" :aria-busy="tabsLoading">
          <div v-if="needsTabPermission" class="workspace-empty" role="status">
            <p>请重新加载扩展并允许标签页权限，以读取网页标题和图标。</p>
          </div>
          <p v-if="tabsLoading" class="workspace-empty">正在读取标签页…</p>
          <p v-else-if="!visibleTabs.length" class="workspace-empty">
            {{ query ? '没有匹配的打开标签页' : '这个窗口暂无其他标签页' }}
          </p>
          <ReorderTransition class="workspace-browser-group-order">
            <ReorderTransition
              tag="section"
              v-for="group in tabGroups"
              :key="group.key"
              class="workspace-browser-group"
              :class="{
                'is-drag-source': dragVisualActive && draggedGroup === group.id,
                'group-drop-before':
                  groupDrop?.id === group.id && !groupDrop.after,
                'group-drop-after':
                  groupDrop?.id === group.id && groupDrop.after,
              }"
              @dragover="overGroup($event, group.id)"
              @drop.prevent="dropGroup"
              :data-group-color="group.color"
              :data-group-id="group.id"
              :aria-label="group.label"
            >
              <h3 key="heading" class="workspace-window-label">
                <button
                  v-if="group.id !== -1"
                  class="workspace-group-handle glass-control glass-interactive"
                  draggable="true"
                  :disabled="busy"
                  :aria-label="`拖动群组 ${group.label}`"
                  title="拖动群组排序"
                  @dragstart.stop="startGroupDrag($event, group.id)"
                >
                  ⠿
                </button>
                <button
                  v-if="group.id !== -1"
                  class="workspace-group-toggle"
                  :aria-label="`折叠群组 ${group.label}`"
                  :aria-expanded="!group.collapsed"
                  :disabled="busy"
                  @click="run(() => toggleBrowserGroup(group.id))"
                >
                  <span aria-hidden="true">{{
                    group.collapsed ? '▸' : '▾'
                  }}</span
                  >{{ group.label }}
                </button>
                <template v-else>{{ group.label }}</template>
                <span>{{ group.tabs.length }}</span>
                <button
                  v-if="group.id !== -1"
                  class="workspace-group-save glass-control glass-interactive"
                  :aria-label="`保存群组 ${group.label} 为集合`"
                  title="以群组名称保存为集合"
                  :disabled="busy || loading"
                  @click="run(() => saveBrowserGroup(group.id))"
                >
                  ＋
                </button>
              </h3>
              <div
                v-for="tab in group.collapsed ? [] : group.tabs"
                :key="tab.id"
                class="workspace-open-tab glass-surface"
                :class="{
                  'is-drop-before': dropTarget === `tab-${tab.id}`,
                  'group-tab-before':
                    groupDrop?.tabId === tab.id && !groupDrop?.after,
                  'group-tab-after':
                    groupDrop?.tabId === tab.id && groupDrop?.after,
                  'is-drag-source':
                    dragVisualActive &&
                    drag?.kind === 'tab' &&
                    drag.id === tab.id,
                  'is-selected':
                    tab.id !== undefined && selectedBrowserTabs.has(tab.id),
                }"
                :data-browser-tab-id="tab.id"
                :draggable="!isMarkedSpace"
                @dragstart.stop="
                  tab.id !== undefined &&
                  startDrag($event, { kind: 'tab', id: tab.id })
                "
                @dragover="
                  draggedGroup !== undefined
                    ? overUngroupedTab($event, tab)
                    : drag?.kind === 'tab' && over($event, `tab-${tab.id}`)
                "
                @drop.prevent.stop="dropOnTab(tab)"
              >
                <input
                  class="workspace-tab-checkbox"
                  type="checkbox"
                  :aria-label="`选择打开的标签页 ${tabTitle(tab)}`"
                  :checked="
                    tab.id !== undefined && selectedBrowserTabs.has(tab.id)
                  "
                  :disabled="busy || tab.id === undefined"
                  @click.stop
                  @pointerdown.stop
                  @dragstart.prevent.stop
                  @change="toggleBrowserTab(tab.id)"
                />
                <button
                  class="workspace-link glass-control glass-interactive"
                  :title="tab.url || tab.pendingUrl"
                  @click="run(() => activate(tab))"
                >
                  <WorkspaceFavicon
                    :src="tab.favIconUrl"
                    :page-url="tab.pendingUrl || tab.url"
                    :title="tabTitle(tab)"
                  /><span
                    ><strong>{{ tabTitle(tab) }}</strong
                    ><small
                      >{{ tab.pinned ? '已固定 · ' : ''
                      }}{{ hostname(tab.pendingUrl || tab.url || '') }}</small
                    ></span
                  >
                </button>
              </div>
            </ReorderTransition>
          </ReorderTransition>
          <div
            v-if="draggedGroup !== undefined"
            class="workspace-group-end"
            :class="{ 'is-active': groupDrop?.end }"
            @dragover="overGroupEnd"
            @drop.prevent.stop="dropGroup"
          >
            移到列表末尾
          </div>
        </div>
      </aside>
    </div>
    <BaseDialog v-model:open="editTabOpen" title="修改标签页">
      <form class="workspace-edit-tab" @submit.prevent="submitTab">
        <label
          >名称<input
            v-model="tabName"
            class="glass-surface glass-field"
            required
            maxlength="200"
        /></label>
        <label
          >网址<input
            v-model="tabUrl"
            class="glass-surface glass-field"
            required
            placeholder="https://example.com"
        /></label>
        <p v-if="editTabError" role="alert">{{ editTabError }}</p>
        <div>
          <button
            type="button"
            class="glass-control glass-interactive"
            @click="editTabOpen = false"
          >
            取消</button
          ><button class="glass-control glass-interactive" :disabled="busy">
            保存修改
          </button>
        </div>
      </form>
    </BaseDialog>
    <div
      v-if="notice || error"
      class="workspace-message glass-surface"
      :role="error ? 'alert' : 'status'"
    >
      <span>{{ error || notice }}</span
      ><button
        v-if="undo"
        class="workspace-button glass-control glass-interactive"
        :disabled="busy"
        @click="run(undoDelete)"
      >
        撤销删除</button
      ><button
        class="workspace-icon glass-control glass-interactive"
        aria-label="关闭提示"
        @click="
          notice = '';
          error = '';
        "
      >
        ×
      </button>
    </div>
  </section>
</template>
