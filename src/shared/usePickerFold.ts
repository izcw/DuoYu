import { onMounted, onUnmounted, type Ref } from 'vue';

// Project the source distance along a quarter circle onto the visible edge.
function project(y: number, top: number, bottom: number, height: number) {
  if (top > 0 && y < top)
    return top * (1 - Math.sin(Math.min(Math.PI / 2, (top - y) / top)));
  if (bottom > 0 && y > height - bottom)
    return (
      height -
      bottom +
      bottom * Math.sin(Math.min(Math.PI / 2, (y - height + bottom) / bottom))
    );
  return y;
}

export function usePickerFold(viewport: Ref<HTMLElement | undefined>) {
  let cells: { el: HTMLElement; x: number; y: number; height: number }[] = [];
  let frame = 0;
  let observer: ResizeObserver | undefined;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function measure() {
    const box = viewport.value;
    if (!box) return;
    cells = Array.from(
      box.querySelectorAll<HTMLElement>('h3, [data-choice]'),
      (el) => ({
        el,
        x: el.offsetLeft + el.offsetWidth / 2 - box.clientWidth / 2,
        y: el.offsetTop,
        height: el.offsetHeight,
      }),
    );
    draw();
  }
  function draw() {
    frame = 0;
    const box = viewport.value;
    if (!box) return;
    const height = box.clientHeight,
      scroll = box.scrollTop;
    const radius = motion.matches ? 0 : Math.min(42, height / 4);
    const top = Math.min(radius, scroll / 2);
    const bottom = Math.min(
      radius,
      Math.max(0, box.scrollHeight - height - scroll) / 2,
    );
    for (const cell of cells) {
      const y = cell.y - scroll,
        end = y + cell.height;
      const atTop = top > 0 && end > top * (1 - Math.PI / 2) && y < top;
      const atBottom =
        bottom > 0 &&
        end > height - bottom &&
        y < height + bottom * (Math.PI / 2 - 1);
      if (!atTop && !atBottom) {
        if (cell.el.style.transform) {
          cell.el.style.removeProperty('transform');
          cell.el.style.removeProperty('opacity');
        }
        continue;
      }
      const start = project(y, top, bottom, height);
      const finish = project(end, top, bottom, height);
      const middle = (start + finish) / 2;
      const depth = Math.max(
        0,
        atTop ? 1 - middle / top : 1 - (height - middle) / bottom,
      );
      const width = 1 - 0.065 * depth * depth;
      // Transform the actual control including its hit area, focus ring and selection.
      cell.el.style.transform = `translate(${cell.x * (width - 1)}px,${middle - (y + end) / 2}px) scale(${width},${(finish - start) / cell.height})`;
      cell.el.style.opacity = String(1 - 0.3 * depth ** 1.5);
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  onMounted(() => {
    const box = viewport.value!;
    measure();
    observer = new ResizeObserver(measure);
    observer.observe(box);
    for (const section of box.children) observer.observe(section);
    motion.addEventListener('change', schedule);
  });
  onUnmounted(() => {
    observer?.disconnect();
    motion.removeEventListener('change', schedule);
    cancelAnimationFrame(frame);
  });
  return schedule;
}
