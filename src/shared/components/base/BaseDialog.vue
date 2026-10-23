<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
const props = defineProps<{
  open: boolean;
  title: string;
  folder?: boolean;
  width?: number;
  aspectRatio?: number;
}>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
const panel = ref<HTMLElement>();
const titleId = useId();
let previous: HTMLElement | null = null;
function close() {
  emit('update:open', false);
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'input:not(:disabled), button:not(:disabled), a[href], textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ) ?? [],
  );
  const first = controls[0],
    last = controls.at(-1);
  if (!first) {
    event.preventDefault();
    panel.value?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
watch(
  () => props.open,
  async (open) => {
    if (open) {
      previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      await nextTick();
      if (props.open)
        (
          panel.value?.querySelector<HTMLElement>(
            'input,button,[tabindex="0"]',
          ) ?? panel.value
        )?.focus();
    } else if (previous?.isConnected) previous.focus();
  },
  { immediate: true },
);
function escapeOutside(event: KeyboardEvent) {
  if (
    props.open &&
    event.key === 'Escape' &&
    !panel.value?.contains(event.target as Node) &&
    [...document.querySelectorAll('.base-dialog')].at(-1) === panel.value
  )
    key(event);
}
onMounted(() => document.addEventListener('keydown', escapeOutside, true));
onUnmounted(() => {
  document.removeEventListener('keydown', escapeOutside, true);
  if (props.open && previous?.isConnected) previous.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div
      v-if="open"
      class="base-dialog-backdrop"
      @pointerdown.self="close"
      @keydown="key"
    >
      <section
        ref="panel"
        class="base-dialog"
        :style="
          aspectRatio
            ? {
                width: `min(${width || 1160}px, calc(100vw - 32px), calc((100svh - 32px) * ${aspectRatio}))`,
                aspectRatio: String(aspectRatio),
              }
            : width
              ? { width: `min(${width}px, calc(100vw - 32px))` }
              : undefined
        "
        :class="[
          folder ? 'folder-dialog' : 'glass-surface',
          { 'fixed-ratio-dialog': aspectRatio },
        ]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <h2 :id="titleId">
          <slot name="title">{{ title }}</slot>
        </h2>
        <div
          v-if="folder"
          class="folder-dialog-content glass-surface desktop-card-glass"
        >
          <slot :close="close" />
        </div>
        <slot v-else :close="close" />
      </section></div
  ></Teleport>
</template>
<style scoped>
.base-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: #0004;
  display: grid;
  place-items: center;
  backdrop-filter: blur(8px);
}
.base-dialog {
  width: min(360px, calc(100vw - 32px));
  max-height: calc(100svh - 32px);
  overflow: auto;
  padding: 24px;
  border-radius: 26px;
  border: 0;
  color: #fff;
  outline: none;
}
.fixed-ratio-dialog {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.fixed-ratio-dialog > h2 {
  flex-shrink: 0;
}
h2 {
  margin: 0 0 20px;
  font-size: 20px;
}

.folder-dialog {
  width: min(848px, calc(100vw - 32px));
  padding: 0;
  background: none;
}
.folder-dialog h2 {
  text-align: center;
  margin: 0 0 20px;
}
.folder-dialog-content {
  position: relative;
  overflow: hidden;
  padding: 24px;
  border-radius: 28px;
}
</style>
