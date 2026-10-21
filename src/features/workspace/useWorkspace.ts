import { computed, onMounted, onUnmounted, ref } from 'vue';
import { liveQuery } from 'dexie';
import { browser, type Browser } from 'wxt/browser';
import {
  database,
  type SavedTab,
  type TabCollection,
} from '../../shared/storage/database';
import { addTabs, createCollection, webUrl } from './collections';

export type BrowserTab = Browser.tabs.Tab;

export function useWorkspace() {
  const collections = ref<TabCollection[]>([]);
  const tabs = ref<BrowserTab[]>([]);
  const loading = ref(true);
  const tabsLoading = ref(true);
  const needsTabPermission = ref(false);
  const tabTitle = (tab: BrowserTab) =>
    tab.title?.trim() || tab.pendingUrl || tab.url || '无法读取标签页信息';
  const query = ref('');
  const allWindows = ref(false);
  const destination = ref('');
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
        (allWindows.value || t.windowId === owner?.windowId) &&
        matches(t.title || '', t.url || t.pendingUrl || ''),
    ),
  );
  const windows = computed(() =>
    [...new Set(visibleTabs.value.map((t) => t.windowId))].map((id, index) => ({
      id,
      label: id === owner?.windowId ? '当前窗口' : `窗口 ${index + 1}`,
      tabs: visibleTabs.value.filter((t) => t.windowId === id),
    })),
  );
  const savedCount = computed(() =>
    collections.value.reduce((n, c) => n + c.tabs.length, 0),
  );
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
      const result = await browser.tabs.query({ windowType: 'normal' });
      if (disposed || request !== generation) return;
      needsTabPermission.value = !permitted;
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
      );
      notice.value = '已保存到「稍后处理」';
    } else {
      const count = await addTabs(group, entries, before);
      notice.value = count ? `已保存 ${count} 个标签页` : '这些网页已在集合中';
    }
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
      await database.tabCollections.add(previous);
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
    subscription = liveQuery(() =>
      database.tabCollections.orderBy('order').toArray(),
    ).subscribe({
      next(value) {
        collections.value = value;
        if (!value.some((c) => c.id === destination.value))
          destination.value = value[0]?.id || '';
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
    await refresh();
  });
  onUnmounted(() => {
    disposed = true;
    clearTimeout(timer);
    subscription?.unsubscribe();
    browser.tabs.onCreated.removeListener(schedule);
    browser.tabs.onRemoved.removeListener(schedule);
    browser.tabs.onUpdated.removeListener(schedule);
    browser.tabs.onMoved.removeListener(schedule);
    browser.tabs.onAttached.removeListener(schedule);
    browser.tabs.onDetached.removeListener(schedule);
    browser.tabs.onActivated.removeListener(schedule);
  });
  return {
    collections,
    visibleCollections,
    visibleTabs,
    windows,
    savedCount,
    loading,
    tabsLoading,
    needsTabPermission,
    requestTabPermission,
    tabTitle,
    query,
    allWindows,
    destination,
    notice,
    error,
    busy,
    undo,
    run,
    save,
    snapshot,
    activate,
    close,
    openSaved,
    removeGroup,
    removeTab,
    undoDelete,
  };
}
