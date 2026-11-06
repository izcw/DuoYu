import { nextTick, onUnmounted, type Ref } from 'vue';

// Measure the existing cards on both sides of the layout change so filtered
// results and partial rows travel to their actual positions at any width.
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
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        '[data-saved-id], .workspace-collection-heading',
      ),
      (el) => {
        const rect = el.getBoundingClientRect();
        const visible = rect.bottom > top && rect.top < bottom;
        const parts = new Map<Element, DOMRect>();
        if (visible) {
          for (const part of el.querySelectorAll(
            '.workspace-icon-slot, .workspace-link > span',
          )) {
            parts.set(part, part.getBoundingClientRect());
          }
        }
        return { el, rect, parts, visible };
      },
    );
  }

  async function changeLayout(update: () => void) {
    const root = container.value;
    const before = root && !reduced.matches ? measure(root) : [];
    stop();
    const current = generation;
    update();
    if (!before.length || !root) return;
    await nextTick();
    if (generation !== current || !root.isConnected) return;
    const after = new Map(measure(root).map((item) => [item.el, item]));
    function animate(el: Element, keyframes: Keyframe[]) {
      const motion = el.animate(keyframes, {
        duration: 540,
        easing: 'cubic-bezier(.22, .7, .2, 1)',
      });
      running.add(motion);
      motion.onfinish = () => running.delete(motion);
    }
    for (const { el, rect: from, visible, parts } of before) {
      const target = after.get(el);
      if (!target || (!visible && !target.visible)) continue;
      const to = target.rect;
      if (!to.width || !to.height) continue;
      const x = from.x - to.x;
      const y = from.y - to.y;
      const sx = from.width / to.width;
      const sy = from.height / to.height;
      if (!x && !y && sx === 1 && sy === 1) continue;
      animate(el, [
        {
          transformOrigin: '0 0',
          transform: `translate(${x}px, ${y}px) scale(${sx}, ${sy})`,
        },
        { transformOrigin: '0 0', transform: 'none' },
      ]);
      // Counter the stretching of the card while its icon and text move from
      // the vertical card arrangement into the horizontal list row.
      for (const [part, start] of parts) {
        const end = target.parts.get(part);
        if (!end || !end.width) continue;
        const iconScale = part.classList.contains('workspace-icon-slot')
          ? start.width / end.width
          : 1;
        const dx = start.x - from.x - (end.x - to.x) * sx;
        const dy = start.y - from.y - (end.y - to.y) * sy;
        animate(
          part,
          [0, 0.25, 0.5, 0.75, 1].map((offset) => {
            const t = 1 - offset;
            const scaleX = 1 + (sx - 1) * t;
            const scaleY = 1 + (sy - 1) * t;
            const size = 1 + (iconScale - 1) * t;
            return {
              offset,
              transformOrigin: '0 0',
              transform: `translate(${(dx * t) / scaleX}px, ${(dy * t) / scaleY}px) scale(${size / scaleX}, ${size / scaleY})`,
            };
          }),
        );
      }
    }
  }
  return { changeLayout, stop };
}
