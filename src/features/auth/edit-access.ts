import { ref, type Directive } from 'vue';
import { guestMode } from '../../shared/storage/account';

export const loginPromptOpen = ref(false);

/** Check at the user's edit gesture, before optimistic or persistent changes. */
export function requireAccount() {
  if (guestMode) loginPromptOpen.value = true;
  return !guestMode;
}

function intercept(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  requireAccount();
}
function selectKey(event: KeyboardEvent) {
  if (!['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
    intercept(event);
}
export const vAccountEdit: Directive<HTMLElement> = {
  mounted(el) {
    if (!guestMode) return;
    el.addEventListener('click', intercept, true);
    if (el instanceof HTMLSelectElement) {
      el.addEventListener('pointerdown', intercept, true);
      el.addEventListener('keydown', selectKey, true);
      el.addEventListener('change', intercept, true);
    }
  },
  unmounted(el) {
    el.removeEventListener('click', intercept, true);
    el.removeEventListener('pointerdown', intercept, true);
    el.removeEventListener('keydown', selectKey, true);
    el.removeEventListener('change', intercept, true);
  },
};

// A normal click on a draggable link or desktop is still navigation.
let stopGesture: (() => void) | undefined;
function watchDrag(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch')
    return;
  stopGesture?.();
  const cleanup = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', cleanup, true);
    window.removeEventListener('pointercancel', cleanup, true);
    window.removeEventListener('blur', cleanup);
    stopGesture = undefined;
  };
  const move = (next: PointerEvent) => {
    if (
      next.pointerId !== event.pointerId ||
      Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 7
    )
      return;
    cleanup();
    requireAccount();
  };
  stopGesture = cleanup;
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', cleanup, true);
  window.addEventListener('pointercancel', cleanup, true);
  window.addEventListener('blur', cleanup);
}
export const vAccountDrag: Directive<HTMLElement> = {
  mounted(el, binding) {
    if (guestMode && binding.value !== false)
      el.addEventListener('pointerdown', watchDrag, true);
  },
  unmounted(el) {
    el.removeEventListener('pointerdown', watchDrag, true);
  },
};
