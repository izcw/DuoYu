const PREVIEW_KEY = 'duoyu:wallpaper-preview';
const MAX_PREVIEW_LENGTH = 180_000;

/** Best-effort startup thumbnail; the original image stays in Dexie. */
export function saveWallpaperPreview(image: HTMLImageElement, version: string) {
  try {
    const stored = localStorage.getItem(PREVIEW_KEY);
    if (stored) {
      try {
        const preview = JSON.parse(stored);
        if (
          preview.version === version &&
          typeof preview.data === 'string' &&
          /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(preview.data)
        )
          return;
      } catch {
        // Replace malformed startup data with a fresh preview.
      }
    }
    if (!image.naturalWidth || !image.naturalHeight) return;
    const scale = Math.min(
      1,
      960 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.65);
    const preview = JSON.stringify({ version, data });
    if (preview.length <= MAX_PREVIEW_LENGTH)
      localStorage.setItem(PREVIEW_KEY, preview);
  } catch {
    // Quota, decode and privacy restrictions do not affect the 4K wallpaper.
  }
}
