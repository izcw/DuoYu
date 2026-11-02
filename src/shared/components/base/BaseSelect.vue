<script setup lang="ts">
import {
  computed,
  ref,
  useId,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
} from 'vue';
const props = defineProps<{
  modelValue: string;
  label: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const open = ref(false);
const active = ref(0);
const listId = useId();
const selected = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);
function show() {
  if (props.disabled) return;
  active.value = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.modelValue),
  );
  open.value = true;
}
function choose(index: number) {
  const option = props.options[index];
  if (!option || props.disabled) return;
  open.value = false;
  emit('update:modelValue', option.value);
  void nextTick(() => trigger.value?.focus());
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    event.stopPropagation();
    open.value = false;
    return;
  }
  if (event.key === 'Tab') {
    open.value = false;
    return;
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    if (!open.value) {
      show();
      return;
    }
    active.value =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? props.options.length - 1
          : (active.value +
              (event.key === 'ArrowDown' ? 1 : -1) +
              props.options.length) %
            props.options.length;
  } else if ((event.key === 'Enter' || event.key === ' ') && open.value) {
    event.preventDefault();
    choose(active.value);
  }
}
function outside(event: Event) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
watch(
  () => props.disabled,
  (value) => {
    if (value) open.value = false;
  },
);
onMounted(() => {
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('focusin', outside, true);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('focusin', outside, true);
});
</script>
<template>
  <div ref="root" class="base-select" @keydown="key">
    <button
      ref="trigger"
      class="select-trigger"
      :class="{ expanded: open }"
      type="button"
      role="combobox"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="listId"
      aria-haspopup="listbox"
      :aria-activedescendant="open ? `${listId}-${active}` : undefined"
      :disabled="disabled"
      @click="open ? (open = false) : show()"
    >
      <span>{{ selected?.label || '请选择' }}</span
      ><svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4 6 4 4 4-4" />
      </svg>
    </button>
    <div
      v-if="open"
      :id="listId"
      class="select-options"
      role="listbox"
      :aria-label="label"
    >
      <div
        v-for="(option, index) in options"
        :id="`${listId}-${index}`"
        :key="option.value"
        role="option"
        :aria-selected="modelValue === option.value"
        :class="{ active: active === index }"
        @pointerenter="active = index"
        @mousedown.prevent
        @click="choose(index)"
      >
        <span>{{ option.label }}</span
        ><svg
          v-if="modelValue === option.value"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="m3 8 3 3 7-7" />
        </svg>
      </div>
    </div>
  </div>
</template>
<style scoped>
.base-select {
  position: relative;
  min-width: 132px;
  flex-shrink: 0;
  font-size: 13px;
  color: #333;
}
.select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  border-radius: 10px;
  background: #f5f5f7;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background 0.15s;
}
.select-trigger:hover,
.select-trigger.expanded,
.select-trigger:focus-visible {
  background: #eaeaec;
}
.select-trigger:focus,
.select-trigger:focus-visible {
  outline: none;
  box-shadow: none;
}
.select-trigger:disabled {
  opacity: 0.5;
  cursor: wait;
}
svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}
.select-trigger svg {
  color: #8b8b93;
  transition: transform 0.15s;
}
.select-trigger.expanded svg {
  transform: rotate(180deg);
}
.select-options {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 100%;
  padding: 5px;
  box-sizing: border-box;
  border: 1px solid #ededf0;
  border-radius: 12px;
  background: white;
  box-shadow: 0 8px 28px #00000014;
  z-index: 30;
}
.select-options > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
}
.select-options > div.active {
  background: #f5f5f7;
}
.select-options > div[aria-selected='true'] {
  font-weight: 600;
}
</style>
