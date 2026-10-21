// Resolve the fallback before first paint, independently of preview storage.
(() => {
  const root = document.documentElement;
  let dark;
  let light;
  let timer;
  try {
    dark = window.matchMedia('(prefers-color-scheme: dark)');
    light = window.matchMedia('(prefers-color-scheme: light)');
  } catch {
    // Unsupported media queries fall back to local time.
  }
  function update() {
    clearTimeout(timer);
    const now = new Date();
    const systemKnown = dark?.matches || light?.matches;
    const isDark = systemKnown
      ? dark.matches
      : now.getHours() < 7 || now.getHours() >= 19;
    const mode = isDark ? 'dark' : 'light';
    const color = isDark ? '#000000' : '#ffffff';
    root.dataset.fallbackTheme = mode;
    root.style.setProperty('--wallpaper-fallback', color);
    root.style.backgroundColor = color;
    root.style.colorScheme = mode;
    if (!systemKnown) {
      const next = new Date(now);
      next.setHours(
        now.getHours() < 7 ? 7 : now.getHours() < 19 ? 19 : 31,
        0,
        0,
        0,
      );
      timer = setTimeout(update, next.getTime() - now.getTime());
    }
  }
  update();
  dark?.addEventListener?.('change', update);
  light?.addEventListener?.('change', update);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
})();

// Runs before the app bundle. Only a small preview is stored synchronously;
// Dexie remains the source of truth for the full-resolution wallpaper.
(() => {
  try {
    const raw = localStorage.getItem('duoyu:wallpaper-preview');
    if (!raw || raw.length > 180000) return;
    const preview = JSON.parse(raw);
    if (
      typeof preview.data !== 'string' ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(preview.data)
    )
      return;
    const root = document.documentElement;
    root.style.backgroundImage = `url("${preview.data}")`;
    root.style.backgroundSize = 'cover';
    root.style.backgroundPosition = 'center';
    root.style.backgroundAttachment = 'fixed';
    root.style.backgroundRepeat = 'no-repeat';
    root.dataset.wallpaperPreview = 'ready';
  } catch {
    // Invalid or unavailable preview storage must never block the new tab.
  }
})();
