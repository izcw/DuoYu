import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { browser, type Browser } from 'wxt/browser';
import {
  database,
  type SavedTab,
  type TabCollection,
  type WorkspaceSpace,
} from '../../shared/storage/database';
import { addTabs, createCollection, webUrl } from './collections';
import { ensureDefaultSpace } from './spaces';

export type BrowserTab = Browser.tabs.Tab;

export function useWorkspace() {
  const allCollections = ref<TabCollection[]>([]);
  const spaces = ref<WorkspaceSpace[]>([]);
  const activeSpace = ref('default');
  try {
    activeSpace.value = localStorage.getItem('duoyu:active-space') || 'default';
  } catch {
    /* Optional preference. */
  }
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
  const loading = ref(true);
  const tabsLoading = ref(true);
  const needsTabPermission = ref(false);
  const tabTitle = (tab: BrowserTab) =>
    tab.title?.trim() || tab.pendingUrl || tab.url || '无法读取标签页信息';
  const query = ref('');
  const selectedWindow = ref<number>();
  const windowOptions = ref<{ id: number; label: string }[]>([]);
  const browserGroups = ref<Browser.tabGroups.TabGroup[]>([]);
  const destination = ref('');
  watch(collections, (value) => {
    if (!value.some((c) => c.id === destination.value))
      destination.value = value[0]?.id || '';
  });
  watch(activeSpace, (id) => {
    query.value = '';
    try {
      localStorage.setItem('duoyu:active-space', id);
    } catch {
      /* Optional preference. */
    }
  });
  const notice = ref('');
  const error = ref('');
  const busy = ref(false);
  const undo = ref<(() => Promise<void>) | null>(null);
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
        matches(t.title || '', t.url || t.pendingUrl || ''),
    ),
  );
  const tabGroups = computed(() => {
    const groups: {
      id: number;
      key: string;
      label: string;
      color: string;
      collapsed: boolean;
      tabs: BrowserTab[];
    }[] = [];
    for (const tab of visibleTabs.value) {
      const id = tab.groupId ?? -1;
      let group = groups.at(-1);
      if (group?.id !== id) group = undefined;
      if (!group) {
        const metadata = browserGroups.value.find((g) => g.id === id);
        group = {
          id,
          key: id === -1 ? `ungrouped-${tab.id}` : `group-${id}`,
          label: id === -1 ? '未分组' : metadata?.title || '未命名群组',
          color: metadata?.color || 'grey',
          collapsed: metadata?.collapsed || false,
          tabs: [],
        };
        groups.push(group);
      }
      group.tabs.push(tab);
    }
    return groups;
  });
  const savedCount = computed(() =>
    collections.value.reduce((n, c) => n + c.tabs.length, 0),
  );
  async function syncAfterDrop() {
    allCollections.value = await database.tabCollections
      .orderBy('order')
      .toArray();
    await refresh();
  }
  async function run(action: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await action();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '操作失败，请重试';
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
        error.value = '无法读取标签页，请重新加载扩展并允许读取标签页信息。';
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
          title: tab.title || url,
          url,
          icon: tab.favIconUrl || '',
          savedAt: Date.now(),
        }
      : null;
  }
  async function save(
    tabsToSave: BrowserTab[],
    group = destination.value,
    before?: string,
  ) {
    const entries = tabsToSave.map(snapshot).filter((t): t is SavedTab => !!t);
    if (!entries.length)
      throw new Error('没有可保存的网页，浏览器内部页面暂不支持收藏。');
    if (!group) {
      destination.value = await createCollection(
        '稍后处理',
        entries.filter(
          (t, i, all) => all.findIndex((a) => a.url === t.url) === i,
        ),
        activeSpace.value,
      );
      notice.value = '已保存到「稍后处理」';
    } else {
      const count = await addTabs(group, entries, before);
      notice.value = count ? `已保存 ${count} 个标签页` : '这些网页已在集合中';
    }
  }
  async function toggleBrowserGroup(id: number) {
    const group = await browser.tabGroups.get(id);
    await browser.tabGroups.update(id, { collapsed: !group.collapsed });
    await refresh();
  }
  async function saveBrowserGroup(id: number) {
    const targetSpace = isMarkedSpace.value ? 'default' : activeSpace.value;
    const group = await browser.tabGroups.get(id);
    const members = await browser.tabs.query({ groupId: id });
    const entries = members
      .sort((a, b) => a.index - b.index)
      .map(snapshot)
      .filter((tab): tab is SavedTab => !!tab);
    if (!entries.length) throw new Error('此群组没有可保存的网页');
    const name = group.title?.trim() || '未命名群组';
    await createCollection(name, entries, targetSpace);
    notice.value = `已保存为集合「${name}」${isMarkedSpace.value ? '（个人空间）' : ''}`;
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
  async function openSaved(entries: SavedTab[]) {
    let opened = 0;
    for (const tab of entries) {
      const url = webUrl(tab.url);
      if (!url) continue;
      await browser.tabs.create({
        url,
        active: false,
        windowId: owner?.windowId,
      });
      opened++;
    }
    notice.value = `已在后台打开 ${opened} 个标签页`;
  }
  async function removeGroup(id: string) {
    const previous = await database.tabCollections.get(id);
    if (!previous) return;
    await database.tabCollections.delete(id);
    undo.value = async () => {
      await database.transaction(
        'rw',
        database.tabCollections,
        database.workspaceSpaces,
        async () => {
          const space = await database.workspaceSpaces.get(
            previous.spaceId || 'default',
          );
          await database.tabCollections.add({
            ...previous,
            spaceId: space?.id || 'default',
          });
        },
      );
    };
    notice.value = `已删除「${previous.name}」`;
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
    undo.value = async () => {
      await database.transaction('rw', database.tabCollections, async () => {
        const c = await database.tabCollections.get(group);
        if (!c) throw new Error('原集合已被删除，无法撤销');
        if (!c.tabs.some((t) => t.id === saved.id))
          c.tabs.splice(Math.min(index, c.tabs.length), 0, saved);
        await database.tabCollections.put(c);
      });
    };
    notice.value = '已移除收藏';
  }
  async function undoDelete() {
    await undo.value?.();
    undo.value = null;
    notice.value = '已恢复';
  }
  onMounted(async () => {
    try {
      await ensureDefaultSpace();
    } catch {
      error.value = '空间初始化失败，请重新打开工作区';
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
          activeSpace.value !== 'marked' &&
          !value.spaces.some((s) => s.id === activeSpace.value)
        )
          activeSpace.value = 'default';
        loading.value = false;
      },
      error() {
        error.value = '集合读取失败，请检查本地存储后重新打开工作区';
        loading.value = false;
      },
    });
    try {
      owner = await browser.tabs.getCurrent();
    } catch {
      error.value = '无法确定当前窗口';
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
    requestTabPermission,
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
    snapshot,
    activate,
    toggleBrowserGroup,
    saveBrowserGroup,
    close,
    openSaved,
    removeGroup,
    removeTab,
    undoDelete,
  };
}
