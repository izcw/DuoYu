<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { browser } from 'wxt/browser';
import {
  createCollection,
  hostname,
  moveSavedTab,
  renameCollection,
  reorderCollection,
  webUrl,
} from './collections';
import { useWorkspace, type BrowserTab } from './useWorkspace';
import WorkspaceFavicon from './WorkspaceFavicon.vue';
import type { TabCollection } from '../../shared/storage/database';
import './workspace.css';

const emit = defineEmits<{ close: [] }>();
const {
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
  activate,
  close,
  openSaved,
  removeGroup,
  removeTab,
  undoDelete,
} = useWorkspace();
const newName = ref('');
const creating = ref(false);
const nameInput = ref<HTMLInputElement>();
const editing = ref('');
const editName = ref('');
const editInput = ref<HTMLInputElement[]>();
const deleting = ref('');
const collapsed = ref(new Set<string>());
type Drag =
  | { kind: 'tab'; id: number }
  | { kind: 'saved'; group: string; id: string }
  | { kind: 'collection'; id: string };
const drag = ref<Drag>();
const dropTarget = ref('');
function startDrag(event: DragEvent, value: Drag) {
  if (!event.dataTransfer || busy.value) {
    event.preventDefault();
    return;
  }
  drag.value = value;
  event.dataTransfer.effectAllowed = value.kind === 'tab' ? 'copyMove' : 'move';
  event.dataTransfer.setData('application/x-duoyu-tab', JSON.stringify(value));
}
function endDrag() {
  drag.value = undefined;
  dropTarget.value = '';
}
function over(event: DragEvent, target: string) {
  if (!drag.value) return;
  event.preventDefault();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = drag.value.kind === 'tab' ? 'copy' : 'move';
  dropTarget.value = target;
}
function drop(group: string, before?: string) {
  const value = drag.value;
  endDrag();
  if (!value) return;
  void run(async () => {
    if (value.kind === 'tab')
      await save([await browser.tabs.get(value.id)], group, before);
    else if (value.kind === 'saved')
      await moveSavedTab(value.group, value.id, group, before);
    else await reorderCollection(value.id, group);
  });
}
function dropOnTab(tab: BrowserTab) {
  const value = drag.value;
  endDrag();
  if (value?.kind !== 'tab' || value.id === tab.id) return;
  void run(async () => {
    await browser.tabs.move(value.id, {
      windowId: tab.windowId,
      index: tab.index,
    });
  });
}
async function showCreate() {
  creating.value = true;
  await nextTick();
  nameInput.value?.focus();
}
function create() {
  if (!newName.value.trim()) return;
  void run(async () => {
    destination.value = await createCollection(newName.value);
    newName.value = '';
    creating.value = false;
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
    aria-label="标签页管理"
    @click.stop
    @pointerdown.stop
    @contextmenu.stop
    @dragend="endDrag"
  >
    <header class="workspace-toolbar">
      <div class="workspace-heading">
        <img src="/icons/32.png" width="28" height="28" alt="" />
        <h1>标签工作区</h1>
        <span>保存一组标签，随时继续</span>
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
      <button
        class="workspace-icon workspace-exit glass-control glass-interactive"
        aria-label="关闭工作区"
        title="关闭工作区 · Esc"
        @click="emit('close')"
      >
        ×
      </button>
    </header>
    <div class="workspace-columns">
      <section class="workspace-library" aria-label="已保存的集合">
        <header class="workspace-section-heading">
          <div>
            <h2>
              我的集合 <span>{{ collections.length }}</span>
            </h2>
            <p>{{ savedCount }} 个已保存的标签页</p>
          </div>
          <button
            class="workspace-button glass-control glass-interactive"
            :disabled="busy || loading"
            @click="showCreate"
          >
            ＋ 新建集合
          </button>
        </header>
        <form
          v-if="creating"
          class="workspace-create glass-surface"
          @submit.prevent="create"
          @keydown.esc.stop="creating = false"
        >
          <input
            ref="nameInput"
            v-model="newName"
            maxlength="80"
            placeholder="例如：设计灵感、项目资料、稍后阅读"
            aria-label="集合名称"
          /><button
            class="workspace-button glass-control glass-interactive"
            :disabled="busy || !newName.trim()"
          >
            创建</button
          ><button
            type="button"
            class="workspace-icon glass-control glass-interactive"
            aria-label="取消新建集合"
            @click="creating = false"
          >
            ×
          </button>
        </form>
        <div class="workspace-collections" :aria-busy="loading">
          <p v-if="loading" class="workspace-empty">正在读取收藏…</p>
          <div v-else-if="!collections.length" class="workspace-welcome">
            <span class="workspace-welcome-symbol" aria-hidden="true">▤</span>
            <h3>给打开的网页，一个归处</h3>
            <p>
              创建集合，将右侧标签页拖进来。<br />下次打开多鱼，继续上次的浏览。
            </p>
            <button
              class="workspace-button glass-surface glass-interactive"
              @click="showCreate"
            >
              创建第一个集合
            </button>
          </div>
          <p v-else-if="!visibleCollections.length" class="workspace-empty">
            没有找到匹配的收藏
          </p>
          <article
            v-for="group in visibleCollections"
            :key="group.id"
            class="workspace-collection glass-surface"
            :class="{ 'is-drop-target': dropTarget === group.id }"
            :data-collection-id="group.id"
            @dragover="over($event, group.id)"
            @dragleave.self="dropTarget = ''"
            @drop.prevent.stop="drop(group.id)"
          >
            <header class="workspace-collection-heading">
              <button
                class="workspace-icon collection-handle glass-control glass-interactive"
                draggable="true"
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
                class="workspace-collection-name glass-control glass-interactive"
                :aria-expanded="!collapsed.has(group.id)"
                @click="collapse(group.id)"
              >
                <span>{{ group.name }}</span
                ><small>{{ group.tabs.length }}</small
                ><span aria-hidden="true">{{
                  collapsed.has(group.id) ? '▸' : '▾'
                }}</span>
              </button>
              <div class="workspace-collection-actions">
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
              class="workspace-confirm"
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
            <div v-if="!collapsed.has(group.id)" class="workspace-saved-tabs">
              <div
                v-for="tab in group.tabs"
                :key="tab.id"
                class="workspace-saved-tab"
                :class="{ 'is-drop-before': dropTarget === tab.id }"
                :data-saved-id="tab.id"
                draggable="true"
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
                <button
                  class="workspace-link glass-control glass-interactive"
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
                <select
                  v-if="collections.length > 1"
                  class="workspace-move"
                  :aria-label="`移动收藏 ${tab.title}`"
                  title="移动到其他集合"
                  @change="moveWithSelect($event, group.id, tab.id)"
                >
                  <option value="">移动</option>
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
                  class="workspace-icon glass-control glass-interactive"
                  :disabled="busy"
                  :aria-label="`移除收藏 ${tab.title}`"
                  title="移除收藏"
                  @click="run(() => removeTab(group.id, tab.id))"
                >
                  ×
                </button>
              </div>
              <p v-if="!group.tabs.length" class="workspace-drop-hint">
                拖入右侧标签页，或选择此集合后点击保存
              </p>
            </div>
          </article>
        </div>
        <footer class="workspace-library-footer">
          收藏保存在当前设备 · 拖拽整理，随时继续
        </footer>
      </section>
      <aside class="workspace-tabs" aria-label="浏览器打开的标签页">
        <header class="workspace-section-heading">
          <div>
            <h2>
              打开的标签页 <span>{{ visibleTabs.length }}</span>
            </h2>
            <p>保存网页，为下一次浏览留个入口</p>
          </div>
        </header>
        <div class="workspace-tab-scope" role="group" aria-label="标签页范围">
          <button
            class="glass-control glass-interactive"
            :aria-pressed="!allWindows"
            @click="allWindows = false"
          >
            当前窗口</button
          ><button
            class="glass-control glass-interactive"
            :aria-pressed="allWindows"
            @click="allWindows = true"
          >
            所有窗口
          </button>
        </div>
        <div class="workspace-save-controls">
          <select v-model="destination" aria-label="保存到集合">
            <option value="" v-if="!collections.length">
              自动创建「稍后处理」
            </option>
            <option
              v-for="group in collections"
              :key="group.id"
              :value="group.id"
            >
              {{ group.name }}
            </option></select
          ><button
            class="workspace-button glass-control glass-interactive"
            :disabled="
              busy ||
              loading ||
              !visibleTabs.some((t) => webUrl(t.pendingUrl || t.url || ''))
            "
            @click="run(() => save(visibleTabs))"
          >
            全部保存
          </button>
        </div>
        <div class="workspace-open-tabs" :aria-busy="tabsLoading">
          <div v-if="needsTabPermission" class="workspace-empty" role="status">
            <p>尚未获得标签页权限，无法读取网页标题和图标。</p>
            <button
              class="workspace-button glass-control glass-interactive"
              :disabled="busy"
              @click="run(requestTabPermission)"
            >
              允许读取标签页
            </button>
          </div>
          <p v-if="tabsLoading" class="workspace-empty">正在读取标签页…</p>
          <p v-else-if="!visibleTabs.length" class="workspace-empty">
            {{ query ? '没有匹配的打开标签页' : '这个窗口暂无其他标签页' }}
          </p>
          <section
            v-for="window in windows"
            :key="window.id"
            :aria-label="window.label"
          >
            <h3 class="workspace-window-label">
              {{ window.label }} <span>{{ window.tabs.length }}</span>
            </h3>
            <div
              v-for="tab in window.tabs"
              :key="tab.id"
              class="workspace-open-tab"
              :class="{ 'is-drop-before': dropTarget === `tab-${tab.id}` }"
              :data-browser-tab-id="tab.id"
              draggable="true"
              @dragstart="
                tab.id !== undefined &&
                startDrag($event, { kind: 'tab', id: tab.id })
              "
              @dragover="drag?.kind === 'tab' && over($event, `tab-${tab.id}`)"
              @drop.prevent.stop="dropOnTab(tab)"
            >
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
              <button
                class="workspace-icon glass-control glass-interactive"
                :disabled="
                  busy || loading || !webUrl(tab.pendingUrl || tab.url || '')
                "
                :aria-label="`保存标签页 ${tab.title}`"
                title="保存到集合"
                @click="run(() => save([tab]))"
              >
                ＋
              </button>
              <button
                class="workspace-icon glass-control glass-interactive"
                :disabled="busy"
                :aria-label="`关闭标签页 ${tab.title}`"
                title="关闭标签页"
                @click="run(() => close(tab))"
              >
                ×
              </button>
            </div>
          </section>
        </div>
        <footer class="workspace-tabs-footer">
          拖到左侧集合即可保存<br /><span>保存后仍保留浏览器标签页</span>
        </footer>
      </aside>
    </div>
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
