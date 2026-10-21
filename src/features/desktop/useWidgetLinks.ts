import { onMounted, onUnmounted, ref } from 'vue';
import { database } from '../../shared/storage/database';
import { WIDGET_GROUPS, type WidgetLink } from './widget-links';

export function useWidgetLinks() {
  const cards = ref(
    WIDGET_GROUPS.map((group) => ({ ...group, links: [...group.links] })),
  );
  const linkDrag = ref<{
    pointerId: number;
    groupId: string;
    link: WidgetLink;
    x: number;
    y: number;
    startX: number;
    startY: number;
    active: boolean;
  }>();
  const dropTarget = ref<{ groupId: string; index: number }>();
  const notice = ref('');
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  const ready = ref(false);
  let original: typeof cards.value | undefined;
  function message(text: string) {
    notice.value = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = ''), 2500);
  }
  function save() {
    const groups = cards.value.map((group) => ({
      id: group.id,
      linkIds: group.links.map((link) => link.id),
    }));
    queue = queue
      .then(async () => {
        await database.widgetLayouts.put({ id: 'categories', groups });
      })
      .catch(() => message('保存失败，当前排列仅在本页生效'));
  }
  function startLinkDrag(
    event: PointerEvent,
    groupId: string,
    link: WidgetLink,
  ) {
    if (!ready.value || event.button !== 0 || !event.isPrimary) return;
    original = cards.value.map((group) => ({
      ...group,
      links: [...group.links],
    }));
    linkDrag.value = {
      pointerId: event.pointerId,
      groupId,
      link,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  }
  function move(event: PointerEvent) {
    const drag = linkDrag.value;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (
      !drag.active &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6
    )
      return;
    if (!drag.active)
      document
        .querySelector<HTMLElement>('.bottom-widgets')
        ?.setPointerCapture(event.pointerId);
    drag.active = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (event.cancelable) event.preventDefault();
    // Hit-test fixed grid cells, not the icons currently moving through them.
    const grids = Array.from(
      document.querySelectorAll<HTMLElement>('[data-link-group]'),
    );
    const target = grids.find((grid) => {
      const box = grid.getBoundingClientRect();
      return (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      );
    });
    dropTarget.value = undefined;
    if (!target) return;
    const box = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const gapX = parseFloat(style.columnGap) || 0,
      gapY = parseFloat(style.rowGap) || 0;
    const col = Math.min(
      3,
      Math.max(
        0,
        Math.floor((event.clientX - box.left) / ((box.width + gapX) / 4)),
      ),
    );
    const row = Math.min(
      1,
      Math.max(
        0,
        Math.floor((event.clientY - box.top) / ((box.height + gapY) / 2)),
      ),
    );
    const index = row * 4 + col;
    const destination = cards.value.find(
      (group) => group.id === target.dataset.linkGroup,
    );
    const source = cards.value.find((group) =>
      group.links.some((link) => link.id === drag.link.id),
    );
    if (!source || !destination) return;
    dropTarget.value = { groupId: destination.id, index };
    if (source !== destination && destination.links.length >= 8) return;
    const from = source.links.findIndex((link) => link.id === drag.link.id);
    const to = Math.min(
      index,
      destination.links.length - (source === destination ? 1 : 0),
    );
    if (source === destination && from === to) return;
    const [link] = source.links.splice(from, 1);
    destination.links.splice(to, 0, link!);
  }
  function cancel() {
    if (original) cards.value = original;
    original = undefined;
    linkDrag.value = undefined;
    dropTarget.value = undefined;
  }
  let suppressUntil = 0;
  function up(event: PointerEvent) {
    const drag = linkDrag.value;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) {
      suppressUntil = performance.now() + 400;
      const destination = cards.value.find(
        (group) => group.id === dropTarget.value?.groupId,
      );
      if (
        destination &&
        dropTarget.value &&
        destination.links.some((link) => link.id === drag.link.id)
      ) {
        original = undefined;
        save();
      } else if (destination && destination.links.length >= 8) {
        message('这张卡片已满，最多放置 8 个图标');
      }
    }
    cancel();
  }
  function click(event: MouseEvent) {
    if (performance.now() < suppressUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressUntil = 0;
    }
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && linkDrag.value) {
      if (linkDrag.value.active) suppressUntil = performance.now() + 400;
      cancel();
    }
  }
  onMounted(async () => {
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key);
    window.addEventListener('blur', cancel);
    try {
      const stored = await database.widgetLayouts.get('categories');
      if (stored) {
        const all = new Map(
          WIDGET_GROUPS.flatMap((group) => group.links).map((link) => [
            link.id,
            link,
          ]),
        );
        const used = new Set<string>();
        cards.value = cards.value.map((group) => ({
          ...group,
          links: (
            stored.groups.find((entry) => entry.id === group.id)?.linkIds ?? []
          )
            .flatMap((id) => {
              const link = all.get(id);
              if (!link || used.has(id)) return [];
              used.add(id);
              return [link];
            })
            .slice(0, 8),
        }));
        for (const group of WIDGET_GROUPS)
          for (const link of group.links)
            if (!used.has(link.id)) {
              const destination =
                cards.value.find(
                  (item) => item.id === group.id && item.links.length < 8,
                ) ?? cards.value.find((item) => item.links.length < 8);
              destination?.links.push(link);
            }
      }
    } catch {
      message('无法读取本地布局，已使用默认排列');
    } finally {
      ready.value = true;
    }
  });
  onUnmounted(() => {
    clearTimeout(noticeTimer);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key);
    window.removeEventListener('blur', cancel);
  });
  return { cards, ready, linkDrag, dropTarget, notice, startLinkDrag };
}
