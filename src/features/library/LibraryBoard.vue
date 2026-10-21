<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import { browser } from 'wxt/browser';
import { database, type LibraryItem } from '../../shared/storage/database';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
import { webUrl } from '../workspace/collections';
import {
  saveLibraryItem,
  moveLibraryItem,
  deleteLibraryItem,
  type LibraryDraft,
} from './library';
import './library.css';
defineEmits<{ close: [] }>();
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
const children = (id: string) => items.value.filter((i) => i.parent === id);
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
  editing.value = true;
  error.value = '';
  removing.value = undefined;
  await nextTick();
  nameInput.value?.focus();
}
function submit() {
  void run(async () => {
    await saveLibraryItem(draft.value, editingId.value);
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
function drop(item?: LibraryItem) {
  const id = dragging.value;
  endDrag();
  if (!id || id === item?.id) return;
  const dragged = items.value.find((i) => i.id === id);
  const intoFolder = item?.kind === 'folder' && dragged?.kind === 'link';
  void run(() =>
    moveLibraryItem(
      id,
      intoFolder ? item.id : folder.value,
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
      items.value = value;
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
    class="library-board"
    aria-label="网址收藏库"
    @click.stop
    @pointerdown.stop
    @contextmenu.prevent.stop
    @keydown="key"
    @dragend="endDrag"
  >
    <header class="library-toolbar">
      <div class="library-heading">
        <img
          src="/images/shortcuts/collection.png"
          width="28"
          height="28"
          alt=""
        />
        <h1>收藏库</h1>
        <span>把常用网址，放在手边</span>
      </div>
      <button
        class="library-close glass-control glass-interactive"
        aria-label="关闭收藏库"
        @click="$emit('close')"
      >
        ×
      </button>
    </header>
    <label class="library-search glass-surface"
      ><span aria-hidden="true">⌕</span
      ><input
        v-model="query"
        aria-label="搜索收藏"
        placeholder="搜索收藏名称或网址"
        type="search"
    /></label>
    <nav class="library-actions" aria-label="收藏库工具栏">
      <button
        class="glass-control glass-interactive"
        :aria-current="!folder ? 'page' : undefined"
        @click="
          folder = '';
          query = '';
        "
        @dragover.prevent="dropTarget = 'root'"
        @drop.prevent.stop="
          run(() => moveLibraryItem(dragging, '')).finally(endDrag)
        "
      >
        全部收藏
      </button>
      <span v-if="current">/ {{ current.name }}</span>
      <span class="library-total">{{ visible.length }} 项</span>
      <button
        class="glass-control glass-interactive"
        :disabled="loading || busy"
        @click="edit()"
      >
        ＋ 添加网址
      </button>
      <button
        class="glass-control glass-interactive"
        :disabled="loading || busy"
        @click="edit(undefined, 'folder')"
      >
        新建文件夹
      </button>
      <button
        class="glass-control glass-interactive"
        :aria-pressed="managing"
        @click="managing = !managing"
      >
        {{ managing ? '完成' : '整理' }}
      </button>
    </nav>
    <form
      v-if="editing"
      class="library-editor glass-surface"
      aria-label="编辑收藏"
      @submit.prevent="submit"
    >
      <h2>
        {{ editingId ? '编辑' : '添加'
        }}{{ draft.kind === 'folder' ? '文件夹' : '网址' }}
      </h2>
      <label
        >名称<input
          ref="nameInput"
          v-model="draft.name"
          aria-label="收藏名称"
          maxlength="80"
          required
      /></label>
      <template v-if="draft.kind === 'link'">
        <label
          >网址<input
            v-model="draft.url"
            aria-label="收藏网址"
            placeholder="https://"
            type="url"
            required
        /></label>
        <label
          >图标地址（可选）<input
            v-model="draft.icon"
            aria-label="收藏图标地址"
            placeholder="留空使用网站图标，加载失败显示名称首字"
            type="url"
        /></label>
        <label
          >文件夹<select v-model="draft.parent" aria-label="收藏文件夹">
            <option value="">全部收藏</option>
            <option v-for="f in folders" :key="f.id" :value="f.id">
              {{ f.name }}
            </option>
          </select></label
        >
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
    </form>
    <div v-if="removing" class="library-confirm glass-surface" role="alert">
      <p>
        删除「{{ removing.name }}」？{{
          removing.kind === 'folder' ? '其中的网址会移回全部收藏。' : ''
        }}
      </p>
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
    <div class="library-scroll" @dragover.prevent @drop.prevent.self="drop()">
      <p v-if="loading" class="library-empty">正在读取收藏…</p>
      <div v-else-if="!visible.length" class="library-empty">
        <h2>{{ query ? '没有找到匹配的收藏' : '留一个位置，给常用的网址' }}</h2>
        <p>
          {{
            query
              ? '试试其他名称或网址'
              : '添加网址像应用一样打开，也可以拖入文件夹整理。'
          }}
        </p>
      </div>
      <TransitionGroup
        v-else
        name="library-tile"
        tag="div"
        class="library-grid"
        @dragover.prevent
        @drop.prevent.self="drop()"
      >
        <article
          v-for="item in visible"
          :key="item.id"
          class="library-tile"
          :class="{
            'is-dragging': dragging === item.id,
            'is-drop-target': dropTarget === item.id,
          }"
          :data-library-id="item.id"
          :draggable="!query && !editing"
          @dragstart="drag($event, item)"
          @dragover.prevent.stop="dropTarget = item.id"
          @dragleave="dropTarget = ''"
          @drop.prevent.stop="drop(item)"
        >
          <button
            class="library-launch glass-interaction-owner"
            :aria-label="
              (item.kind === 'folder' ? '打开文件夹 ' : '打开收藏 ') + item.name
            "
            @click="open(item)"
          >
            <span
              v-if="item.kind === 'folder'"
              class="library-folder glass-surface glass-interaction-target"
              ><WorkspaceFavicon
                v-for="child in children(item.id).slice(0, 9)"
                :key="child.id"
                :src="child.icon"
                :page-url="child.url"
                :title="child.name"
              /><span
                v-if="!children(item.id).length"
                class="library-folder-empty"
                >▦</span
              ></span
            >
            <span v-else class="library-icon glass-interaction-target"
              ><WorkspaceFavicon
                :src="item.icon"
                :page-url="item.url"
                :title="item.name"
            /></span>
            <span class="library-name">{{ item.name }}</span>
          </button>
          <div v-if="managing" class="library-item-actions">
            <button
              class="glass-control glass-interactive"
              :aria-label="'编辑 ' + item.name"
              @click="edit(item)"
            >
              编辑</button
            ><button
              class="glass-control glass-interactive"
              :aria-label="'删除 ' + item.name"
              @click="
                removing = item;
                editing = false;
              "
            >
              删除
            </button>
          </div>
        </article>
      </TransitionGroup>
    </div>
    <footer class="library-footer">
      {{
        query
          ? '搜索范围：整个收藏库'
          : '拖拽排序 · 拖到文件夹归类 · 整理模式可编辑或移动'
      }}<span>保存在此设备</span>
    </footer>
  </section>
</template>
