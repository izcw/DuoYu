<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { liveQuery } from 'dexie';
import { connectPageDrag, pageDragError } from './page-drag';
import { seedLibraryDemo } from './library';
import { database, type LibraryPage } from '../../shared/storage/database';
import '../../shared/side-menu.css';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import ReorderTransition from '../../shared/components/base/ReorderTransition.vue';
import {
  ensureLibraryPage,
  addLibraryPage,
  removeLibraryPage,
  orderLibraryPages,
} from './pages';
defineOptions({ inheritAttrs: false });
const active = defineModel<string>({ default: 'default' });
const props = defineProps<{ homeActive?: boolean }>();
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
  if (dragged.value || busy.value) return;
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
const menu = ref<HTMLElement>();
const dragged = ref('');
let slots: { id: string; center: number }[] = [];
let startScroll = 0;
let savingOrder = false;
let original: LibraryPage[] = [];
let preview: LibraryPage[] = [];
const insertion = ref<{ id: string; after: boolean }>();
let dropped = false;
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
  void run(async () => {
    active.value = await addLibraryPage();
  });
}
function remove(id: string) {
  void run(async () => {
    const fallback = await removeLibraryPage(id);
    if (active.value === id) active.value = fallback;
  });
}
function rename() {
  void run(async () => {
    if (name.value.trim())
      await database.libraryPages.update(editing.value, {
        name: name.value.trim().slice(0, 30),
      });
    editing.value = '';
  });
}
function start(event: DragEvent, id: string) {
  closeContext();
  if (editing.value || busy.value) {
    event.preventDefault();
    return;
  }
  dragged.value = id;
  original = [...pages.value];
  preview = original;
  insertion.value = undefined;
  startScroll = menu.value?.scrollTop || 0;
  // Read once, before FLIP transforms move rows under a stationary pointer.
  slots = [
    ...(menu.value?.querySelectorAll<HTMLElement>('.library-page-row') || []),
  ].map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      id: row.dataset.libraryPageId!,
      center: rect.top + rect.height / 2,
    };
  });
  dropped = false;
  event.dataTransfer?.setData('application/x-duoyu-library-page', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function over(event: DragEvent) {
  if (!dragged.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const item = original.find((page) => page.id === dragged.value);
  if (!item) return;
  const y = event.clientY + (menu.value?.scrollTop || 0) - startScroll;
  const index = slots.filter(
    (slot) => slot.id !== dragged.value && y > slot.center,
  ).length;
  const next = original.filter((page) => page.id !== dragged.value);
  next.splice(index, 0, item);
  preview = next;
  const others = original.filter((page) => page.id !== dragged.value);
  insertion.value = next.every((page, index) => page.id === original[index]?.id)
    ? undefined
    : {
        id: others[Math.min(index, others.length - 1)]!.id,
        after: index === others.length,
      };
}
function end() {
  if (!dropped && dragged.value) pages.value = original;
  dragged.value = '';
  slots = [];
  insertion.value = undefined;
}
function drop() {
  if (!dragged.value) return;
  dropped = true;
  pages.value = preview;
  insertion.value = undefined;
  dragged.value = '';
  const order = pages.value.map((page) => page.id);
  const fallback = original;
  slots = [];
  savingOrder = true;
  void run(async () => {
    try {
      await orderLibraryPages(order);
    } catch (e) {
      pages.value = fallback;
      throw e;
    } finally {
      savingOrder = false;
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
      if (!dragged.value && !savingOrder) pages.value = value;
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
  <nav
    v-bind="$attrs"
    ref="menu"
    class="library-page-menu side-menu"
    aria-label="收藏页面"
    @pointerdown.stop
    @click.stop
    @dragend="end"
    @drop.prevent="drop"
    @dragover="over"
    @keydown.esc="end"
  >
    <p v-if="pageDragError" class="glass-surface" role="alert">
      {{ pageDragError }}
    </p>
    <button
      class="library-page-choice side-menu-choice library-home"
      data-library-page-id="home"
      aria-label="首页"
      :aria-pressed="!!props.homeActive"
      :aria-current="props.homeActive ? 'page' : undefined"
      @click="emit('home')"
    >
      <svg
        class="page-nav-icon side-menu-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          v-if="props.homeActive"
          fill="currentColor"
          stroke="none"
          d="M12 2 1 11h3v11h6v-8h4v8h6V11h3Z"
        />
        <path v-else d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10" /></svg
      ><small>首页</small>
    </button>
    <ReorderTransition class="library-page-list">
      <div
        v-for="item in pages"
        :key="item.id"
        class="library-page-row"
        :class="{
          'is-dragging': dragged === item.id,
          'drop-before': insertion?.id === item.id && !insertion.after,
          'drop-after': insertion?.id === item.id && insertion.after,
        }"
        :data-library-page-id="item.id"
        :draggable="!editing && !busy"
        @dragstart.stop="start($event, item.id)"
        @contextmenu.prevent.stop="showContext($event, item)"
      >
        <button
          class="library-page-choice side-menu-choice"
          :aria-pressed="!props.homeActive && active === item.id"
          :aria-current="
            !props.homeActive && active === item.id ? 'page' : undefined
          "
          @click="
            select(item);
            emit('navigate');
          "
        >
          <svg
            class="page-nav-icon side-menu-icon"
            viewBox="0 0 28 28"
            aria-hidden="true"
          >
            <rect
              class="page-icon-shape side-menu-shape"
              x="3"
              y="3"
              width="22"
              height="22"
              rx="6"
            />
            <text
              class="page-icon-letter side-menu-letter"
              x="14"
              y="14"
              text-anchor="middle"
              dominant-baseline="central"
            >
              {{ item.name.charAt(0) }}
            </text></svg
          ><small>{{ item.name }}</small>
        </button>
      </div>
    </ReorderTransition>
    <button
      class="library-page-add side-menu-add"
      :disabled="busy"
      aria-label="添加收藏页"
      @click="add"
    >
      <img
        src="/images/add.png"
        width="28"
        height="28"
        alt=""
        draggable="false"
      />
    </button>
    <p v-if="error" role="alert">{{ error }}</p>
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
          重命名
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
    <BaseDialog
      :open="!!editing"
      title="重命名收藏页"
      @update:open="editing = ''"
    >
      <form class="page-rename-form side-menu-form" @submit.prevent="rename">
        <input v-model="name" maxlength="30" aria-label="收藏页名称" required />
        <button
          class="glass-control glass-interactive"
          :disabled="busy || !name.trim()"
          type="submit"
        >
          保存
        </button>
      </form>
    </BaseDialog>
  </nav>
</template>
<style scoped>
.library-page-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.library-page-row {
  position: relative;
  border-radius: 14px;
  cursor: grab;
}
.library-page-row.drop-before::before,
.library-page-row.drop-after::after {
  content: '';
  position: absolute;
  left: 4px;
  right: 4px;
  height: 3px;
  background: #efefed;
  border-radius: 3px;
  pointer-events: none;
}
.library-page-row.drop-before::before {
  top: -4px;
}
.library-page-row.drop-after::after {
  bottom: -4px;
}
.library-page-row.is-dragging {
  opacity: 0.3;
}
input {
  width: 100%;
  box-sizing: border-box;
}
p {
  font-size: 11px;
}
</style>

<style scoped>
.library-home {
  margin-bottom: 6px;
}
</style>
