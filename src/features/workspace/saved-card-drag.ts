type Slot = { left: number; top: number; width: number; height: number };

// The DOM keeps its real order until release. Translate neighbours into fixed grid slots
// so hit testing never follows a moving card or updates another collection.
export function createSavedCardDrag() {
  let source: HTMLElement | undefined;
  let grid: HTMLElement | undefined;
  let extra: HTMLElement | undefined;
  let cards: HTMLElement[] = [];
  let slots: Slot[] = [];
  let origin = -1, gap = -1, width = 0, height = 0, count = 0;
  let position: { group: string; before?: string } | undefined;

  function leave() {
    grid?.removeAttribute('data-card-preview');
    for (const card of cards) if (card.style.translate) card.style.removeProperty('translate');
    extra?.remove();
    extra = grid = undefined;
    cards = [];
    slots = [];
    gap = -1;
  }
  function stop() {
    leave();
    source?.classList.remove('is-drag-source');
    source = undefined;
    position = undefined;
  }
  function start(card: HTMLElement) {
    stop();
    source = card;
    card.classList.add('is-drag-source');
  }
  function measure(target: HTMLElement) {
    leave();
    grid = target;
    cards = Array.from(target.querySelectorAll<HTMLElement>(':scope > [data-saved-id]'));
    origin = source ? cards.indexOf(source) : -1;
    target.dataset.cardPreview = '';
    if (origin < 0 && source) {
      extra = document.createElement('div');
      extra.setAttribute('aria-hidden', 'true');
      extra.style.height = source.offsetHeight + 'px';
      target.append(extra);
    }
    slots = (extra ? [...cards, extra] : cards).map(el => ({
      left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight,
    }));
    width = target.clientWidth;
    height = target.clientHeight;
    count = target.childElementCount;
  }
  function moveGap(next: number) {
    if (gap === next) return;
    const previous = gap < 0 ? (origin < 0 ? cards.length : origin) : gap;
    gap = next;
    for (let i = Math.min(previous, next); i <= Math.min(cards.length - 1, Math.max(previous, next)); i++) {
      if (i === origin) continue;
      const rank = origin >= 0 && i > origin ? i - 1 : i;
      const dest = slots[rank < next ? rank : rank + 1]!;
      const from = slots[i]!;
      cards[i]!.style.translate = dest === from ? '' : `${dest.left - from.left}px ${dest.top - from.top}px`;
    }
  }
  function hover(group: HTMLElement, event: DragEvent, list: boolean, atEnd = false) {
    const id = group.dataset.collectionId!;
    const target = group.querySelector<HTMLElement>('.workspace-saved-tabs');
    if (!target) {
      leave();
      position = { group: id };
      return;
    }
    if (grid !== target || width !== target.clientWidth || height !== target.clientHeight || count !== target.childElementCount)
      measure(target);
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let index = slots.length - 1;
    const last = slots[index];
    if (!atEnd && last && y < rect.height && !(y >= last.top && (x >= last.left + last.width || y >= last.top + last.height))) {
      let bestY = Infinity, bestX = Infinity;
      for (const [i, slot] of slots.entries()) {
        const dy = Math.abs(y - slot.top - slot.height / 2);
        const dx = Math.abs(x - slot.left - slot.width / 2);
        if (dy < bestY || (dy === bestY && dx < bestX)) {
          index = i;
          bestY = dy;
          bestX = dx;
        }
      }
      const near = slots[index]!;
      if (origin < 0 && (list ? y > near.top + near.height / 2 : x > near.left + near.width / 2))
        index = Math.min(index + 1, cards.length);
    }
    moveGap(index);
    const before = cards[origin >= 0 && index >= origin ? index + 1 : index]?.dataset.savedId;
    position = { group: id, before };
  }
  return { start, hover, stop, invalidate: leave, get position() { return position; } };
}
