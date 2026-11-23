// Keep tab rows in browser order while the pointer moves. Both a row and its
// adjacent margin resolve against the same slots, independent of the animation.
export function createOpenTabDrag() {
  let section: HTMLElement | undefined;
  let slots: { row: HTMLElement; id: number; top: number }[] = [];
  let anchors: { id: number; threshold: number }[] = [];
  let origin = -1;
  let gap = -1;
  let sectionWidth = 0;

  function clear() {
    section?.removeAttribute('data-tab-preview');
    for (const { row } of slots) row.style.removeProperty('translate');
    section = undefined;
    slots = [];
    anchors = [];
    gap = -1;
  }

  function hover(group: HTMLElement, clientY: number, sourceId: number, sourceBeforeGroup: boolean) {
    if (section !== group || sectionWidth !== group.clientWidth) {
      clear();
      section = group;
      sectionWidth = group.clientWidth;
      slots = Array.from(group.querySelectorAll<HTMLElement>(':scope > [data-browser-tab-id]'), row => ({
        row, id: Number(row.dataset.browserTabId), top: row.offsetTop,
      }));
      origin = slots.findIndex(slot => slot.id === sourceId);
      anchors = slots.flatMap(({ row, id, top }, i) => {
        if (i === origin) return [];
        const belowSource = origin < 0 ? sourceBeforeGroup : i > origin;
        return [{ id, threshold: top + row.offsetHeight * (belowSource ? .35 : .65) }];
      });
      if (origin >= 0) section.dataset.tabPreview = '';
    }
    const y = clientY - group.getBoundingClientRect().top - group.clientTop;
    // Keep the current insertion point through small hand movements on a threshold.
    const tolerance = gap < 0 ? 0 : 3;
    const previous = gap < 0 ? Math.max(0, origin) : gap;
    let next = previous;
    while (next < anchors.length && y >= anchors[next]!.threshold + tolerance) next++;
    while (next > 0 && y < anchors[next - 1]!.threshold - tolerance) next--;
    if (origin >= 0 && next !== previous) {
      for (let i = Math.min(previous, next); i <= Math.max(previous, next); i++) {
        if (i === origin) continue;
        const rank = i < origin ? i : i - 1;
        const dest = rank < next ? rank : rank + 1;
        slots[i]!.row.style.translate = dest === i ? '' : `0 ${slots[dest]!.top - slots[i]!.top}px`;
      }
    }
    gap = next;
    if (next === origin) return;
    const target = anchors[next] ?? anchors.at(-1);
    if (target) return { id: target.id, after: next === anchors.length };
  }
  function reconcile(groups: { key: string; collapsed: boolean; tabs: { id?: number }[] }[]) {
    if (!section) return;
    const key = section.dataset.sectionKey;
    const group = groups.find(g => g.key === key);
    if (!group || group.collapsed || group.tabs.length !== slots.length ||
      group.tabs.some((tab, index) => tab.id !== slots[index]!.id)) clear();
  }
  return { hover, clear, reconcile };
}
