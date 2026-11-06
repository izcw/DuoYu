import { nextTick, onMounted, onUnmounted, ref } from 'vue';

export function useDesktopPages(
  blocked: () => boolean,
  step: (direction: number) => void,
  openWorkspace: () => void,
) {
  const page = ref(0);
  const root = ref<HTMLElement>();
  let total = 0;
  let lastWheel = 0;
  let lockedUntil = 0;
  const busySurface =
    '.radial-wheel[aria-hidden="false"], .ui-draggable-dragging, .grid-selection-dragging, .grid-selection-box, .widget-link-drag-preview, .library-editor, .library-context-menu, .library-page-row.is-dragging';
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
      document.querySelector(busySurface) ||
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
      step(direction);
    }
  }
  function keydown(event: KeyboardEvent) {
    if (
      blocked() ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.repeat ||
      !(event.target instanceof Element) ||
      event.target.closest(
        '.search-form, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="listbox"]',
      ) ||
      document.querySelector(
        busySurface +
          ', dialog[open], [role="dialog"]:not([inert],[aria-hidden="true"]), [role="menu"]:not([inert],[aria-hidden="true"])',
      )
    )
      return;
    switch (event.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        step(-1);
        break;
      case 's':
      case 'arrowdown':
        step(1);
        break;
      case 'a':
      case 'arrowleft':
      case 'escape':
        if (page.value !== 0) void go(0);
        break;
      case 'd':
      case 'arrowright':
        openWorkspace();
        break;
      default:
        return;
    }
    event.preventDefault();
  }
  onMounted(() => {
    root.value?.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keydown);
  });
  onUnmounted(() => {
    root.value?.removeEventListener('wheel', wheel);
    window.removeEventListener('keydown', keydown);
  });
  return { page, root, go };
}
