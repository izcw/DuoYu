<script setup lang="ts">
import { accountStorage } from '../../shared/storage/account';
import { truncateLinkTitle } from './link-title';
import LinkIconEditor from './LinkIconEditor.vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { browser } from 'wxt/browser';
import { database, type LibraryItem } from '../../shared/storage/database';
import { webUrl } from '../workspace/collections';
import {
  saveLibraryItem,
  moveLibraryItem,
  deleteLibraryItem,
  type LibraryDraft,
} from './library';
import './library.css';
import { isWallpaperBlank } from '../wallpaper/blank-area';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import DesktopTools from '../desktop/DesktopTools.vue';
import { backupDesktop } from '../desktop/desktop-backup';
import LibraryGrid from './LibraryGrid.vue';
import { LIBRARY_GRID_ROWS } from './grid-config';
import { mergeLibraryLinks } from './library';
defineEmits<{ close: [] }>();
const props = withDefaults(
  defineProps<{
    pageId?: string;
    embedded?: boolean;
    title?: string;
    rows?: number;
    alignment?: 'center' | 'end';
  }>(),
  {
    pageId: 'default',
    embedded: false,
    title: '收藏库',
    rows: LIBRARY_GRID_ROWS,
    alignment: 'center',
  },
);
const board = ref<HTMLElement>();
const gridView = ref<InstanceType<typeof LibraryGrid>>();
const insertionPoint = ref<{ x: number; y: number }>();
const tool = ref<'' | 'widgets' | 'wallpaper' | 'search' | 'settings'>('');
const automatic = ref(
  accountStorage.getItem('duoyu-layout-' + props.pageId) === 'auto',
);
watch(automatic, (value) =>
  accountStorage.setItem(
    'duoyu-layout-' + props.pageId,
    value ? 'auto' : 'free',
  ),
);
function cloudLayout() {
  automatic.value =
    accountStorage.getItem('duoyu-layout-' + props.pageId) === 'auto';
}
onMounted(() => window.addEventListener('duoyu-sync-preferences', cloudLayout));
onUnmounted(() =>
  window.removeEventListener('duoyu-sync-preferences', cloudLayout),
);
function newPosition(width: number, height: number) {
  return gridView.value!.placement(insertionPoint.value, width, height);
}
const context = ref<{ x: number; y: number }>();
const contextMenu = ref<HTMLElement>();
function containInteraction(event: MouseEvent) {
  if (!isWallpaperBlank(event.target, event)) event.stopPropagation();
}
async function showContext(event: MouseEvent) {
  if (isWallpaperBlank(event.target, event)) return;
  event.stopPropagation();
  if ((event.target as Element).closest('input, textarea, select')) return;
  event.preventDefault();
  insertionPoint.value = { x: event.clientX, y: event.clientY };
  context.value = {
    x: Math.max(8, Math.min(event.clientX, innerWidth - 196)),
    y: Math.max(8, Math.min(event.clientY, innerHeight - 390)),
  };
  await nextTick();
  contextMenu.value?.focus({ preventScroll: true });
}
function dismissContext(event?: Event) {
  if (
    event?.target instanceof Element &&
    event.target.closest('.library-context-menu')
  )
    return;
  context.value = undefined;
}
function contextKey(event: KeyboardEvent) {
  if (!context.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    context.value = undefined;
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const buttons = [
      ...(contextMenu.value?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) || []),
    ];
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    buttons[
      current < 0
        ? event.key === 'ArrowDown'
          ? 0
          : buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
          buttons.length
    ]?.focus({ preventScroll: true });
  } else if (event.key === 'Tab') context.value = undefined;
}
function contextAction(
  action:
    | 'link'
    | 'folder'
    | 'widgets'
    | 'layout'
    | 'wallpaper'
    | 'search'
    | 'backup'
    | 'settings',
) {
  context.value = undefined;
  if (action === 'layout') automatic.value = !automatic.value;
  else if (action === 'backup')
    void run(async () => {
      await backupDesktop();
    });
  else if (action === 'link' || action === 'folder')
    void edit(undefined, action);
  else tool.value = action;
}
onMounted(() => {
  document.addEventListener('pointerdown', dismissContext, true);
  document.addEventListener('keydown', contextKey, true);
  window.addEventListener('blur', dismissContext);
  window.addEventListener('resize', dismissContext);
  document.addEventListener('wheel', dismissContext, { passive: true });
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', dismissContext, true);
  document.removeEventListener('keydown', contextKey, true);
  window.removeEventListener('blur', dismissContext);
  window.removeEventListener('resize', dismissContext);
  document.removeEventListener('wheel', dismissContext);
});
async function addWidget(widget: 'calendar' | 'weather' | 'note') {
  await database.libraryItems.add({
    ...newPosition(3, widget === 'weather' ? 1 : 2),
    id: crypto.randomUUID(),
    kind: 'widget',
    widget,
    pageId: props.pageId,
    name:
      widget === 'calendar' ? '日历' : widget === 'weather' ? '天气' : '便签',
    parent: '',
    url: '',
    icon: '',
    width: 3,
    height: widget === 'weather' ? 1 : 2,
    order: Math.max(-1, ...items.value.map((i) => i.order)) + 1,
    updatedAt: Date.now(),
  });
}
const items = ref<LibraryItem[]>([]);
const folder = ref('');
const query = ref('');
const managing = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const editing = ref(false);
const editingId = ref<string>();
const nameInput = ref<HTMLInputElement>();
const removing = ref<LibraryItem>();
const draft = ref<LibraryDraft>({
  kind: 'link',
  name: '',
  url: '',
  icon: '',
  parent: '',
});
const dragging = ref('');
const dropTarget = ref('');
let subscription: { unsubscribe(): void } | undefined;
const folders = computed(() => items.value.filter((i) => i.kind === 'folder'));
const current = computed(() => items.value.find((i) => i.id === folder.value));
const visible = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  return items.value.filter((i) =>
    q
      ? `${i.name} ${i.url}`.toLocaleLowerCase().includes(q)
      : i.parent === folder.value,
  );
});
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
async function edit(item?: LibraryItem, kind: 'link' | 'folder' = 'link') {
  if (item && item.kind !== 'link') return;
  if (!item && kind === 'folder') {
    await run(async () => {
      await saveLibraryItem({
        ...newPosition(3, 1),
        kind: 'folder',
        name: '新文件夹',
        url: '',
        icon: '',
        parent: '',
        pageId: props.pageId,
      });
      folder.value = '';
      query.value = '';
      editing.value = false;
      removing.value = undefined;
    });
    return;
  }

  editingId.value = item?.id;
  draft.value = item
    ? {
        kind: item.kind,
        name: item.name,
        url: item.url,
        icon: item.icon,
        parent: item.parent,
      }
    : {
        kind,
        name: '',
        url: '',
        icon: '',
        parent: kind === 'folder' ? '' : folder.value,
      };
  titleNotice.value = '';
  editing.value = true;
  error.value = '';
  removing.value = undefined;
  await nextTick();
  nameInput.value?.focus({ preventScroll: true });
}
function truncateName(event: Event) {
  if ((event as InputEvent).isComposing) return;
  const input = event.target as HTMLInputElement;
  input.value = truncateLinkTitle(input.value);
  draft.value.name = input.value;
}
const titleNotice = ref('');
const fetchingTitle = ref(false);
let titleRequest = 0;
let lastAutoTitle = '';
let pendingTitleUrl = '';
async function fetchTitle(force = false) {
  const url = draft.value.url;
  if (
    draft.value.kind !== 'link' ||
    (!force && draft.value.name.trim() && draft.value.name !== lastAutoTitle)
  )
    return;
  try {
    const parsed = new URL(url);
    if (
      !['https:', 'http:'].includes(parsed.protocol) ||
      !parsed.hostname.includes('.')
    )
      return;
  } catch {
    return;
  }
  if (!force && fetchingTitle.value && pendingTitleUrl === url) return;
  pendingTitleUrl = url;
  const request = ++titleRequest;
  const previousName = draft.value.name;
  fetchingTitle.value = true;
  try {
    const origin = new URL(url).origin;
    const granted = await browser.permissions.contains({
      origins: [origin + '/*'],
    });
    if (!granted) {
      titleNotice.value =
        '网站访问权限未开启，请在扩展管理中允许访问所有网站，或手动填写名称';
      return;
    }
    titleNotice.value = '正在获取标题…';
    const result = await browser.runtime.sendMessage({
      type: 'website-title',
      url,
    });
    if (
      request !== titleRequest ||
      draft.value.url !== url ||
      draft.value.name !== previousName
    )
      return;
    const decoder = document.createElement('textarea');
    decoder.innerHTML = result?.title || '';
    const fetchedName = truncateLinkTitle(decoder.value.trim());
    if (fetchedName) {
      draft.value.name = fetchedName;
      lastAutoTitle = fetchedName;
    }
    titleNotice.value = fetchedName
      ? ''
      : result?.error ||
        '网页没有提供标题；可先打开网址，再重新填写网址以读取标签页标题';
  } catch {
    if (request === titleRequest)
      titleNotice.value = '标题获取失败，可手动填写';
  } finally {
    if (request === titleRequest) fetchingTitle.value = false;
  }
}
async function submit() {
  await fetchTitle();
  void run(async () => {
    await saveLibraryItem(
      {
        ...draft.value,
        ...(!editingId.value && !draft.value.parent ? newPosition(1, 1) : {}),
        pageId: props.pageId,
      },
      editingId.value,
    );
    editing.value = false;
  });
}
function open(item: LibraryItem) {
  if (managing.value) {
    void edit(item);
    return;
  }
  if (item.kind === 'folder') {
    folder.value = item.id;
    query.value = '';
  } else
    void run(async () => {
      const url = webUrl(item.url);
      if (url) await browser.tabs.create({ url });
    });
}
function drag(event: DragEvent, item: LibraryItem) {
  if (query.value || editing.value) {
    event.preventDefault();
    return;
  }
  dragging.value = item.id;
  event.dataTransfer?.setData('text/plain', item.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function endDrag() {
  dragging.value = '';
  dropTarget.value = '';
}
function drop(item?: LibraryItem, intent: 'sort' | 'merge' = 'merge') {
  const id = dragging.value;
  endDrag();
  if (!id || id === item?.id) return;
  const dragged = items.value.find((i) => i.id === id);
  if (intent === 'merge' && item?.kind === 'link' && dragged?.kind === 'link') {
    void run(() => mergeLibraryLinks(id, item.id));
    return;
  }
  const intoFolder =
    intent === 'merge' && item?.kind === 'folder' && dragged?.kind === 'link';
  void run(() =>
    moveLibraryItem(
      id,
      intoFolder ? item.id : (item?.parent ?? folder.value),
      intoFolder ? undefined : item?.id,
    ),
  );
}
function key(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (
    editing.value ||
    removing.value ||
    folder.value ||
    query.value ||
    managing.value
  ) {
    event.stopPropagation();
    event.preventDefault();
    if (editing.value) editing.value = false;
    else if (removing.value) removing.value = undefined;
    else if (query.value) query.value = '';
    else if (folder.value) folder.value = '';
    else managing.value = false;
  }
}
watch(folder, () => {
  managing.value = false;
});
onMounted(() => {
  subscription = liveQuery(() =>
    database.libraryItems.orderBy('order').toArray(),
  ).subscribe({
    next(value) {
      items.value = value.filter(
        (i) => (i.pageId || 'default') === props.pageId,
      );
      loading.value = false;
      if (folder.value && !value.some((i) => i.id === folder.value))
        folder.value = '';
    },
    error() {
      error.value = '无法读取收藏库，请重新打开后重试';
      loading.value = false;
    },
  });
});
onUnmounted(() => subscription?.unsubscribe());
</script>

<template>
  <section
    ref="board"
    class="library-board"
    aria-label="网址收藏库"
    @click="containInteraction"
    @pointerdown="containInteraction"
    @contextmenu="showContext"
    @keydown="key"
    @dragend="endDrag"
  >
    <button
      v-if="!embedded"
      class="library-close glass-control glass-interactive"
      aria-label="关闭收藏库"
      @click="$emit('close')"
    >
      ×
    </button>
    <label class="library-search glass-surface"
      ><span aria-hidden="true">⌕</span
      ><input
        v-model="query"
        aria-label="搜索收藏"
        placeholder="搜索收藏名称或网址"
        type="search"
    /></label>
    <nav v-if="folder" class="library-actions" aria-label="文件夹导航">
      <button
        class="glass-control glass-interactive"
        @click="
          folder = '';
          query = '';
        "
        @dragover.prevent="dropTarget = 'root'"
        @drop.prevent.stop="
          run(() => moveLibraryItem(dragging, '')).finally(endDrag)
        "
      >
        返回收藏页
      </button>
      <span>{{ current?.name }}</span>
    </nav>
    <BaseDialog
      :open="editing"
      close-button
      solid
      :width="680"
      :title="editingId ? '编辑网址' : '添加网址'"
      @update:open="editing = $event"
    >
      <form
        v-if="editing"
        class="library-editor floating-editor"
        aria-label="编辑收藏"
        @submit.prevent="submit"
      >
        <label v-if="draft.kind === 'link'"
          >网址<span class="input-with-icon"
            ><svg
              class="input-leading-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="4" ry="9" />
              <path d="M3 12h18" /></svg
            ><input
              v-model="draft.url"
              aria-label="收藏网址"
              @input="fetchTitle()"
              placeholder="https://"
              type="url"
              required /></span
        ></label>
        <div class="title-field">
          <label for="library-link-title">名称</label>
          <div class="title-input-row">
            <span class="input-with-icon"
              ><span class="input-leading-icon" aria-hidden="true">T</span
              ><input
                id="library-link-title"
                ref="nameInput"
                v-model="draft.name"
                aria-label="收藏名称"
                @input="truncateName"
                @compositionend="truncateName"
                placeholder="留空自动获取"
            /></span>
            <button
              type="button"
              class="fetch-title"
              :disabled="fetchingTitle || !draft.url.trim()"
              @click="fetchTitle(true)"
            >
              {{ fetchingTitle ? '获取中…' : '获取标题' }}
            </button>
          </div>
          <p v-if="titleNotice" class="title-status" role="status">
            {{ titleNotice }}
          </p>
        </div>
        <template v-if="draft.kind === 'link'">
          <LinkIconEditor
            v-model="draft.icon"
            :url="draft.url"
            :title="draft.name"
          />
        </template>
        <div class="library-form-actions">
          <button
            type="button"
            class="glass-control glass-interactive"
            @click="editing = false"
          >
            取消</button
          ><button class="glass-control glass-interactive" :disabled="busy">
            保存
          </button>
        </div>
        <p v-if="error" role="alert">{{ error }}</p>
      </form>
    </BaseDialog>
    <BaseDialog
      :open="!!removing"
      title="确认删除"
      @update:open="removing = undefined"
    >
      <div v-if="removing" class="library-confirm">
        <p>
          删除「{{ removing.name }}」？{{
            removing.kind === 'folder' ? '其中的网址会移回全部收藏。' : ''
          }}
        </p>
        <div class="library-form-actions">
          <button
            class="glass-control glass-interactive"
            @click="removing = undefined"
          >
            取消</button
          ><button
            class="glass-control glass-interactive"
            :disabled="busy"
            @click="
              run(async () => {
                await deleteLibraryItem(removing!.id);
                removing = undefined;
              })
            "
          >
            确认删除
          </button>
        </div>
        <p v-if="error" role="alert" class="library-error">{{ error }}</p>
      </div>
    </BaseDialog>
    <p v-if="error" role="alert" class="library-error">{{ error }}</p>
    <div class="library-scroll" @dragover.prevent @drop.prevent.self="drop()">
      <p v-if="loading" class="library-empty">正在读取收藏…</p>
      <p v-else-if="!visible.length && query" class="library-empty">
        没有找到匹配的收藏
      </p>
      <LibraryGrid
        v-else
        ref="gridView"
        :automatic="automatic"
        :rows="rows"
        :alignment="alignment"
        :items="visible"
        :all="items"
        :managing="managing"
        :disabled="!!query || editing || busy"
        @open="open"
        @edit="edit($event)"
        @remove="
          removing = $event;
          editing = false;
        "
        @drag="drag"
        @drop="drop"
        @error="error = $event"
      />
    </div>
    <DesktopTools
      :error="error"
      :tool="tool"
      :automatic="automatic"
      @close="tool = ''"
      @layout="automatic = $event"
      @add="
        run(async () => {
          await addWidget($event);
          tool = '';
        })
      "
      @folder="
        tool = '';
        edit(undefined, 'folder');
      "
    />
    <Teleport to="body">
      <div
        v-if="context"
        ref="contextMenu"
        class="library-context-menu glass-surface"
        tabindex="-1"
        role="menu"
        aria-label="收藏页菜单"
        :style="{ left: `${context.x}px`, top: `${context.y}px` }"
        @pointerdown.stop
        @click.stop
        @contextmenu.prevent.stop
      >
        <button
          role="menuitem"
          class="glass-control glass-interactive"
          :disabled="loading || busy"
          @click="contextAction('link')"
        >
          ＋ 添加网址
        </button>
        <button
          role="menuitem"
          class="glass-control glass-interactive"
          :disabled="loading || busy"
          @click="contextAction('folder')"
        >
          新建文件夹
        </button>
        <button
          v-for="action in [
            { id: 'widgets', name: '组件商店' },
            {
              id: 'layout',
              name: automatic ? '切换为自由布局' : '切换为自动布局',
            },
            { id: 'wallpaper', name: '换壁纸' },
            { id: 'search', name: '图标搜索' },
            { id: 'backup', name: '立即备份' },
            { id: 'settings', name: '设置' },
          ] as const"
          :key="action.id"
          role="menuitem"
          class="glass-control glass-interactive"
          :disabled="busy"
          @click="contextAction(action.id)"
        >
          {{ action.name }}
        </button>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.library-context-menu {
  outline: none;
}
.floating-editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  margin: 0;
  padding: 0;
  background: none;
  box-shadow: none;
}
.floating-editor label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.floating-editor :deep(input),
.floating-editor :deep(select) {
  height: 36px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid rgb(239 239 237 / 20%);
  border-radius: 9px;
  background: #fafafa;
  color: inherit;
}
</style>

