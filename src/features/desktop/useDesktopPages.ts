import { nextTick, onMounted, onUnmounted, ref } from 'vue';

export function useDesktopPages(
  blocked: () => boolean,
  step?: (direction: number) => void,
) {
  const page = ref(0);
  const root = ref<HTMLElement>();
  let total = 0;
  let lastWheel = 0;
  let lockedUntil = 0;
  async function go(value: number) {
    if (blocked()) return;
    total = 0;
    lockedUntil = performance.now() + 650;
    if (page.value === value) return;
    page.value = value;
    await nextTick();
    document.dispatchEvent(new Event('desktop-page-change'));
  }
  function wheel(event: WheelEvent) {
    const target = event.target as Element;
    if (
      blocked() ||
      event.ctrlKey ||
      event.buttons ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
      document.querySelector(
        '.radial-wheel[aria-hidden="false"], .ui-draggable-dragging, .grid-selection-dragging, .grid-selection-box, .widget-link-drag-preview, .library-editor, .library-context-menu, .library-page-row.is-dragging',
      ) ||
      target.closest(
        'input, textarea, select, [role="listbox"], .search-suggestions, [role="dialog"]',
      )
    )
      return;
    // Leave nested scrollable content to its own wheel handler.
    for (let el = target; el && el !== root.value; el = el.parentElement!) {
      if (
        el.scrollHeight > el.clientHeight + 2 &&
        /auto|scroll/.test(getComputedStyle(el).overflowY) &&
        (event.deltaY > 0
          ? el.scrollTop + el.clientHeight < el.scrollHeight - 2
          : el.scrollTop > 2)
      )
        return;
    }
    event.preventDefault();
    const now = performance.now();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (now - lastWheel > 160 || Math.sign(total) !== Math.sign(delta))
      total = 0;
    lastWheel = now;
    if (now < lockedUntil) return;
    total += delta;
    if (Math.abs(total) >= 55) {
      const direction = Math.sign(total);
      total = 0;
      lockedUntil = now + 650;
      if (step) step(direction);
      else void go(direction > 0 ? 1 : 0);
    }
  }
  onMounted(() => {
    root.value?.addEventListener('wheel', wheel, { passive: false });
  });
  onUnmounted(() => {
    root.value?.removeEventListener('wheel', wheel);
  });
  return { page, root, go };
}
