<script setup lang="ts">
import { nextTick, onUnmounted, ref, useId, watch } from 'vue';
const props = defineProps<{ open: boolean; title: string }>();
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
onUnmounted(() => {
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
        class="base-dialog glass-surface"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <h2 :id="titleId">{{ title }}</h2>
        <slot :close="close" />
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
h2 {
  margin: 0 0 20px;
  font-size: 20px;
}
</style>
