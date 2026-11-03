import { nextTick } from 'vue';

/** Transfer the browser drag image to a fixed visual, then land at the committed DOM position. */
export function createDragLanding() {
  let clone: HTMLElement | undefined;
  let root: HTMLElement | undefined;
  let selector = '';
  let offsetX = 0,
    offsetY = 0,
    x = 0,
    y = 0;
  let committing = false;
  let animation: Animation | undefined;
  let target: HTMLElement | undefined;
  function dispose() {
    document.removeEventListener('dragover', track, true);
    document.removeEventListener('mousemove', track, true);
    window.removeEventListener('blur', dispose);
    animation?.cancel();
    animation = undefined;
    clone?.remove();
    clone = undefined;
    target?.classList.remove('drag-landing-target');
    target = undefined;
    root?.classList.remove('drag-landing');
    committing = false;
  }
  function capture(
    event: MouseEvent,
    source: HTMLElement,
    targetSelector: string,
    options: { transparentSurface?: boolean } = {},
  ) {
    dispose();
    root = source.closest<HTMLElement>('.desktop-dock')
      ? document.body
      : source.closest<HTMLElement>('.workspace-board') || document.body;
    selector = targetSelector;
    const bounds = source.getBoundingClientRect();
    offsetX = event.clientX - bounds.left;
    offsetY = event.clientY - bounds.top;
    x = event.clientX;
    y = event.clientY;
    clone = source.cloneNode(true) as HTMLElement;
    // Freeze computed styles, including inherited glass variables, before removing source layout.
    const originals = [source, ...source.querySelectorAll<HTMLElement>('*')];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
    originals.forEach((el, index) => {
      const css = getComputedStyle(el);
      for (const property of css)
        copies[index]!.style.setProperty(
          property,
          css.getPropertyValue(property),
        );
      copies[index]!.removeAttribute('id');
      for (const attribute of [...copies[index]!.attributes]) {
        if (attribute.name.startsWith('data-'))
          copies[index]!.removeAttribute(attribute.name);
      }
    });
    clone.className = 'drag-landing-preview';
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${bounds.left}px`,
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      margin: '0',
      transform: 'none',
      transition: 'none',
      pointerEvents: 'none',
      zIndex: '2147483647',
      opacity: '1',
    });
    if (options.transparentSurface) {
      Object.assign(clone.style, {
        background: 'transparent',
        backdropFilter: 'none',
        boxShadow: 'none',
        border: '0',
        outline: 'none',
      });
    }
    // Chromium fades native drag images. Track a DOM preview instead.
    const blank = document.createElement('canvas');
    blank.width = blank.height = 1;
    blank.getContext('2d')?.clearRect(0, 0, 1, 1);
    root.append(clone);
    if (event instanceof DragEvent)
      event.dataTransfer?.setDragImage(blank, 0, 0);
    else document.addEventListener('mousemove', track, true);
    document.addEventListener('dragover', track, true);
    window.addEventListener('blur', dispose);
  }
  function track(event: MouseEvent) {
    if (committing) return;
    x = event.clientX;
    y = event.clientY;
    if (clone) {
      clone.style.left = `${x - offsetX}px`;
      clone.style.top = `${y - offsetY}px`;
    }
  }
  async function commit(
    action: () => Promise<void>,
    restore: () => void,
    sync: () => Promise<void>,
  ) {
    committing = true;
    root?.classList.add('drag-landing');
    if (clone && root) {
      Object.assign(clone.style, {
        left: `${x - offsetX}px`,
        top: `${y - offsetY}px`,
        opacity: '1',
      });
      root.append(clone);
    }
    try {
      await action();
      await sync();
    } finally {
      restore();
      await nextTick();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      target = root?.querySelector<HTMLElement>(selector) || undefined;
      if (
        clone &&
        target &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        const from = clone.getBoundingClientRect(),
          to = target.getBoundingClientRect();
        target.classList.add('drag-landing-target');
        animation = clone.animate(
          [
            { transform: 'translate(0, 0) scale(1, 1)' },
            {
              transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`,
            },
          ],
          {
            duration: 180,
            easing: 'cubic-bezier(.2,.8,.2,1)',
            fill: 'forwards',
          },
        );
        clone.style.transformOrigin = 'top left';
        await animation.finished.catch(() => {});
      }
      dispose();
    }
  }
  return {
    capture,
    setTarget(value: string) {
      selector = value;
    },
    track,
    commit,
    dispose,
    get committing() {
      return committing;
    },
  };
}
