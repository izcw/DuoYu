import { onUnmounted } from 'vue';

// Page-local sorts need a page-controlled cursor. Native HTML drag sessions
// replace it with the operating system's copy/move badge.
export function useMouseSort() {
  let stop: (() => void) | undefined;
  onUnmounted(() => stop?.());
  return function press(event: MouseEvent) {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const source = event.target.closest<HTMLElement>('[draggable="true"]');
    const owner = event.currentTarget as HTMLElement;
    if (
      !source ||
      !owner.contains(source) ||
      (source.closest(".desktop-menu") && !owner.matches(".desktop-menu")) ||
      event.target.closest(
        'input,select,textarea,.workspace-card-actions,.workspace-bookmark',
      )
    )
      return;
    stop?.();
    let started = false;
    const transfer = new DataTransfer();
    function send(type: string, el: Element, e: MouseEvent) {
      return !el.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: e.clientX,
          clientY: e.clientY,
        }),
      );
    }
    function preventNative(e: DragEvent) {
      if (e.isTrusted) e.preventDefault();
    }
    function move(e: MouseEvent) {
      if (!started) {
        if (
          Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 5
        )
          return;
        if (send('dragstart', source!, event)) {
          cleanup();
          return;
        }
        started = true;
        document.documentElement.classList.add('mouse-sorting');
      }
      e.preventDefault();
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit && owner.contains(hit)) {
        const scroll = hit.closest<HTMLElement>(
          '.workspace-collections,.workspace-open-tabs,.side-menu',
        );
        if (scroll) {
          const r = scroll.getBoundingClientRect();
          scroll.scrollTop +=
            e.clientY < r.top + 24 ? -12 : e.clientY > r.bottom - 24 ? 12 : 0;
        }
        send('dragover', hit, e);
      }
    }
    function release(e: MouseEvent) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (started && hit && owner.contains(hit) && send('dragover', hit, e))
        send('drop', hit, e);
      cancel();
    }
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    }
    function cancel() {
      if (started) {
        send('dragend', source!.isConnected ? source! : owner, event);
        const swallow = (e: Event) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
      cleanup();
    }
    function cleanup() {
      document.documentElement.classList.remove('mouse-sorting');
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', release, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('dragstart', preventNative, true);
      stop = undefined;
    }
    stop = cancel;
    document.addEventListener('dragstart', preventNative, true);
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', release, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
  };
}
