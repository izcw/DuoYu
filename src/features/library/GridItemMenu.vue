<script setup lang="ts">
import { itemMaxColumns, itemMaxRows } from './grid-config';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { LibraryItem } from '../../shared/storage/database';
const props = defineProps<{
  item: LibraryItem;
  x: number;
  y: number;
  maxRows?: number;
}>();
const emit = defineEmits<{
  close: [];
  resize: [width: number, height: number];
  edit: [];
  remove: [];
}>();
const viewport = globalThis.window;
const panel = ref<HTMLElement>();
const preview = ref<{ width: number; height: number }>();
const current = computed(() => ({
  width: props.item.width || 1,
  height: props.item.height || 1,
}));
const displayed = computed(() => preview.value || current.value);
const rows = computed(() =>
  Math.min(props.maxRows || 9, itemMaxRows(props.item.kind)),
);
const columns = computed(() => itemMaxColumns(props.item.kind));
const menuWidth = computed(() => Math.max(244, columns.value * 24 + 28));
const cells = computed(() =>
  Array.from({ length: columns.value * rows.value }, (_, i) => ({
    width: (i % columns.value) + 1,
    height: Math.floor(i / columns.value) + 1,
  })),
);
const close = () => emit('close');
function outside(e: PointerEvent) {
  if (!panel.value?.contains(e.target as Node)) close();
}
onMounted(() => {
  panel.value?.focus();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);
  window.addEventListener('wheel', close);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('resize', close);
  window.removeEventListener('blur', close);
  window.removeEventListener('wheel', close);
});
</script>
<template>
  <Teleport to="body">
    <section
      ref="panel"
      class="grid-item-menu glass-surface"
      role="dialog"
      :aria-label="item.name + '操作'"
      tabindex="-1"
      :style="{
        width: menuWidth + 'px',
        left:
          Math.max(8, Math.min(x, viewport.innerWidth - menuWidth - 8)) + 'px',
        top: Math.max(8, Math.min(y, viewport.innerHeight - 356)) + 'px',
      }"
      @keydown.esc.stop="close"
      @contextmenu.prevent.stop
      @pointerdown.stop
      @click.stop
    >
      <header>
        <span>{{ item.name }}</span
        ><button
          class="glass-control glass-interactive"
          aria-label="关闭"
          @click="close"
        >
          ×
        </button>
      </header>
      <div class="size-label">
        调整大小 <span>{{ displayed.width }} × {{ displayed.height }}</span>
      </div>
      <div
        class="size-picker"
        :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }"
        aria-label="选择网格尺寸"
        @mouseleave="preview = undefined"
        @focusout="preview = undefined"
      >
        <button
          v-for="cell in cells"
          :key="cell.width + '-' + cell.height"
          :aria-label="cell.width + '列 × ' + cell.height + '行'"
          :disabled="item.kind !== 'link' && cell.width * cell.height < 3"
          :class="{
            current:
              cell.width <= current.width && cell.height <= current.height,
            preview:
              preview &&
              cell.width <= preview.width &&
              cell.height <= preview.height,
          }"
          @mouseenter="preview = cell"
          @focus="preview = cell"
          @click="emit('resize', cell.width, cell.height)"
        />
      </div>
      <div class="item-menu-actions">
        <button
          v-if="item.kind === 'link'"
          class="glass-control glass-interactive"
          @click="emit('edit')"
        >
          编辑
        </button>
        <button class="glass-control glass-interactive" @click="emit('remove')">
          删除
        </button>
      </div>
    </section>
  </Teleport>
</template>
<style scoped>
.grid-item-menu {
  position: fixed;
  z-index: 2147483001;
  width: 244px;
  box-sizing: border-box;
  padding: 14px;
  border-radius: 20px;
  color: #efefed;
  outline: none;
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
header span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
header button {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: inherit;
}
.size-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 10px;
}
.size-picker {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 4px;
}
.size-picker button {
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid rgb(239 239 237 / 20%);
  border-radius: 4px;
  background: rgb(239 239 237 / 7%);
  cursor: pointer;
}
.size-picker button.preview {
  background: rgb(239 239 237 / 35%);
  border-color: rgb(239 239 237 / 50%);
}
.size-picker button.current {
  background: #3294e8;
  border-color: #74baff;
}
.size-picker button.current.preview {
  background:
    linear-gradient(rgb(239 239 237 / 28%), rgb(239 239 237 / 28%)), #3294e8;
}
.size-picker button:focus-visible {
  outline: 2px solid #efefed;
  outline-offset: 1px;
}
.size-picker button:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}
.item-menu-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.item-menu-actions button {
  flex: 1;
  padding: 7px;
  border-radius: 8px;
  color: inherit;
}
</style>
