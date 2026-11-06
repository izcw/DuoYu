<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { liveQuery } from 'dexie';
import { connectPageDrag, pageDragError } from './page-drag';
import { seedLibraryDemo } from './library';
import { database, type LibraryPage } from '../../shared/storage/database';
import '../../shared/side-menu.css';
import DesktopMenu from '../../shared/components/base/DesktopMenu.vue';
import MenuEditorDialog from '../../shared/components/base/MenuEditorDialog.vue';

import {
  ensureLibraryPage,
  addLibraryPage,
  removeLibraryPage,
  orderLibraryPages,
} from './pages';
defineOptions({ inheritAttrs: false });
const active = defineModel<string>({ default: 'default' });
const props = defineProps<{ homeActive?: boolean; visible?: boolean }>();
const emit = defineEmits<{
  title: [value: string];
  home: [];
  navigate: [];
  pages: [value: LibraryPage[]];
}>();
const pages = ref<LibraryPage[]>([]);

const error = ref('');
const editing = ref('');
const name = ref('');
const icon = ref('Bookmark');
const busy = ref(false);
const context = ref<{ page: LibraryPage; x: number; y: number }>();
const contextPanel = ref<HTMLElement>();
function closeContext() {
  context.value = undefined;
}
function outsideContext(event: PointerEvent) {
  if (!contextPanel.value?.contains(event.target as Node)) closeContext();
}
async function showContext(event: MouseEvent, page: LibraryPage) {
  if (busy.value) return;
  context.value = {
    page,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 188)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 100)),
  };
  await nextTick();
  contextPanel.value?.focus();
}
function editPage() {
  if (!context.value) return;
  editing.value = context.value.page.id;
  name.value = context.value.page.name;
  icon.value = context.value.page.icon || 'Bookmark';
  error.value = '';
  closeContext();
}
function deletePage() {
  if (!context.value) return;
  remove(context.value.page.id);
  closeContext();
}
let disconnectDrag: (() => void) | undefined;
let disposed = false;
let subscription: { unsubscribe(): void } | undefined;
function select(page: LibraryPage) {
  active.value = page.id;
  emit('title', page.name);
}
async function run(action: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
function add() {
  closeContext();
  editing.value = '__new';
  let n = 1;
  while (pages.value.some((page) => page.name === `收藏页 ${n}`)) n++;
  name.value = `收藏页 ${n}`;
  icon.value = 'Bookmark';
  error.value = '';
}
function remove(id: string) {
  void run(async () => {
    const fallback = await removeLibraryPage(id);
    if (active.value === id) active.value = fallback;
  });
}
function rename() {
  if (!name.value.trim()) return;
  void run(async () => {
    if (editing.value === '__new') {
      active.value = await addLibraryPage(name.value, icon.value);
      emit('title', name.value.trim());
      emit('navigate');
    } else {
      const updated = await database.libraryPages.update(editing.value, {
        name: name.value.trim().slice(0, 30),
        icon: icon.value,
      });
      if (!updated) throw new Error('该收藏页已被删除，请重新选择');
      if (active.value === editing.value) emit('title', name.value.trim());
    }
    editing.value = '';
  });
}
function choose(id: string) {
  if (id === 'home') return emit('home');
  const page = pages.value.find((p) => p.id === id);
  if (page) {
    select(page);
    emit('navigate');
  }
}
function reorder(ids: string[]) {
  if (busy.value) return;
  const original = pages.value;
  pages.value = ids.flatMap((id) => original.filter((p) => p.id === id));
  void run(async () => {
    try {
      await orderLibraryPages(ids);
    } catch (e) {
      pages.value = await database.libraryPages.orderBy('order').toArray();
      throw e;
    }
  });
}
onMounted(async () => {
  document.addEventListener('pointerdown', outsideContext, true);
  window.addEventListener('resize', closeContext);
  window.addEventListener('blur', closeContext);
  window.addEventListener('wheel', closeContext);
  disconnectDrag = connectPageDrag((id) => {
    if (id === 'home') {
      emit('home');
      return;
    }
    const page = pages.value.find((p) => p.id === id);
    if (page) {
      select(page);
      emit('navigate');
    }
  });
  try {
    await ensureLibraryPage();
    await seedLibraryDemo();
  } catch (e) {
    error.value = String(e);
    return;
  }
  if (disposed) return;
  subscription = liveQuery(() =>
    database.libraryPages.orderBy('order').toArray(),
  ).subscribe({
    next(value) {
      pages.value = value;
      emit('pages', value);
      const selected = value.find((p) => p.id === active.value) || value[0];
      if (selected) select(selected);
    },
    error(e) {
      error.value = String(e);
    },
  });
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', outsideContext, true);
  window.removeEventListener('resize', closeContext);
  window.removeEventListener('blur', closeContext);
  window.removeEventListener('wheel', closeContext);
  disconnectDrag?.();
  disposed = true;
  subscription?.unsubscribe();
});
</script>
<template>
  <DesktopMenu
    v-bind="$attrs"
    library
    label="收藏页面"
    add-label="添加收藏页"
    :pinned="{ id: 'home', name: '首页', icon: 'Home' }"
    :items="pages"
    :active="homeActive ? 'home' : active"
    :visible="visible || !!context"
    :disabled="!!editing || busy"
    @select="choose"
    @add="add"
    @context="
      (event, id) => {
        const p = pages.find((p) => p.id === id);
        if (p) showContext(event, p);
      }
    "
    @reorder="reorder"
  >
    <template #notice
      ><p v-if="pageDragError || error" role="alert">
        {{ pageDragError || error }}
      </p></template
    >
  </DesktopMenu>
  <Teleport to="body">
    <div
      v-if="context"
      ref="contextPanel"
      class="page-context-menu side-menu-context glass-surface"
      role="menu"
      aria-label="收藏页操作"
      tabindex="-1"
      :style="{ left: context.x + 'px', top: context.y + 'px' }"
      @contextmenu.prevent.stop
      @pointerdown.stop
      @click.stop
      @keydown.esc.stop="closeContext"
    >
      <button
        role="menuitem"
        class="glass-control glass-interactive"
        :disabled="busy"
        @click="editPage"
      >
        修改名称和图标
      </button>
      <button
        role="menuitem"
        class="glass-control glass-interactive"
        :disabled="pages.length < 2 || busy"
        title="删除页面，收藏移至其他页面"
        @click="deletePage"
      >
        删除页面
      </button>
    </div>
  </Teleport>
  <MenuEditorDialog
    :open="!!editing"
    :title="editing === '__new' ? '添加收藏页' : '编辑收藏页'"
    :adding="editing === '__new'"
    v-model:name="name"
    v-model:icon="icon"
    :busy="busy"
    :error="error"
    @close="editing = ''"
    @submit="rename"
  />
</template>
