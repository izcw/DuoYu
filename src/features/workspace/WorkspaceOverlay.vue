<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { isWallpaperBlank } from '../wallpaper/blank-area';
import WorkspaceBoard from './WorkspaceBoard.vue';

const active = defineModel<boolean>({ default: false });
const props = withDefaults(
  defineProps<{ label?: string; blankEntry?: boolean }>(),
  { label: '工作区', blankEntry: true },
);
const workspace = ref<HTMLElement>();
let press: { x: number; y: number; id: number } | undefined;
let previous: HTMLElement | null = null;

function cancel() {
  press = undefined;
}
function down(event: PointerEvent) {
  cancel();
  if (
    !props.blankEntry ||
    document.documentElement.classList.contains('workspace-active') ||
    active.value ||
    event.button !== 0 ||
    !event.isPrimary ||
    // Capture this before wheel handlers close it on the same pointerdown.
    document.querySelector('.radial-wheel[aria-hidden="false"]') !== null ||
    !isWallpaperBlank(event.target)
  )
    return;
  previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  press = { x: event.clientX, y: event.clientY, id: event.pointerId };
}
function move(event: PointerEvent) {
  if (
    press?.id === event.pointerId &&
    Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6
  )
    cancel();
}
function click(event: MouseEvent) {
  const start = press;
  cancel();
  if (
    !start ||
    event.button !== 0 ||
    active.value ||
    !isWallpaperBlank(event.target) ||
    Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6
  )
    return;
  active.value = true;
}
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
  document.documentElement.classList.toggle('workspace-active', value);
  await nextTick();
  if (value && active.value) workspace.value?.focus({ preventScroll: true });
});
function restoreFocus() {
  if (!active.value && previous?.isConnected)
    previous.focus({ preventScroll: true });
}
onMounted(() => {
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('click', click);
  window.addEventListener('blur', cancel);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', down, true);
  document.removeEventListener('pointermove', move, true);
  document.removeEventListener('pointercancel', cancel);
  document.removeEventListener('click', click);
  window.removeEventListener('blur', cancel);
  document.documentElement.classList.remove('workspace-active');
});
</script>

<template>
  <Teleport to="body">
    <Transition name="workspace-fade" @after-leave="restoreFocus">
      <div
        v-if="active"
        ref="workspace"
        class="workspace-overlay glass-surface"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
        @click.self.stop="active = false"
        @contextmenu.prevent.stop
        @keydown="key"
      >
        <slot :close="() => (active = false)"
          ><WorkspaceBoard @close="active = false"
        /></slot>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.newtab,
.wallpaper-status,
body > :not(#app):not(.workspace-overlay) {
  transition:
    opacity 320ms ease,
    visibility 0s;
}
.workspace-active .newtab,
.workspace-active .wallpaper-status,
.workspace-active body > :not(#app):not(.workspace-overlay) {
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
  z-index: 2147483647;
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
  transition: opacity 320ms ease;
}
.workspace-fade-enter-from,
.workspace-fade-leave-to {
  opacity: 0;
}
</style>
