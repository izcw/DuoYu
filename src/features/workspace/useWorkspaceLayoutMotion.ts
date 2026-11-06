import { nextTick, onUnmounted, type Ref } from 'vue';

// The glass surfaces always use the destination layout. Only their contents
// travel, so the border, shadow and hit area keep their actual dimensions.
export function useWorkspaceLayoutMotion(
  container: Ref<HTMLElement | undefined>,
) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Set<Animation>();
  let generation = 0;
  function stop() {
    generation++;
    for (const animation of running) animation.cancel();
    running.clear();
  }
  reduced.addEventListener('change', stop);
  onUnmounted(() => {
    reduced.removeEventListener('change', stop);
    stop();
  });

  function measure(root: HTMLElement) {
    const bounds = root.getBoundingClientRect();
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(innerHeight, bounds.bottom);
    const positions = new Map<Element, { rect: DOMRect; visible: boolean }>();
    for (const part of root.querySelectorAll(
      '[data-saved-id] .workspace-icon-slot, [data-saved-id] .workspace-link > span',
    )) {
      const rect = part.getBoundingClientRect();
      positions.set(part, {
        rect,
        visible: rect.bottom > top && rect.top < bottom,
      });
    }
    return positions;
  }

  async function changeLayout(update: () => void) {
    const root = container.value;
    // On reversal, start from the currently painted positions before cancelling.
    const before = root && !reduced.matches ? measure(root) : undefined;
    stop();
    const current = generation;
    update();
    if (!before?.size || !root) return;
    await nextTick();
    if (generation !== current || !root.isConnected) return;
    for (const [part, end] of measure(root)) {
      const start = before.get(part);
      if (!start || (!start.visible && !end.visible)) continue;
      const dx = start.rect.x - end.rect.x;
      const dy = start.rect.y - end.rect.y;
      if (!dx && !dy) continue;
      const animation = part.animate(
        [
          { transform: 'translate(' + dx + 'px, ' + dy + 'px)' },
          { transform: 'none' },
        ],
        { duration: 540, easing: 'cubic-bezier(.22, .7, .2, 1)' },
      );
      running.add(animation);
      animation.onfinish = () => running.delete(animation);
    }
  }
  return { changeLayout, stop };
}
