<script setup lang="ts">
import { requireAccount, vAccountEdit } from '../auth/edit-access';
import { guestMode } from '../../shared/storage/account';
import { useMouseSort } from '../../shared/useMouseSort';
const pressSort = useMouseSort();
import PageIcon from '../../shared/components/base/PageIcon.vue';
import {
  collectionColors,
  collectionColor,
} from '../../shared/collection-colors';
import Search from '@icon-park/vue-next/es/icons/Search';
import { accountStorage } from '../../shared/storage/account';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
import {
  createCollection,
  updateSavedTab,
  moveSavedTab,
  renameCollection,
  setCollectionColor,
  reorderCollection,
} from './collections';
import { useWorkspace, type BrowserTab } from './useWorkspace';
import { createDragLanding } from '../../shared/drag-landing';
import ReorderTransition from '../../shared/components/base/ReorderTransition.vue';
import WorkspaceCardMain from './WorkspaceCardMain.vue';
import { useWorkspaceLayoutMotion } from './useWorkspaceLayoutMotion';
import WorkspaceFavicon from './WorkspaceFavicon.vue';
import MenuEditorDialog from '../../shared/components/base/MenuEditorDialog.vue';
import DesktopMenu from '../../shared/components/base/DesktopMenu.vue';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import type { SavedTab, TabCollection } from '../../shared/storage/database';
import './workspace.css';
import '../../shared/side-menu.css';
import { saveSpace, deleteSpace, orderSpaces } from './spaces';

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
  loading,
  tabsLoading,
  needsTabPermission,
  tabTitle,
  query,
  selectedWindow,
  destination,
  notice,
  showNotice,
  dismissNotice,
  error,
  busy,
  undo,
  run,
  saveAndCloseTab,
  activate,
  toggleBrowserGroup,
  saveBrowserGroup,
  openSaved,
  openCollection,
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
function closeOpenTab(id: number | undefined) {
  if (id !== undefined) return run(() => browser.tabs.remove(id));
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
    showNotice(`已关闭 ${ids.length} 个标签页`);
  } else if (action === 'ungroup') {
    await browser.tabs.ungroup(tabIds);
    showNotice('已取消所选标签页的群组');
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
    showNotice(`已将 ${ids.length} 个标签页加入新群组`);
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
const allSelectedMarked = computed(
  () =>
    selectedEntries.value.length > 0 &&
    selectedEntries.value.every(({ tab }) => tab.starred),
);
function toggleSelectedMarks() {
  const entries = [...selectedEntries.value];
  const starred = !allSelectedMarked.value;
  return run(async () => {
    for (const { group, tab } of entries) {
      if (!!tab.starred !== starred)
        await updateSavedTab(group, tab.id, { starred });
    }
  });
}

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
  showNotice(tabs.length > 1 ? `已复制 ${tabs.length} 个链接` : '链接已复制');
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
      showNotice('标签页已修改');
    } catch (e) {
      editTabError.value = e instanceof Error ? e.message : '修改失败';
    }
  });
}
const emit = defineEmits<{ close: [] }>();
const searchInput = ref<HTMLInputElement>();
const viewKey = 'duoyu-workspace-view';
const viewMode = ref<'grid' | 'list'>(
  accountStorage.getItem(viewKey) === 'list' ? 'list' : 'grid',
);
watch(viewMode, (mode) => { if (!guestMode) accountStorage.setItem(viewKey, mode); });
const sortingSpaces = ref(false);
function switchSpace(id: string) {
  activeSpace.value = id;
  spaceForm.value = false;
  deletingSpace.value = false;
  closeSpaceMenu();
}
function stepSpace(direction: number) {
  if (
    busy.value ||
    loading.value ||
    sortingSpaces.value ||
    drag.value ||
    landing.committing ||
    menu.value ||
    spaceMenu.value
  )
    return;
  const ids = ['marked', ...spaces.value.map((space) => space.id)];
  const current = ids.indexOf(activeSpace.value);
  switchSpace(ids[(current + direction + ids.length) % ids.length]!);
}
function focusSearch() {
  searchInput.value?.focus();
  searchInput.value?.select();
}
defineExpose({ stepSpace, focusSearch });
async function reorderSpaces(ids: string[]) {
  sortingSpaces.value = true;
  try {
    await run(() => orderSpaces(ids));
  } finally {
    sortingSpaces.value = false;
  }
}
function workspaceKey(event: KeyboardEvent) {
  if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    focusSearch();
  } else if (
    event.key === 'Escape' &&
    (menu.value || spaceMenu.value || query.value)
  ) {
    event.stopPropagation();
    if (spaceMenu.value) closeSpaceMenu();
    else if (menu.value) menu.value = '';
    else {
      query.value = '';
      searchInput.value?.focus();
    }
  }
}
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
  if (!requireAccount()) { closeSpaceMenu(); return; }
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
const deletingSpace = ref(false);
const spaceIcon = ref('Bookmark');
async function addSpace() {
  spaceEditing.value = undefined;
  spaceIcon.value = 'Bookmark';
  let n = 1;
  while (spaces.value.some((s) => s.name === '新空间' + n)) n++;
  spaceName.value = '新空间' + n;
  spaceForm.value = true;
  await nextTick();
}
async function editSpace() {
  spaceEditing.value = activeSpace.value;
  spaceIcon.value = currentSpace.value?.icon || 'Bookmark';
  spaceName.value = currentSpace.value?.name || '';
  spaceForm.value = true;
  deletingSpace.value = false;
  await nextTick();
}
function submitSpace() {
  void run(async () => {
    activeSpace.value = await saveSpace(
      spaceName.value,
      spaceEditing.value,
      spaceIcon.value,
    );
    spaceForm.value = false;
  });
}
const editing = ref('');
const editName = ref('');
const editInput = ref<HTMLInputElement[]>();
const deleting = ref('');
const collapsed = ref(new Set<string>());
const allCollapsed = computed(() =>
  collections.value.every((group) => collapsed.value.has(group.id)),
);
const collapseAction = computed(() =>
  allCollapsed.value ? '展开全部' : '收起全部',
);
function toggleAllCollections() {
  collapsed.value = allCollapsed.value
    ? new Set()
    : new Set(collections.value.map((group) => group.id));
}

