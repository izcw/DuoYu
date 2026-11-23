import {
  collectionColor,
  type CollectionColor,
} from '../../shared/collection-colors';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { browser, type Browser } from 'wxt/browser';
import {
  database,
  type SavedTab,
  type TabCollection,
  type WorkspaceSpace,
} from '../../shared/storage/database';
import { addTabs, createCollection, removeCollection, restoreCollection, webUrl } from './collections';
import { ensureDefaultSpace } from './spaces';
import type { WorkspaceUndo } from '../sync/capture';

export type BrowserTab = Browser.tabs.Tab;

export function useWorkspace() {
  const allCollections = ref<TabCollection[]>([]);
  const spaces = ref<WorkspaceSpace[]>([]);
  const activeSpace = ref('');
  const isMarkedSpace = computed(() => activeSpace.value === 'marked');
  const collections = computed(() =>
    isMarkedSpace.value
      ? allCollections.value
          .map((c) => ({ ...c, tabs: c.tabs.filter((tab) => tab.starred) }))
          .filter((c) => c.tabs.length)
      : allCollections.value.filter(
          (c) => (c.spaceId || 'default') === activeSpace.value,
        ),
  );
  const currentSpace = computed(() =>
    isMarkedSpace.value
      ? { id: 'marked', name: '标记', order: -1 }
      : spaces.value.find((s) => s.id === activeSpace.value),
  );
  const tabs = ref<BrowserTab[]>([]);
  const openTabUrls = computed<Set<string>>(previous => {
    const urls = new Set<string>();
    for (const tab of tabs.value) {
      const url = webUrl(tab.pendingUrl || tab.url || '');
      if (url) urls.add(url);
    }
    return previous && previous.size === urls.size && [...urls].every(url => previous.has(url)) ? previous : urls;
  });
  const loading = ref(true);
  const tabsLoading = ref(true);
  const needsTabPermission = ref(false);
  function pageName(title: string | undefined, url: string) {
    const name = title?.trim();
    if (!name || /^(https?|chrome|about|edge|file):/i.test(name)) return '';
    try {
      const address = new URL(url);
      const bare = (value: string) => value.replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
      if ([address.hostname, address.host, address.href.slice(address.protocol.length + 2)].some(value => bare(value) === bare(name))) return '';
    } catch { /* A title can arrive before the URL is available. */ }
    return name;
  }
  const savedNames = computed(() => {
    const names = new Map<string, string>();
    for (const collection of allCollections.value) {
      for (const entry of collection.tabs) {
        const name = pageName(entry.title, entry.url);
        if (name && name !== '未命名网页') names.set(webUrl(entry.url) ?? entry.url, name);
      }
    }
    return names;
  });
  function tabTitle(tab: BrowserTab) {
    const url = tab.pendingUrl || tab.url || '';
    return pageName(tab.title, url) || savedNames.value.get(webUrl(url) ?? url) || '未命名网页';
  }
  const query = ref('');
  const selectedWindow = ref<number>();
  const windowOptions = ref<{ id: number; label: string }[]>([]);
  const browserGroups = ref<Browser.tabGroups.TabGroup[]>([]);
  const destination = ref('');
  watch(collections, (value) => {
    if (!value.some((c) => c.id === destination.value))
      destination.value = value[0]?.id || '';
  });
  watch(activeSpace, (_, previousSpace) => {
    if (previousSpace) query.value = '';
  });
  const notice = ref('');
  const error = ref('');
  let noticeTimer: ReturnType<typeof setTimeout>;
  function dismissNotice() {
    clearTimeout(noticeTimer);
    notice.value = '';
    error.value = '';
  }
  function showNotice(message: string, role: 'status' | 'alert' = 'status') {
    if (disposed) return;
    dismissNotice();
    if (role === 'alert') error.value = message;
    else notice.value = message;
    noticeTimer = setTimeout(dismissNotice, 3000);
  }
  const busy = ref(false);
  const undo = ref<{ intent: WorkspaceUndo; apply: () => Promise<void> } | null>(null);
  let owner: BrowserTab | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let subscription: { unsubscribe(): void } | undefined;
  const matches = (title: string, url = '') =>
    `${title} ${url}`
      .toLocaleLowerCase()
      .includes(query.value.trim().toLocaleLowerCase());
  const visibleCollections = computed(() =>
    collections.value
      .map((c) => ({
        ...c,
        tabs: matches(c.name)
          ? c.tabs
          : c.tabs.filter((t) => matches(t.title, t.url)),
      }))
      .filter((c) => !query.value.trim() || matches(c.name) || c.tabs.length),
  );
  const visibleTabs = computed(() =>
    tabs.value.filter(
      (t) =>
        t.windowId === selectedWindow.value &&
        matches(tabTitle(t), t.pendingUrl || t.url || ''),
    ),
  );
  const collapsedUngrouped = ref(new Set<string>());
  const tabGroups = computed(() => {
    const groups: {
      id: number;
      key: string;
      label: string;
      color: string;
      collapsed: boolean;
      tabs: BrowserTab[];
    }[] = [];
    for (const tab of tabs.value) {
      if (tab.windowId !== selectedWindow.value) continue;
      const id = tab.groupId ?? -1;
      let group = groups.at(-1);
      if (group?.id !== id) group = undefined;
      if (!group) {
        const metadata = browserGroups.value.find((g) => g.id === id);
        const key = id === -1 ? `ungrouped-${tab.id}` : `group-${id}`;
        group = {
          id,
          key,
          label: id === -1 ? '未分组' : metadata?.title || '未命名群组',
          color: metadata?.color || 'grey',
          collapsed: id === -1 ? collapsedUngrouped.value.has(key) : !!metadata?.collapsed,
          tabs: [],
        };
        groups.push(group);
      }
      group.tabs.push(tab);
    }
    if (!query.value.trim()) return groups;
    const visible = new Set(visibleTabs.value.map(tab => tab.id));
    return groups.map(group => ({
      ...group, tabs: group.tabs.filter(tab => visible.has(tab.id)),
    })).filter(group => group.tabs.length);

  });
  const savedCount = computed(() =>
    collections.value.reduce((n, c) => n + c.tabs.length, 0),
  );
  async function syncCollections() {
    allCollections.value = await database.tabCollections
      .orderBy('order')
      .toArray();
  }
  async function syncAfterDrop() {
    await syncCollections();
    await refresh();
  }
  async function run(action: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await action();
    } catch (e) {
      showNotice(e instanceof Error ? e.message : '操作失败，请重试', 'alert');
    } finally {
      busy.value = false;
    }
  }
  async function refresh() {
    const request = ++generation;
    try {
      const permitted = await browser.permissions.contains({
        permissions: ['tabs'],
      });
      const [result, openWindows, groups] = await Promise.all([
        browser.tabs.query({ windowType: 'normal' }),
        browser.windows.getAll({ windowTypes: ['normal'] }),
        browser.tabGroups.query({}),
      ]);
      if (disposed || request !== generation) return;
      needsTabPermission.value = !permitted;
      browserGroups.value = groups;
      windowOptions.value = openWindows
        .filter((w) => w.id !== undefined && w.incognito === !!owner?.incognito)
        .sort((a, b) => a.id! - b.id!)
        .map((w, index) => ({
          id: w.id!,
          label: `窗口 ${index + 1}${w.id === owner?.windowId ? '（当前）' : ''}`,
        }));
      if (!windowOptions.value.some((w) => w.id === selectedWindow.value))
        selectedWindow.value =
          windowOptions.value.find((w) => w.id === owner?.windowId)?.id ??
          windowOptions.value[0]?.id;
      const prefix = browser.runtime.getURL('/');
      tabs.value = result
        .filter(
          (t) =>
            t.id !== owner?.id &&
            t.incognito === !!owner?.incognito &&
            !(t.url || t.pendingUrl || '').startsWith(prefix),
        )
        .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
    } catch {
      if (!disposed)
        showNotice('无法读取标签页，请重新加载扩展并允许读取标签页信息。', 'alert');
    } finally {
      if (!disposed) tabsLoading.value = false;
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 60);
  }
  async function requestTabPermission() {
    const granted = await browser.permissions.request({
      permissions: ['tabs'],
    });
    if (!granted)
      throw new Error(
        '需要标签页权限才能显示网页标题和图标。请重新加载扩展并允许该权限。',
      );
    await refresh();
  }
  function snapshot(tab: BrowserTab): SavedTab | null {
    const url = webUrl(tab.pendingUrl || tab.url || '');
    return url
      ? {
          id: crypto.randomUUID(),
          title: tabTitle(tab),
          url,
          icon: tab.favIconUrl || '',
          savedAt: Date.now(),
        }
      : null;
  }
  async function saveAndCloseTab(tab: BrowserTab, space: string, group?: string, before?: string) {
    const entry = snapshot(tab);
    if (!entry) throw new Error('没有可保存的网页，浏览器内部页面暂不支持收藏。');
    const collectionId = await database.transaction('rw', database.tabCollections, database.workspaceSpaces, async () => {
      const target = group ?? (await database.tabCollections.filter(c =>
        (c.spaceId || 'default') === space && c.name === '稍后处理',
      ).first())?.id;
      if (!target) return createCollection('稍后处理', [entry], space);
      await addTabs(target, [entry], before);
      return target;
    });
    destination.value = collectionId;
    showNotice('标签页已保存到集合');
    if (tab.id !== undefined && tab.id !== owner?.id) {
      try {
        const current = (await browser.tabs.query({ windowId: tab.windowId })).find(t => t.id === tab.id);
        if (current && typeof current.id === 'number' && webUrl(current.pendingUrl || current.url || '') === entry.url) {
          await browser.tabs.remove(current.id);
          showNotice('已保存并关闭标签页');
        }
      } catch {
        throw new Error('标签页已保存，关闭原标签页时遇到错误');
      }
    }
    return collectionId;
  }
  async function toggleBrowserGroup(id: number, key: string) {
    if (id === -1) {
      if (collapsedUngrouped.value.has(key)) collapsedUngrouped.value.delete(key);
      else collapsedUngrouped.value.add(key);
      return;
    }
    const group = await browser.tabGroups.get(id);
    await browser.tabGroups.update(id, { collapsed: !group.collapsed });
    await refresh();
  }
  async function saveBrowserGroup(id: number, section: BrowserTab[], targetSpace = isMarkedSpace.value ? 'default' : activeSpace.value) {
    const windowId = section[0]?.windowId;
    if (windowId === undefined) return;
    const sectionIds = new Set(section.map(tab => tab.id));
    const members = (await browser.tabs.query({ windowId })).filter(
      tab => (tab.groupId ?? -1) === id && (id !== -1 || sectionIds.has(tab.id)),
    );
    const group = browserGroups.value.find(group => group.id === id);
    const entries: SavedTab[] = [];
    const savedUrls = new Map<number, string>();
    for (const tab of members.sort((a, b) => a.index - b.index)) {
      const entry = snapshot(tab);
      if (!entry) continue;
      entries.push(entry);
      if (tab.id !== undefined && tab.id !== owner?.id) savedUrls.set(tab.id, entry.url);
    }
    if (!entries.length) throw new Error('此群组没有可保存的网页');
    const name = id === -1 ? '未分组' : group?.title?.trim() || '未命名群组';
    const collectionId = await createCollection(name, entries, targetSpace, group ? collectionColor(group.color) : undefined);
    activeSpace.value = targetSpace;
    query.value = '';
    let closed = 0;
    try {
      const current = await browser.tabs.query({ windowId });
      const ids: number[] = [];
      for (const tab of current) {
        if (tab.id === undefined || (tab.groupId ?? -1) !== id) continue;
        const savedUrl = savedUrls.get(tab.id);
        if (savedUrl && savedUrl === webUrl(tab.pendingUrl || tab.url || '')) ids.push(tab.id);
      }
      if (ids.length) await browser.tabs.remove(ids);
      closed = ids.length;
    } catch {
      throw new Error(`集合「${name}」已保存，关闭原标签页时遇到错误`);
    } finally {
      await syncAfterDrop();
      destination.value = collectionId;
    }
    showNotice(`已保存为集合「${name}」，共 ${entries.length} 个标签页，已关闭 ${closed} 个`);
    return collectionId;
  }
  async function activate(tab: BrowserTab) {
    if (tab.id === undefined) return;
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  }
  async function close(tab: BrowserTab) {
    if (tab.id !== undefined && tab.id !== owner?.id)
      await browser.tabs.remove(tab.id);
  }
  async function openSaved(
    entries: SavedTab[],
    groupName?: string,
    color: CollectionColor = 'grey',
  ) {
    const ids: number[] = [];
    for (const tab of entries) {
      const url = webUrl(tab.url);
      if (!url) continue;
      const opened = await browser.tabs.create({
        url,
        active: false,
        windowId: owner?.windowId,
      });
      if (opened.id !== undefined) ids.push(opened.id);
    }
    if (groupName !== undefined && ids.length) {
      const groupId = await browser.tabs.group({
        tabIds: ids as [number, ...number[]],
        createProperties: { windowId: owner?.windowId },
      });
      await browser.tabGroups.update(groupId, { title: groupName, color });
      showNotice(`已在「${groupName}」标签组中打开 ${ids.length} 个标签页`);
    } else showNotice(`已在后台打开 ${ids.length} 个标签页`);
  }
  async function openCollection(id: string) {
    const collection = await database.tabCollections.get(id);
    if (!collection) throw Error('集合已不存在');
    await openSaved(
      collection.tabs,
      collection.name,
      collectionColor(collection.color),
    );
  }
  async function removeGroup(id: string) {
    const previous = await removeCollection(id);
    undo.value = {
      intent: { collection: id, spaceId: previous.spaceId },
      apply: () => restoreCollection(previous),
    };
    showNotice(`已删除「${previous.name}」`);
  }
  async function removeTab(group: string, id: string) {
    let previous: SavedTab | undefined;
    let index = 0;
    await database.transaction('rw', database.tabCollections, async () => {
      const c = await database.tabCollections.get(group);
      if (!c) return;
      index = c.tabs.findIndex((t) => t.id === id);
      if (index < 0) return;
      [previous] = c.tabs.splice(index, 1);
      c.updatedAt = Date.now();
      await database.tabCollections.put(c);
    });
    if (!previous) return;
    const saved = previous;
    undo.value = {
      intent: { tab: id, position: index },
      apply: async () => {
        const c = await database.tabCollections.get(group);
        if (!c) throw new Error('原集合已被删除，无法撤销');
        if (!c.tabs.some((t) => t.id === saved.id))
          c.tabs.splice(Math.min(index, c.tabs.length), 0, saved);
        await database.tabCollections.put(c);
      },
    };
    showNotice('已移除收藏');
  }
  async function undoDelete() {
    const action = undo.value;
    if (!action) return;
    await database.transaction('rw', database.tabCollections, database.workspaceSpaces, async tx => {
      Object.assign(tx.idbtrans!, { workspaceUndo: { ...action.intent } });
      await action.apply();
    });
    undo.value = null;
    showNotice('已恢复');
  }
  onMounted(async () => {
    try {
      await ensureDefaultSpace();
    } catch {
      showNotice('空间初始化失败，请重新打开工作区', 'alert');
    }
    if (disposed) return;
    subscription = liveQuery(async () => ({
      groups: await database.tabCollections.orderBy('order').toArray(),
      spaces: await database.workspaceSpaces.orderBy('order').toArray(),
    })).subscribe({
      next(value) {
        allCollections.value = value.groups;
        spaces.value = value.spaces;
        if (
          !activeSpace.value ||
          (activeSpace.value !== 'marked' &&
            !value.spaces.some((s) => s.id === activeSpace.value))
        )
          activeSpace.value = value.spaces[0]?.id || '';
        loading.value = false;
      },
      error() {
        showNotice('集合读取失败，请检查本地存储后重新打开工作区', 'alert');
        loading.value = false;
      },
    });
    try {
      owner = await browser.tabs.getCurrent();
    } catch {
      showNotice('无法确定当前窗口', 'alert');
    }
    if (disposed) return;
    browser.tabs.onCreated.addListener(schedule);
    browser.tabs.onRemoved.addListener(schedule);
    browser.tabs.onUpdated.addListener(schedule);
    browser.tabs.onMoved.addListener(schedule);
    browser.tabs.onAttached.addListener(schedule);
    browser.tabs.onDetached.addListener(schedule);
    browser.tabs.onActivated.addListener(schedule);
    browser.windows.onCreated.addListener(schedule);
    browser.windows.onRemoved.addListener(schedule);
    browser.tabGroups.onCreated.addListener(schedule);
    browser.tabGroups.onRemoved.addListener(schedule);
    browser.tabGroups.onUpdated.addListener(schedule);
    browser.tabGroups.onMoved.addListener(schedule);
    await refresh();
  });
  onUnmounted(() => {
    disposed = true;
    clearTimeout(noticeTimer);
    clearTimeout(timer);
    subscription?.unsubscribe();
    browser.tabGroups.onMoved.removeListener(schedule);
    browser.tabGroups.onUpdated.removeListener(schedule);
    browser.tabGroups.onRemoved.removeListener(schedule);
    browser.tabGroups.onCreated.removeListener(schedule);
    browser.windows.onRemoved.removeListener(schedule);
    browser.windows.onCreated.removeListener(schedule);
    browser.tabs.onCreated.removeListener(schedule);
    browser.tabs.onRemoved.removeListener(schedule);
    browser.tabs.onUpdated.removeListener(schedule);
    browser.tabs.onMoved.removeListener(schedule);
    browser.tabs.onAttached.removeListener(schedule);
    browser.tabs.onDetached.removeListener(schedule);
    browser.tabs.onActivated.removeListener(schedule);
  });
  return {
    spaces,
    syncAfterDrop,
    syncCollections,
    isMarkedSpace,
    activeSpace,
    currentSpace,
    collections,
    visibleCollections,
    openTabUrls,
    visibleTabs,
    windowOptions,
    tabGroups,
    savedCount,
    loading,
    tabsLoading,
    needsTabPermission,
    requestTabPermission,
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
    snapshot,
    activate,
    toggleBrowserGroup,
    saveBrowserGroup,
    close,
    openSaved,
    openCollection,
    removeGroup,
    removeTab,
    undoDelete,
  };
}
