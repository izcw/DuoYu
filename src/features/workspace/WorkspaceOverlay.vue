<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue';
import WorkspaceBoard from './WorkspaceBoard.vue';

const active = defineModel<boolean>({ default: false });
withDefaults(defineProps<{ label?: string }>(), { label: '工作区' });
const workspace = ref<HTMLElement>();
let previous: HTMLElement | null = null;

function key(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    active.value = false;
  } else if (event.key === 'Tab') {
    const controls = Array.from(
      workspace.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
      ) ?? [],
    ).filter((el) => el.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      workspace.value?.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === workspace.value)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
watch(active, async (value) => {
  if (value) {
    previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  document.documentElement.classList.toggle('workspace-active', value);
  await nextTick();
  if (value && active.value) workspace.value?.focus({ preventScroll: true });
});
function restoreFocus() {
  if (!active.value && previous?.isConnected)
    previous.focus({ preventScroll: true });
}
onUnmounted(() => {
  document.documentElement.classList.remove('workspace-active');
});
</script>

<template>
  <Teleport to="body">
    <Transition name="workspace-fade" @after-leave="restoreFocus">
      <div
        v-if="active"
        ref="workspace"
        class="workspace-overlay glass-focus-layer"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
        @click.self.stop="active = false"
        @contextmenu.prevent.stop
        @keydown="key"
      >
        <slot :close="() => (active = false)"><WorkspaceBoard /></slot>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.newtab,
.wallpaper-status,
body
  > :not(#app):not(.desktop-dock):not(.workspace-overlay):not(
    .base-dialog-backdrop
  ):not(.library-context-menu) {
  transition:
    opacity 320ms ease,
    visibility 0s;
}
.workspace-active .newtab,
.workspace-active .wallpaper-status,
.workspace-active
  body
  > :not(#app):not(.desktop-dock):not(.workspace-overlay):not(
    .base-dialog-backdrop
  ):not(.library-context-menu) {
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition:
    opacity 320ms ease,
    visibility 0s 320ms;
}
.workspace-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: clamp(16px, 3vw, 48px);
  overflow: hidden;
  border: 0;
  border-radius: 0;
  /* Reuse the shared material; a full-screen sheet needs no inset edge. */
  box-shadow: none;
  cursor: default;
}
.workspace-overlay:focus-visible {
  outline: none;
}
.workspace-fade-enter-active,
.workspace-fade-leave-active {
  transition: opacity var(--glass-focus-duration, 320ms) ease;
}
.workspace-fade-enter-from,
.workspace-fade-leave-to {
  opacity: 0;
}
</style>
