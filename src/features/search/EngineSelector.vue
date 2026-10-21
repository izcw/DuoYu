<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import {
  SEARCH_ENGINES,
  getSearchEngine,
  type SearchEngineId,
} from './engines';
import RadialWheel from '../../shared/components/composite/RadialWheel.vue';
import { database } from '../../shared/storage/database';
const props = defineProps<{ modelValue: SearchEngineId }>();
const emit = defineEmits<{
  'update:modelValue': [value: SearchEngineId];
  'visibility-change': [visible: boolean];
  'add-engine': [];
}>();
const defaults = [
  ...SEARCH_ENGINES,
  { id: 'add', name: '添加搜索引擎', icon: '/images/add.png' },
];
const items = ref([...defaults]);
const expanded = ref(false);
const current = computed(() => getSearchEngine(props.modelValue));
const trigger = ref<HTMLButtonElement>();
const wheel = ref<InstanceType<typeof RadialWheel>>();
const center = ref({ x: 0, y: 0 });
const interaction = { clickButton: 0, holdButton: 0, dragButton: 0 } as const;
let timer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let hold: { id: number; active: boolean } | undefined;
let suppress = false;
let saveQueue = Promise.resolve();
function close() {
  if (expanded.value && document.activeElement?.closest('.engine-wheel'))
    trigger.value?.focus();
  clearTimeout(timer);
  hold = undefined;
  expanded.value = false;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => emit('visibility-change', false), 220);
}
function open() {
  const bounds = trigger.value?.getBoundingClientRect();
  if (!bounds) return;
  center.value = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  clearTimeout(closeTimer);
  expanded.value = true;
  emit('visibility-change', true);
}
function toggle() {
  if (expanded.value) close();
  else open();
}
function down(event: PointerEvent) {
  if (event.button !== interaction.holdButton || !event.isPrimary) return;
  clearTimeout(timer);
  suppress = false;
  hold = { id: event.pointerId, active: false };
  timer = setTimeout(() => {
    if (!hold) return;
    hold.active = true;
    suppress = true;
    open();
  }, 150);
}
function up(event: PointerEvent) {
  if (hold?.id !== event.pointerId) return;
  clearTimeout(timer);
  const active = hold.active;
  hold = undefined;
  if (active) wheel.value?.selectAt(event.clientX, event.clientY);
}
function click(event: MouseEvent) {
  if (suppress && event.detail !== 0) {
    suppress = false;
    return;
  }
  toggle();
}
function select(id: string) {
  if (id === 'add') emit('add-engine');
  else if (SEARCH_ENGINES.some((item) => item.id === id))
    emit('update:modelValue', id as SearchEngineId);
  close();
  trigger.value?.focus();
}
function reorder(ids: string[]) {
  items.value = ids.map((id) => defaults.find((item) => item.id === id)!);
  const snapshot = items.value.map((item) => ({ ...item }));
  saveQueue = saveQueue
    .then(async () => {
      await database.shortcuts.put({ id: 'engines', items: snapshot });
    })
    .catch(() => console.warn('搜索引擎顺序保存失败'));
}
function outside(event: PointerEvent) {
  if (!(event.target instanceof Element)) return;
  if (!event.target.closest('.engine-selector, .engine-wheel')) close();
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close();
    trigger.value?.focus();
  } else if (
    event.target === trigger.value &&
    ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
  ) {
    event.preventDefault();
    open();
    void nextTick(() => wheel.value?.focusFirst());
  }
}
onMounted(async () => {
  document.addEventListener('pointerdown', outside);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', close);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  try {
    const stored = await database.shortcuts.get('engines');
    if (stored) {
      const ids = stored.items.map((item) => item.id);
      items.value = [
        ...ids
          .map((id) => defaults.find((item) => item.id === id))
          .filter((item): item is (typeof defaults)[number] => !!item),
        ...defaults.filter((item) => !ids.includes(item.id)),
      ];
    }
  } catch {
    /* Default order remains available offline. */
  }
});
onUnmounted(() => {
  clearTimeout(timer);
  clearTimeout(closeTimer);
  document.removeEventListener('pointerdown', outside);
  document.removeEventListener('pointerup', up);
  document.removeEventListener('pointercancel', close);
  window.removeEventListener('blur', close);
  window.removeEventListener('resize', close);
});
</script>
<template>
  <div class="engine-selector" :class="{ expanded }" @keydown="key">
    <Teleport to="body"
      ><RadialWheel
        ref="wheel"
        id="engine-wheel"
        class="engine-wheel"
        :items="items"
        :open="expanded"
        :center="center"
        :radius="128"
        shape="half"
        :selected="modelValue"
        :interaction="interaction"
        label="选择搜索引擎"
        focus-owner=".engine-selector"
        @select="select"
        @reorder="reorder"
        @close="close"
    /></Teleport>
    <button
      ref="trigger"
      class="engine-trigger glass-control glass-interactive"
      type="button"
      :aria-label="`切换搜索引擎，当前 ${current.name}`"
      aria-haspopup="menu"
      aria-controls="engine-wheel"
      :aria-expanded="expanded"
      :title="`搜索引擎：${current.name}`"
      @pointerdown="down"
      @contextmenu.prevent
      @click="click"
    >
      <img class="search-engine-icon" :src="current.icon" :alt="current.name" />
    </button>
  </div>
</template>
<style scoped>
.engine-selector {
  position: relative;
  width: var(--search-height);
  height: var(--search-height);
  border-radius: 50%;
  flex-shrink: 0;
  z-index: 12;
}
.engine-selector .engine-trigger {
  position: relative;
  z-index: 2;
  width: calc(var(--search-height) - 8px);
  height: calc(var(--search-height) - 8px);
  margin: 4px;
  border-radius: 50%;
  transition: transform 160ms;
  touch-action: none;
  user-select: none;
}
.engine-trigger img {
  pointer-events: none;
}
</style>
