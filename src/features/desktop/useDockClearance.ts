import { onMounted, onUnmounted, ref, type Ref } from 'vue';

export function useDockClearance(element: Ref<HTMLElement | undefined>, side: 'left' | 'right') {
  const bottom = ref(0);
  let dock: HTMLElement | null;
  let observer: ResizeObserver | undefined;

  function measure() {
    const box = element.value?.getBoundingClientRect();
    const bounds = dock?.getBoundingClientRect();
    const overlaps = box && bounds && (side === 'left'
      ? box.right + 10 > bounds.left
      : box.left < bounds.right + 10);
    bottom.value = overlaps ? Math.ceil(innerHeight - bounds.top + 8) : 0;
  }

  onMounted(() => {
    dock = document.querySelector('.desktop-dock');
    observer = new ResizeObserver(measure);
    if (dock) observer.observe(dock);
    if (element.value) observer.observe(element.value);
    window.addEventListener('resize', measure);
    measure();
  });
  onUnmounted(() => {
    observer?.disconnect();
    window.removeEventListener('resize', measure);
  });
  return bottom;
}
