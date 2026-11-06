import { nextTick, onUnmounted, type Ref } from 'vue';

// Anchor each move on its icon. The whole card takes the destination shape
// before it travels, keeping its border and contents together at native size.
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
    for (const card of root.querySelectorAll('[data-saved-id]')) {
      const icon = card.querySelector('.workspace-icon-slot');
      if (!icon) continue;
      const rect = icon.getBoundingClientRect();
      const surface = card.getBoundingClientRect();
      positions.set(card, {
        rect,
        visible: surface.bottom > top && surface.top < bottom,
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
    for (const [card, end] of measure(root)) {
      const start = before.get(card);
      if (!start || (!start.visible && !end.visible)) continue;
      const dx = start.rect.x - end.rect.x;
      const dy = start.rect.y - end.rect.y;
      if (!dx && !dy) continue;
      const animation = card.animate(
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