type Drag =
  | { kind: 'tab'; id: number }
  | { kind: 'saved'; group: string; id: string }
  | { kind: 'collection'; id: string; spaceId: string };
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
      showNotice(e instanceof Error ? e.message : '拖拽失败', 'alert');
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
type BrowserSection = (typeof tabGroups.value)[number];
const draggedGroup = ref<BrowserSection>();
const groupDrop = ref<{
  id?: number;
  tabId?: number;
  end?: boolean;
  after: boolean;
}>();
type GroupAnchor = { id?: number; tabId?: number; center: number };
let groupAnchors: GroupAnchor[] = [];
let groupScroll = 0;
const previewBrowserGroups = computed(() => {
  const groups = tabGroups.value,
    target = groupDrop.value;
  const source = groups.find((g) => g.key === draggedGroup.value?.key);
  if (!source || !target) return groups;
  const rest = groups.filter((g) => g !== source);
  if (target.end) return [...rest, source];
  const index = rest.findIndex((g) =>
    target.tabId === undefined
      ? g.id === target.id
      : g.tabs.some((t) => t.id === target.tabId),
  );
  if (index < 0) return groups;
  const g = rest[index]!;
  if (target.tabId === undefined)
    rest.splice(index + Number(target.after), 0, source);
  else {
    const cut =
      g.tabs.findIndex((t) => t.id === target.tabId) + Number(target.after);
    const sections = [g.tabs.slice(0, cut), g.tabs.slice(cut)].map((tabs) =>
      tabs.length ? [{ ...g, key: 'ungrouped-' + tabs[0]!.id, tabs }] : [],
    );
    rest.splice(index, 1, ...sections[0]!, source, ...sections[1]!);
  }
  return rest;
});
function startGroupDrag(event: DragEvent, group: BrowserSection) {
  if (!requireAccount()) { event.preventDefault(); return; }
  if (landing.committing || busy.value || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  const source = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    '.workspace-browser-group',
  );
  if (source) landing.capture(event, source, `[data-section-key="${group.key}"]`);
  const panel = source?.closest<HTMLElement>('.workspace-open-tabs');
  if (!panel) return;
  groupScroll = panel.scrollTop;
  const win = group.tabs[0]?.windowId;
  groupAnchors = [];
  for (const section of panel.querySelectorAll<HTMLElement>(
    '[data-group-id]',
  )) {
    const gid = Number(section.dataset.groupId);
    if (section === source) continue;
    for (const row of gid === -1
      ? section.querySelectorAll<HTMLElement>('[data-browser-tab-id]')
      : [section]) {
      const tabId = Number(row.dataset.browserTabId);
      const tab = visibleTabs.value.find((t) =>
        gid === -1 ? t.id === tabId : t.groupId === gid,
      );
      if (!tab || tab.windowId !== win || tab.pinned) continue;
      const r = row.getBoundingClientRect();
      groupAnchors.push({
        ...(gid === -1 ? { tabId } : { id: gid }),
        center: r.top + r.height / 2,
      });
    }
  }
  draggedGroup.value = group;
  hideDragSource();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-duoyu-group', group.key);
}
function trackGroup(event: DragEvent) {
  if (draggedGroup.value === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const panel = event.currentTarget as HTMLElement;
  const y = event.clientY + panel.scrollTop - groupScroll;
  const before = groupAnchors.find((a) => y < a.center);
  const last = groupAnchors.at(-1);
  groupDrop.value = before
    ? { ...before, after: false }
    : last
      ? { ...last, after: true }
      : undefined;
}
function finishGroup(event: DragEvent) {
  if (draggedGroup.value === undefined) return;
  trackGroup(event);
  dropGroup();
}
function dropGroup() {
  const source = draggedGroup.value,
    target = groupDrop.value;
  if (source === undefined || !target) {
    endDrag();
    return;
  }
  commitDrop(async () => {
    const windowId = source.tabs[0]?.windowId;
    if (windowId === undefined) return;
    const tabs = (await browser.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
    const sourceIds = new Set(source.tabs.map(tab => tab.id));
    const members = tabs.filter(tab => tab.groupId === source.id &&
      (source.id !== -1 || (sourceIds.has(tab.id) && !tab.pinned)));
    const remaining = tabs.filter(tab => !members.includes(tab));
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
    if (source.id !== -1) {
      await browser.tabGroups.move(source.id, { index });
    } else if (edge?.id !== undefined) {
      // Insert each tab against the live edge; moving a tab can shift its index.
      for (const member of target.after ? members.reverse() : members) {
        if (member.id === undefined) continue;
        const [tab, anchor] = await Promise.all([browser.tabs.get(member.id), browser.tabs.get(edge.id)]);
        if (tab.windowId !== windowId || anchor.windowId !== windowId || tab.groupId !== -1 || tab.pinned) continue;
        await browser.tabs.move(member.id, {
          index: anchor.index - Number(tab.index < anchor.index) + Number(target.after),
        });
      }
    }
  });
}
const dropTarget = ref('');
const insertion = ref<{ group: string; before?: string }>();
let collectionSlots: { id: string; center: number }[] = [];
let initialScroll = 0;
const previewGroups = computed(() => {
  const groups = [...visibleCollections.value];
  const d = drag.value;
  if (d?.kind !== 'collection' || !insertion.value) return groups;
  const rest = groups.filter((g) => g.id !== d.id);
  const item = groups.find((g) => g.id === d.id);
  if (item) {
    const i = rest.findIndex((g) => g.id === insertion.value?.before);
    rest.splice(i < 0 ? rest.length : i, 0, item);
  }
  return rest;
});
function previewTabs(group: TabCollection): SavedTab[] {
  const d = drag.value,
    slot = insertion.value;
  if (d?.kind !== 'saved' || slot?.group !== group.id) return group.tabs;
  const item = collections.value
    .find((g) => g.id === d.group)
    ?.tabs.find((t) => t.id === d.id);
  if (!item) return group.tabs;
  const rest = group.tabs.filter((t) => t.id !== d.id);
  const i = rest.findIndex((t) => t.id === slot.before);
  rest.splice(i < 0 ? rest.length : i, 0, item);
  return rest;
}
const openTabSlot = ref<number>();
let openTabSlots: { id: number; center: number }[] = [];
let openTabScroll = 0;
function previewOpenTabs(tabs: BrowserTab[]) {
  const d = drag.value;
  if (d?.kind !== 'tab' || openTabSlot.value === undefined) return tabs;
  const source = tabs.findIndex((tab) => tab.id === d.id);
  const target = tabs.findIndex((tab) => tab.id === openTabSlot.value);
  if (source < 0 || target < 0 || source === target) return tabs;
  const next = [...tabs];
  next.splice(target, 0, next.splice(source, 1)[0]!);
  return next;
}
function overOpenTab(event: DragEvent, tab: BrowserTab) {
  if (drag.value?.kind !== 'tab') return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const el = event.currentTarget as HTMLElement;
  if (!openTabSlots.some((slot) => slot.id === tab.id)) {
    openTabSlot.value = tab.id;
    return;
  }
  const y =
    event.clientY +
    (el.closest('.workspace-open-tabs')?.scrollTop || 0) -
    openTabScroll;
  openTabSlot.value = openTabSlots.reduce((best, slot) =>
    Math.abs(slot.center - y) < Math.abs(best.center - y) ? slot : best,
  ).id;
}
// FLIP animation can expose the group between rows at the pointer's drop
// position. Keep accepting the previously selected slot in that same group.
function openTabGap(event: DragEvent, tabs: BrowserTab[], dropping = false) {
  if (drag.value?.kind !== 'tab') return;
  const first = tabs[0];
  if (first && (first.groupId ?? -1) === -1) {
    event.preventDefault();
    const section = (event.currentTarget as HTMLElement).closest('section');
    const rows = section?.querySelectorAll<HTMLElement>('[data-browser-tab-id]');
    const next = Array.from(rows ?? []).find(row => event.clientY < row.getBoundingClientRect().top);
    const target = next ? tabs.find(tab => tab.id === Number(next.dataset.browserTabId)) : tabs.at(-1);
    if (target) {
      openTabSlot.value = target.id;
      if (dropping) dropOnTab(target, !next);
    }
    return;
  }
  if (openTabSlot.value === undefined) return;
  const target = tabs.find((tab) => tab.id === openTabSlot.value);
  if (!target) return;
  overOpenTab(event, target);
  if (dropping) {
    event.stopPropagation();
    dropOnTab(target);
  }
}
function startDrag(event: DragEvent, value: Drag) {
  if (!requireAccount()) {event.preventDefault();return;}
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
  if (value.kind === 'collection' && source) {
    initialScroll = source.closest('.workspace-collections')?.scrollTop || 0;
    collectionSlots = Array.from(
      source.parentElement!.querySelectorAll<HTMLElement>(
        '[data-collection-id]',
      ),
      (el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.collectionId!, center: r.top + r.height / 2 };
      },
    );
  }
  drag.value = value;
  if (value.kind === 'tab' && source) {
    void nextTick(() => {
      if (drag.value?.kind !== 'tab' || drag.value.id !== value.id || !source.isConnected) return;
      openTabScroll = source.closest('.workspace-open-tabs')?.scrollTop || 0;
      openTabSlots = Array.from(
        source.parentElement!.querySelectorAll<HTMLElement>(
          '[data-browser-tab-id]',
        ),
        (el) => {
          const r = el.getBoundingClientRect();
          return { id: Number(el.dataset.browserTabId), center: r.top + r.height / 2 };
        },
      );
    });
  }
  hideDragSource();
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-duoyu-tab', JSON.stringify(value));
}
function endDrag(force = false) {
  if (landing.committing && force !== true) return;
  if (!landing.committing) landing.dispose();
  clearTimeout(dragVisualTimer);
  dragVisualActive.value = false;
  draggedGroup.value = undefined;
  groupDrop.value = undefined;
  drag.value = undefined;
  insertion.value = undefined;
  openTabSlot.value = undefined;
  openTabSlots = [];
  dropTarget.value = '';
}
function over(event: DragEvent, target: string) {
  if (isMarkedSpace.value || !drag.value) return;
  event.preventDefault();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move';
  const el = event.currentTarget as HTMLElement;
  if (drag.value.kind === 'collection') {
    const y =
      event.clientY +
      (el.closest('.workspace-collections')?.scrollTop || 0) -
      initialScroll;
    insertion.value = {
      group: '',
      before: collectionSlots.find(
        (s) => s.id !== drag.value?.id && y < s.center,
      )?.id,
    };
    return;
  }
  if (drag.value.kind === 'saved') {
    const groupEl = el.closest<HTMLElement>('[data-collection-id]');
    const group = groupEl?.dataset.collectionId;
    if (!group || !groupEl) return;
    const tabs =
      visibleCollections.value
        .find((g) => g.id === group)
        ?.tabs.filter((t) => t.id !== drag.value?.id) || [];
    const grid = groupEl.querySelector<HTMLElement>('.workspace-saved-tabs');
    let index = tabs.length;
    if (grid) {
      const bounds = grid.getBoundingClientRect();
      // Use layout coordinates. FLIP transforms move the painted card but do not
      // change its slot, so a stationary pointer cannot alternate between targets.
      const x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      const cards = Array.from(
        grid.querySelectorAll<HTMLElement>(
          ':scope > [data-saved-id]:not(.transfer-out)',
        ),
      );
      const last = cards.at(-1);
      const pastLastCard = last && y >= last.offsetTop &&
        (y >= last.offsetTop + last.offsetHeight || x >= last.offsetLeft + last.offsetWidth);
      if (last && !pastLastCard && y < bounds.height) {
        // Pick a row first, so empty columns cannot snap to the row above.
        const rowDistance = (card: HTMLElement) => Math.abs(y - card.offsetTop - card.offsetHeight / 2);
        const row = cards.reduce((best, card) => rowDistance(card) < rowDistance(best) ? card : best);
        const columnDistance = (card: HTMLElement) => Math.abs(x - card.offsetLeft - card.offsetWidth / 2);
        const nearest = cards.filter(card => card.offsetTop === row.offsetTop)
          .reduce((best, card) => columnDistance(card) < columnDistance(best) ? card : best);
        index = cards.indexOf(nearest);
        if (
          !cards.some((c) => c.dataset.savedId === drag.value?.id) &&
          (viewMode.value === 'list'
            ? y > nearest.offsetTop + nearest.offsetHeight / 2
            : x > nearest.offsetLeft + nearest.offsetWidth / 2)
        )
          index++;
      }
    }
    const before = tabs[index]?.id;
    if (insertion.value?.group !== group || insertion.value.before !== before)
      insertion.value = { group, before };
  }
  dropTarget.value = target;
}
function handleCollectionListEnd(event: DragEvent) {
  if (drag.value?.kind !== 'saved' || !(event.target instanceof Element)) return;
  if (event.target.closest('[data-collection-id]')) return;
  const last = collectionList.value?.querySelector<HTMLElement>('.workspace-collection:last-child');
  const group = last?.dataset.collectionId;
  if (!group || !last || event.clientY < last.getBoundingClientRect().bottom) return;
  event.preventDefault();
  insertion.value = { group };
  if (event.type === 'drop') drop(group);
}
function drop(group: string, before?: string, event?: DragEvent) {
  const value = drag.value;
  if (!value) {
    endDrag();
    return;
  }
  if (event && value.kind === 'saved') over(event, before ?? group);
  const slot = insertion.value;
  commitDrop(async () => {
    if (value.kind === 'tab') {
      const tab = await browser.tabs.get(value.id);
      await saveAndCloseTab(tab, activeSpace.value, group, before);
      landing.setTarget(
        `[data-collection-id="${group}"] .workspace-saved-tab:has(.workspace-link[title="${CSS.escape(tab.pendingUrl || tab.url || '')}"])`,
      );
    } else if (value.kind === 'saved')
      await moveSavedTab(
        value.group,
        value.id,
        slot?.group ?? group,
        slot ? slot.before : before,
      );
    else if (slot) await reorderCollection(value.id, slot.before, value.spaceId);
  });
}
function dropIntoSpace(event: DragEvent) {
  const source = draggedGroup.value;
  const single = drag.value;
  if (!source && single?.kind !== 'tab') return;
  if (!(event.target instanceof Element)) return;
  const spaceRow = event.target.closest<HTMLElement>('.desktop-menu [data-menu-row]');
  const library = event.target.closest('.workspace-library');
  if (!spaceRow && (!library || isMarkedSpace.value)) return;
  // A single tab on a collection uses that collection's insertion handler.
  if (!source && library && event.target.closest('[data-collection-id]')) return;
  const space = spaceRow?.dataset.menuRow ?? activeSpace.value;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (event.type !== 'drop') return;
  commitDrop(async () => {
    if (source) {
      const collectionId = await saveBrowserGroup(source.id, source.tabs, space);
      if (collectionId) landing.setTarget(`[data-collection-id="${collectionId}"]`);
    } else if (single?.kind === 'tab') {
      const tab = await browser.tabs.get(single.id);
      const collectionId = await saveAndCloseTab(tab, space);
      landing.setTarget(`[data-collection-id="${collectionId}"]`);
      switchSpace(space);
    }
  });
}
function handleTabListEnd(event: DragEvent) {
  const source = drag.value;
  if (source?.kind !== 'tab' || !(event.target instanceof Element)) return;
  if (!event.target.matches('.workspace-tabs, .workspace-open-tabs, .workspace-browser-group-order')) return;
  const panel = event.currentTarget as HTMLElement;
  const last = panel.querySelector('.workspace-browser-group:last-child');
  if (!last || event.clientY < last.getBoundingClientRect().bottom) return;
  event.preventDefault();
  event.stopPropagation();
  openTabSlot.value = undefined;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (event.type !== 'drop') return;
  const windowId = selectedWindow.value;
  commitDrop(async () => {
    const tab = await browser.tabs.get(source.id);
    if (tab.windowId !== windowId || tab.pinned) return;
    if ((tab.groupId ?? -1) !== -1) await browser.tabs.ungroup(source.id);
    await browser.tabs.move(source.id, { index: -1 });
  });
}
function dropOutsideGroup(groupId: number, after: boolean) {
  const source = drag.value;
  if (source?.kind !== 'tab') return;
  commitDrop(async () => {
    const group = await browser.tabGroups.get(groupId);
    const tab = await browser.tabs.get(source.id);
    if (tab.windowId !== group.windowId || tab.pinned) return;
    if ((tab.groupId ?? -1) !== -1) await browser.tabs.ungroup(source.id);
    const tabs = (await browser.tabs.query({ windowId: group.windowId }))
      .filter(item => item.id !== source.id).sort((a, b) => a.index - b.index);
    const members = tabs.filter(item => item.groupId === groupId);
    const edge = after ? members.at(-1) : members[0];
    if (edge) await browser.tabs.move(source.id, { index: tabs.indexOf(edge) + Number(after) });
  });
}
function dropOnTab(tab: BrowserTab, insertAfter?: boolean) {
  if (draggedGroup.value !== undefined) {
    dropGroup();
    return;
  }
  const value = drag.value;
  const targetId = openTabSlot.value ?? tab.id;
  if (
    value?.kind !== 'tab' ||
    targetId === undefined ||
    value.id === targetId
  ) {
    endDrag();
    return;
  }
  commitDrop(async () => {
    const [source, target] = await Promise.all([
      browser.tabs.get(value.id),
      browser.tabs.get(targetId),
    ]);
    const after = insertAfter ?? (source.windowId === target.windowId && source.index < target.index);
    if (source.groupId !== target.groupId) {
      if ((target.groupId ?? -1) === -1) await browser.tabs.ungroup(value.id);
      else await browser.tabs.group({ groupId: target.groupId, tabIds: [value.id] });
    }
    const remaining = (await browser.tabs.query({ windowId: target.windowId }))
      .filter(item => item.id !== value.id).sort((a, b) => a.index - b.index);
    const anchor = remaining.findIndex(item => item.id === targetId);
    if (anchor < 0) return;
    await browser.tabs.move(value.id, {
      ...(source.windowId !== target.windowId
        ? { windowId: target.windowId }
        : {}),
      index: anchor + Number(after),
    });
  });
}
const collectionList = ref<HTMLElement>();
const layoutMotion = useWorkspaceLayoutMotion(collectionList);
watch([activeSpace, query, dragVisualActive], layoutMotion.stop);
function switchView(mode: 'grid' | 'list') {
  if (viewMode.value === mode) return;
  void layoutMotion.changeLayout(() => { viewMode.value = mode; });
}
async function revealNewestCollection() {
  await nextTick();
  collectionList.value?.scrollTo({ top: 0 });
}
function showCreate() {
  if (isMarkedSpace.value) return;
  void run(async () => {
    destination.value = await createCollection('', [], activeSpace.value);
    query.value = '';
    await syncAfterDrop();
    await revealNewestCollection();
  });
}
async function edit(group: TabCollection) {
  editing.value = group.id;
  editName.value = group.name;
  await nextTick();
  editInput.value?.[0]?.focus();
  editInput.value?.[0]?.select();
}
async function rename(id: string) {
  if (editing.value !== id) return;
  const name = editName.value.trim();
  editing.value = '';
  if (
    !name ||
    collections.value.find((group) => group.id === id)?.name === name
  )
    return;
  try {
    await renameCollection(id, name);
  } catch (e) {
    showNotice(e instanceof Error ? e.message : '集合名称保存失败', 'alert');
  }
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
</script>

<template>
  <section
    class="workspace-board"
    @mousedown="!guestMode && pressSort($event)"
    :class="{ 'is-list-view': viewMode === 'list' }"
    aria-label="标签页管理"
    @click.stop="menu = ''"
    @pointerdown.stop
    @contextmenu.stop
    @dragover.capture="dropIntoSpace"
    @drop.capture="landing.track($event); dropIntoSpace($event)"
    @dragend="endDrag()"
    @keydown="workspaceKey"
    @keydown.esc="endDrag()"
  >
    <DesktopMenu
      label="我的空间"
      add-label="新建空间"
      :pinned="{ id: 'marked', name: '标记', icon: 'Star' }"
      :items="spaces"
      :active="activeSpace"
      visible
      :disabled="busy || loading || !!sortingSpaces"
      @select="switchSpace"
      @add="addSpace"
      @context="showSpaceMenu"
      @reorder="reorderSpaces"
    />
    <MenuEditorDialog
      :open="spaceForm"
      space
      :title="spaceEditing ? '编辑空间' : '添加空间'"
      :adding="!spaceEditing"
      v-model:name="spaceName"
      v-model:icon="spaceIcon"
      :busy="busy"
      :error="error"
      @close="spaceForm = false"
      @submit="submitSpace"
    />
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
    <BaseDialog
      solid
      close-button
      v-model:open="deletingSpace"
      title="删除空间"
    >
      <div class="workspace-space-confirm" role="alert">
        <p>删除此空间？集合会移回默认空间，保留其中的标签页。</p>
        <button
          class="workspace-button glass-control glass-interactive"
          :disabled="busy"
          @click="
            run(async () => {
              await deleteSpace(activeSpace);
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
    <header class="workspace-toolbar">
      <div class="workspace-heading">
        <button
          class="workspace-back glass-control glass-interactive"
          aria-label="返回桌面"
          title="返回桌面"
          @click="emit('close')"
        >
          <img
            src="/images/back.png"
            alt=""
            width="20"
            height="20"
            draggable="false"
          />
        </button>
        <div class="workspace-heading-copy">
          <PageIcon
            :name="isMarkedSpace ? 'Star' : currentSpace?.icon || 'Bookmark'"
            active
            :size="24"
          />
          <h1>
            {{ isMarkedSpace ? '标记' : currentSpace?.name || '我的空间' }}
          </h1>
        </div>
      </div>
      <slot name="toolbar-actions" />
      <label class="workspace-search glass-surface"
        ><Search aria-hidden="true" size="18" />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          placeholder="搜索集合、标签页或网址"
          aria-label="搜索工作区"
        /><kbd v-if="!query" aria-hidden="true">⌘ / Ctrl F</kbd
        ><button
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
          <div
            class="workspace-view-controls"
            role="group"
            aria-label="集合视图"
          >
            <div class="workspace-layout-switch glass-mode-switch glass-surface">
              <button
                aria-label="网格"
                title="网格"
                class="glass-control glass-interactive"
                :aria-pressed="viewMode === 'grid'"
                @click="switchView('grid')"
              >
                <img
                  class="workspace-action-icon"
                  src="/images/workspace/grid.png"
                  alt=""
                  draggable="false"
                />
              </button>
              <button
                aria-label="列表"
                title="列表"
                class="glass-control glass-interactive"
                :aria-pressed="viewMode === 'list'"
                @click="switchView('list')"
              >
                <img
                  class="workspace-action-icon"
                  src="/images/workspace/list.png"
                  alt=""
                  draggable="false"
                />
              </button>
            </div>
            <button
              class="workspace-button glass-control glass-interactive"
              :aria-label="collapseAction"
              :title="collapseAction"
              :disabled="!collections.length"
              @click="toggleAllCollections"
            >
              <img
                class="workspace-action-icon"
                src="/images/workspace/chevron.png"
                alt=""
                draggable="false"
                :style="{
                  transform: allCollapsed ? undefined : 'rotate(180deg)',
                }"
              />
            </button>
          </div>
          <div
            v-if="selectedEntries.length"
            class="workspace-selection glass-surface"
          >
            <span>选择 {{ selectedEntries.length }} 项</span>
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
              @click="selected.clear()"
            >
              取消选择
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
              v-account-edit @click="toggleSelectedMarks"
            >
              {{ allSelectedMarked ? '取消标记所选' : '标记所选' }}
            </button>
          </div>
          <button
            class="workspace-button glass-control glass-interactive"
            :disabled="busy || loading"
            v-if="!isMarkedSpace"
            v-account-edit @click="showCreate"
          >
            <PageIcon name="Add" :size="16" /> 新建集合
          </button>
        </header>
        <div
          ref="collectionList"
          class="workspace-collections"
          @dragover="handleCollectionListEnd"
          @drop="handleCollectionListEnd"
          :aria-busy="loading"
        >
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
              v-for="group in previewGroups"
              :key="group.id"
              class="workspace-collection"
              :class="{
                'is-drag-source':
                  dragVisualActive &&
                  drag?.kind === 'collection' &&
                  drag.id === group.id,
              }"
              :data-collection-id="group.id"
              @dragover="over($event, group.id)"
              @dragleave.self="dropTarget = ''"
              @drop.prevent.stop="drop(group.id, undefined, $event)"
            >
              <header class="workspace-collection-heading">
                <button
                  v-if="!isMarkedSpace"
                  v-account-edit class="workspace-icon collection-handle glass-control glass-interactive"
                  :draggable="!isMarkedSpace"
                  :aria-label="`拖动集合 ${group.name}`"
                  title="拖动集合排序"
                  @dragstart.stop="
                    startDrag($event, { kind: 'collection', id: group.id, spaceId: activeSpace })
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
                    @blur="rename(group.id)"
                  />
                </form>
                <button
                  v-else
                  class="workspace-collection-name"
                  :style="{
                    color: collectionColors[collectionColor(group.color)][1],
                  }"
                  :aria-expanded="!collapsed.has(group.id)"
                  @click="collapse(group.id)"
                >
                  <span>{{
                    isMarkedSpace
                      ? `${spaces.find((s) => s.id === (group.spaceId || 'default'))?.name || '个人空间'} / ${group.name}`
                      : group.name
                  }}</span
                  ><img
                    class="workspace-action-icon"
                    src="/images/workspace/chevron.png"
                    alt=""
                    draggable="false"
                    :class="{ folded: collapsed.has(group.id) }"
                  />
                </button>
                <div v-if="!isMarkedSpace" class="workspace-collection-actions">
                  <small>{{ group.tabs.length }}</small>
                  <button
                    class="workspace-icon glass-control glass-interactive"
                    :disabled="busy || !group.tabs.length"
                    :aria-label="`打开集合 ${group.name} 的全部标签页`"
                    title="全部打开"
                    @click="run(() => openCollection(group.id))"
                  >
                    <img
                      class="workspace-action-icon"
                      src="/images/workspace/open-all.png"
                      alt=""
                      draggable="false"
                    />
                  </button>
                  <button
                    class="workspace-icon glass-control glass-interactive"
                    aria-label="更多集合操作"
                    title="更多集合操作"
                    :aria-expanded="menu === 'collection:' + group.id"
                    @click.stop="
                      menu =
                        menu === 'collection:' + group.id
                          ? ''
                          : 'collection:' + group.id
                    "
                  >
                    <img
                      class="workspace-action-icon"
                      src="/images/workspace/more.png"
                      alt=""
                      draggable="false"
                    />
                  </button>
                  <div
                    v-if="menu === 'collection:' + group.id"
                    class="collection-more workspace-more-panel"
                  >
                    <div
                      class="collection-palette"
                      role="group"
                      aria-label="集合颜色"
                      @click.stop
                    >
                      <button
                        v-for="(swatch, color) in collectionColors"
                        :key="color"
                        type="button"
                        :title="swatch[0]"
                        :aria-label="swatch[0]"
                        :aria-pressed="collectionColor(group.color) === color"
                        :style="{ backgroundColor: swatch[1] }"
                        :disabled="busy"
                        v-account-edit @click="run(() => setCollectionColor(group.id, color))"
                      />
                    </div>
                    <button
                      class="glass-control glass-interactive"
                      v-account-edit @click="
                        edit(group);
                        menu = '';
                      "
                    >
                      重命名
                    </button>
                    <button
                      class="glass-control glass-interactive collection-delete"
                      :disabled="busy"
                      v-account-edit @click="
                        deleting = group.id;
                        menu = '';
                      "
                    >
                      删除集合
                    </button>
                  </div>
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
                    class="workspace-saved-tab glass-surface"
                    :class="{
                      'is-drag-source':
                        dragVisualActive &&
                        drag?.kind === 'saved' &&
                        drag.id === tab.id,
                      'transfer-out':
                        drag?.kind === 'saved' &&
                        drag.id === tab.id &&
                        drag.group === group.id &&
                        insertion &&
                        insertion.group !== group.id,
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
                    @drop.prevent.stop="drop(group.id, tab.id, $event)"
                  >
                    <WorkspaceCardMain
                      :title="tab.title"
                      :url="tab.url"
                      :icon="tab.icon"
                      @open="run(() => openSaved([tab]))"
                      ><template #checkbox>
                        <input
                          class="workspace-card-checkbox"
                          type="checkbox"
                          :checked="selected.has(tab.id)"
                          :aria-label="`选择标签页 ${tab.title}`"
                          @click.stop
                          @dragstart.prevent.stop
                          @change="toggleSelected(tab.id)"
                        />
                      </template>
                      <button
                        v-account-edit class="workspace-bookmark"
                        :aria-label="`标记收藏 ${tab.title}`"
                        :aria-pressed="!!tab.starred"
                        :disabled="busy"
                        title="标记收藏"
                        @dragstart.prevent.stop
                        @click.stop="
                          run(() =>
                            updateSavedTab(group.id, tab.id, {
                              starred: !tab.starred,
                            }),
                          )
                        "
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M6 4h12v16l-6-4-6 4Z"
                            :fill="tab.starred ? 'currentColor' : 'none'"
                          />
                        </svg>
                      </button>
                    </WorkspaceCardMain>
                    <div
                      class="workspace-card-actions"
                      @click.stop
                      @dragstart.prevent.stop
                    >
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
                        <img
                          class="workspace-action-icon"
                          src="/images/workspace/more.png"
                          alt=""
                          draggable="false"
                        />
                      </button>
                      <div
                        v-if="menu === tab.id"
                        class="workspace-card-menu workspace-more-panel"
                        @keydown.esc.stop="menu = ''"
                      >
                        <button
                          class="glass-control glass-interactive"
                          :disabled="busy"
                          v-account-edit @click="editTab(group.id, tab)"
                        >
                          修改
                        </button>
                        <select
                          v-if="!isMarkedSpace && collections.length > 1"
                          class="glass-control glass-interactive"
                          v-account-edit :aria-label="`移动收藏 ${tab.title}`"
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
                          v-account-edit :aria-label="`移除收藏 ${tab.title}`"
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
        @dragover="handleTabListEnd"
        @drop="handleTabListEnd"
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
          class="workspace-open-tabs"
          @dragover.capture="trackGroup"
          @drop.capture="finishGroup"
          :aria-busy="tabsLoading"
        >
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
              v-for="(group, index) in previewBrowserGroups"
              :key="group.key"
              class="workspace-browser-group"
              :class="{
                'is-drag-source': dragVisualActive && draggedGroup?.key === group.key,
              }"
              :data-section-key="group.key"
              :data-group-color="group.color"
              :data-group-id="group.id"
              :aria-label="group.label"
              @dragover.self="openTabGap($event, group.tabs)"
              @drop.self="openTabGap($event, group.tabs, true)"
            >
              <template v-if="drag?.kind === 'tab' && group.id !== -1">
                <div v-if="index === 0" key="before"
                  class="workspace-group-edge before"
                  @dragover.prevent.stop="openTabSlot = undefined"
                  aria-hidden="true"
                  @drop.prevent.stop="dropOutsideGroup(group.id, false)" />
                <div v-if="previewBrowserGroups[index + 1]?.id !== -1" key="after"
                  class="workspace-group-edge after"
                  @dragover.prevent.stop="openTabSlot = undefined"
                  aria-hidden="true"
                  @drop.prevent.stop="dropOutsideGroup(group.id, true)" />
              </template>
              <h3 key="heading" class="workspace-window-label"
                @dragover="group.id === -1 && openTabGap($event, group.tabs)"
                @drop="group.id === -1 && openTabGap($event, group.tabs, true)">
                <button
                  v-account-edit class="workspace-group-handle glass-control glass-interactive"
                  draggable="true"
                  :disabled="busy"
                  :aria-label="`拖动群组 ${group.label}`"
                  title="拖动群组排序"
                  @dragstart.stop="startGroupDrag($event, group)"
                >
                  ⠿
                </button>
                <button
                  class="workspace-group-toggle"
                  :aria-label="`折叠群组 ${group.label}`"
                  :aria-expanded="!group.collapsed"
                  :disabled="busy"
                  @click="(group.id === -1 || requireAccount()) && run(() => toggleBrowserGroup(group.id, group.key))"
                >
                  {{ group.label }}
                  <img
                    class="workspace-action-icon"
                    src="/images/workspace/chevron.png"
                    alt=""
                    draggable="false"
                    :class="{ folded: group.collapsed }"
                  />
                </button>
                <span>{{ group.tabs.length }}</span>
                <button
                  v-account-edit class="workspace-group-save glass-control glass-interactive"
                  :aria-label="`保存群组 ${group.label} 为集合`"
                  title="保存为集合并关闭已保存的标签页"
                  :disabled="busy || loading"
                  @click.stop="
                    run(async () => {
                      await saveBrowserGroup(group.id, group.tabs);
                      await revealNewestCollection();
                    })
                  "
                >
                  <img
                    class="workspace-action-icon"
                    src="/images/workspace/save-group.png"
                    alt=""
                    draggable="false"
                  />
                </button>
              </h3>
              <div
                v-for="tab in group.collapsed
                  ? []
                  : previewOpenTabs(group.tabs)"
                :key="tab.id"
                class="workspace-open-tab glass-surface"
                :class="{
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
                @dragover="overOpenTab($event, tab)"
                @drop.prevent.stop="dropOnTab(tab)"
              >
                <span class="workspace-icon-slot">
                  <WorkspaceFavicon
                    :src="tab.favIconUrl"
                    :page-url="tab.pendingUrl || tab.url"
                    :title="tabTitle(tab)"
                  />
                  <input
                    class="workspace-card-checkbox"
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
                </span>
                <button
                  class="workspace-link glass-control"
                  :title="tabTitle(tab)"
                  @click="run(() => activate(tab))"
                >
                  <span>
                    <strong>{{ tabTitle(tab) }}</strong>
                    <small :title="tab.pendingUrl || tab.url">{{ tab.pendingUrl || tab.url }}</small>
                  </span>
                </button>
                <button
                  v-account-edit
                  type="button"
                  class="workspace-open-tab-close"
                  :aria-label="`关闭标签页 ${tabTitle(tab)}`"
                  title="关闭标签页"
                  :disabled="busy || tab.id === undefined"
                  @pointerdown.stop
                  @dragstart.prevent.stop
                  @click.stop="closeOpenTab(tab.id)"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </ReorderTransition>
          </ReorderTransition>
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
            v-account-edit @click="run(() => actOnBrowserSelection('group'))"
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
            v-account-edit @click="run(() => actOnBrowserSelection('ungroup'))"
          >
            取消群组
          </button>
          <button
            class="glass-control glass-interactive"
            :disabled="busy"
            title="关闭所选浏览器标签页"
            v-account-edit @click="run(() => actOnBrowserSelection('close'))"
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
      </aside>
    </div>
    <BaseDialog
      solid
      close-button
      v-model:open="editTabOpen"
      title="修改标签页"
    >
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
        @click="dismissNotice"
      >
        ×
      </button>
    </div>
  </section>
</template>
