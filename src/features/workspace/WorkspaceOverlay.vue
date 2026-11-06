<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import WorkspaceBoard from './WorkspaceBoard.vue';

const active = defineModel<boolean>({ default: false });
withDefaults(defineProps<{ label?: string }>(), { label: '工作区' });
const emit = defineEmits<{ home: [] }>();
const workspace = ref<HTMLElement>();
const board = ref<InstanceType<typeof WorkspaceBoard>>();
let previous: HTMLElement | null = null;

function key(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
    return;
  if (
    event.target === workspace.value &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'f'
  ) {
    event.preventDefault();
    board.value?.focusSearch();
    return;
  }
  const navigation =
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.target instanceof Element &&
    !event.target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="listbox"]',
    );
  const keyName = event.key.toLowerCase();
  if (navigation && ['w', 's', 'arrowup', 'arrowdown'].includes(keyName)) {
    event.preventDefault();
    if (!event.repeat)
      board.value?.stepSpace(keyName === 'w' || keyName === 'arrowup' ? -1 : 1);
    return;
  }
  if (
    event.key === 'Escape' ||
    (navigation && (keyName === 'a' || keyName === 'arrowleft'))
  ) {
    event.preventDefault();
    event.stopPropagation();
    active.value = false;
    emit('home');
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
function keyAfterRemoval(event: KeyboardEvent) {
  // Removing a focused collection can leave focus on body.
  if (
    active.value &&
    !event.defaultPrevented &&
    ['escape', 'arrowleft', 'a', 'w', 's', 'arrowup', 'arrowdown'].includes(
      event.key.toLowerCase(),
    ) &&
    !document.querySelector(
      'dialog[open], .base-dialog-backdrop, [role="menu"]:not([inert],[aria-hidden="true"])',
    ) &&
    (event.target === document.body ||
      event.target === document.documentElement)
  )
    key(event);
}
onMounted(() => document.addEventListener('keydown', keyAfterRemoval));
onUnmounted(() => {
  document.removeEventListener('keydown', keyAfterRemoval);
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
        <slot :close="() => (active = false)"
          ><WorkspaceBoard ref="board" @close="active = false"
        /></slot>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.newtab,
.wallpaper-status,
body
  > :not(#app):not(.desktop-dock):not(.desktop-top-actions):not(
    .account-entry
  ):not(.desktop-switch-entry):not(.desktop-drawer):not(.workspace-overlay):not(
    .base-dialog-backdrop
  ):not(.library-context-menu):not(.drag-landing-preview):not(.radial-wheel) {
  transition:
    opacity 320ms ease,
    visibility 0s;
}
.workspace-active .newtab,
.workspace-active .wallpaper-status,
.workspace-active
  body
  > :not(#app):not(.desktop-dock):not(.desktop-top-actions):not(
    .account-entry
  ):not(.desktop-switch-entry):not(.desktop-drawer):not(.workspace-overlay):not(
    .base-dialog-backdrop
  ):not(.library-context-menu):not(.drag-landing-preview) {
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