<style scoped>
.title-field {
  display: grid;
  gap: 8px;
}
.title-input-row {
  display: flex;
  align-items: stretch;
  gap: 10px;
}
.title-input-row input {
  min-width: 0;
  flex: 1;
}
.fetch-title {
  flex-shrink: 0;
  border: 1px solid #ccc;
  border-radius: 9px;
  padding: 0 14px;
  color: #333;
  background: #f5f5f5;
  cursor: pointer;
}
.fetch-title:disabled {
  opacity: 0.5;
  cursor: default;
}
.title-status {
  margin: 0;
  font-size: 12px;
  color: #777;
}
</style>

<style scoped>
.floating-editor .fetch-title,
.floating-editor .library-form-actions button {
  height: 36px;
  box-sizing: border-box;
}
</style>

<style scoped>
.input-with-icon {
  position: relative;
  display: block;
  flex: 1;
  min-width: 0;
}
.input-with-icon input {
  padding-left: 38px !important;
}
.input-leading-icon {
  position: absolute;
  left: 13px;
  top: 9px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  font-size: 17px;
  line-height: 18px;
  color: #888;
  pointer-events: none;
}
</style>

<style scoped>
.floating-editor {
  gap: 18px;
}
.floating-editor label {
  font-size: 13px;
  line-height: 20px;
  color: #444;
  font-weight: 500;
}
.floating-editor :deep(input) {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
}
.floating-editor :deep(input::placeholder) {
  color: #aaa;
}
.floating-editor .library-form-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
  padding-top: 18px;
  padding-bottom: 16px;
  border-top: 1px solid #eee;
}
.floating-editor .library-form-actions button {
  min-width: 82px;
  border-radius: 9px;
  padding: 0 20px;
  font-size: 14px;
}
.fetch-title {
  font-size: 13px;
  transition: background 140ms ease;
}
.fetch-title:not(:disabled):hover {
  background: #eaeaea;
}
.title-status {
  font-size: 12px;
  line-height: 18px;
}
</style>

<style scoped>
.floating-editor :deep(input),
.floating-editor :deep(textarea),
.floating-editor :deep(button) {
  border: 0 !important;
}
</style>

<style scoped>
.floating-editor :deep(input:not(.inline-icon-editor)),
.floating-editor :deep(textarea) {
  background: #f5f5f7;
  border-radius: 6px;
}
.floating-editor .fetch-title,
.floating-editor .library-form-actions button {
  border-radius: 6px;
  background: #f5f5f7;
  transition: opacity 140ms ease;
}
.floating-editor .library-form-actions button:last-child {
  background: #000;
  color: #fff;
}
.floating-editor .fetch-title:not(:disabled):hover,
.floating-editor .library-form-actions button:not(:disabled):hover {
  opacity: 0.7;
  background: #f5f5f7;
}
.floating-editor .library-form-actions button:last-child:not(:disabled):hover {
  background: #000;
}
</style>

<style scoped>
.floating-editor {
  --editor-section-gap: 18px;
  --editor-label-gap: 8px;
  gap: var(--editor-section-gap);
}
.floating-editor label,
.floating-editor :deep(legend) {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: #444;
}
.floating-editor label,
.title-field {
  gap: var(--editor-label-gap);
}
</style>
