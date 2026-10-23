/** Grid bounds own selection and menus; surrounding layout gaps own wallpaper gestures. */
export function isInsideDesktopGrid(point: {
  clientX: number;
  clientY: number;
}): boolean {
  return [...document.querySelectorAll<HTMLElement>('.library-cell-grid')].some(
    (grid) => {
      if (grid.closest('[inert], [aria-hidden="true"]')) return false;
      const rect = grid.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        point.clientX >= rect.left &&
        point.clientX < rect.right &&
        point.clientY >= rect.top &&
        point.clientY < rect.bottom
      );
    },
  );
}
export function isWallpaperBlank(
  target: EventTarget | null,
  point?: { clientX: number; clientY: number },
): boolean {
  if (
    !(target instanceof Element) ||
    target.closest('[role="dialog"], [inert]')
  )
    return false;
  if (point ? isInsideDesktopGrid(point) : target.closest('.library-cell-grid'))
    return false;
  return target.matches(
    'body, #app, .newtab, .start-panel, .desktop-grid, .bottom-widgets, .bottom-widget-grid, .desktop-spacer, .desktop-header, .desktop-content, .desktop-library, .library-board, .library-scroll, .library-grid-container',
  );
}
