/** Only layout gaps count as wallpaper; children such as cards never do. */
export function isWallpaperBlank(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.matches(
      'body, #app, .newtab, .start-panel, .desktop-grid, .bottom-widgets, .bottom-widget-grid',
    )
  );
}
