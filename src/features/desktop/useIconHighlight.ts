import { onMounted, onUnmounted } from 'vue';

/** One delegated listener covers desktop icons and teleported editor previews. */
export function useIconHighlight() {
  let active: HTMLElement | null = null;
  function tiltTarget(icon: HTMLElement) {
    return icon.matches('.cell-panel.widget-card')
      ? icon.closest<HTMLElement>('.grid-stack-item') || icon
      : icon;
  }
  function clear() {
    active?.removeAttribute('data-highlight');
    if (active) {
      tiltTarget(active).style.setProperty('--icon-tilt-x', '0deg');
      tiltTarget(active).style.setProperty('--icon-tilt-y', '0deg');
    }
    active = null;
  }
  function move(event: PointerEvent) {
    if (event.pointerType === 'touch' || event.buttons) {
      clear();
      return;
    }
    const icon =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.cell-panel.widget-card') ||
          event.target.closest<HTMLElement>('.cell-icon')
        : null;
    if (
      icon?.closest(
        '.ui-draggable-dragging, .grid-selection-dragging, .ui-resizable-resizing',
      )
    ) {
      clear();
      return;
    }
    if (icon !== active) {
      clear();
      active = icon;
    }
    if (!active) return;
    const bounds = active.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    // Convert viewport coordinates to local CSS pixels, including scaled icons.
    const x =
      ((event.clientX - bounds.left) * active.offsetWidth) / bounds.width -
      active.clientLeft;
    const y =
      ((event.clientY - bounds.top) * active.offsetHeight) / bounds.height -
      active.clientTop;
    active.style.setProperty('--icon-light-x', `${x}px`);
    active.style.setProperty('--icon-light-y', `${y}px`);
    // Larger cards need faster falloff; do not impose a minimum angle.
    const item = active.closest<HTMLElement>('.grid-stack-item');
    const width = Number(
      item?.getAttribute('gs-w') || item?.dataset.width || 1,
    );
    const height = Number(
      item?.getAttribute('gs-h') || item?.dataset.height || 1,
    );
    const span = Math.max(
      1,
      Number.isFinite(width) ? width : 1,
      Number.isFinite(height) ? height : 1,
    );
    const maxAngle = 6 / Math.pow(span, 1.5);
    // Preserve LumeHub's eased pointer response.

    const ease = (value: number) => {
      const clamped = Math.max(-1, Math.min(1, value));
      return Math.sign(clamped) * Math.pow(Math.abs(clamped), 1.3);
    };
    tiltTarget(active).style.setProperty(
      '--icon-tilt-x',
      `${ease((y / active.clientHeight) * 2 - 1) * maxAngle}deg`,
    );
    tiltTarget(active).style.setProperty(
      '--icon-tilt-y',
      `${-ease((x / active.clientWidth) * 2 - 1) * maxAngle}deg`,
    );
    active.setAttribute('data-highlight', 'true');
  }
  onMounted(() => {
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', clear);
    document.addEventListener('pointerdown', clear);
    window.addEventListener('blur', clear);
  });
  onUnmounted(() => {
    clear();
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerleave', clear);
    document.removeEventListener('pointerdown', clear);
    window.removeEventListener('blur', clear);
  });
}
