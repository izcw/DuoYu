import { database, type WallpaperRecord } from '../../shared/storage/database';

export async function readWallpaper() {
  try {
    return await database.wallpapers.get('daily');
  } catch {
    // Storage failures must not prevent an online wallpaper from being shown.
    return undefined;
  }
}

export async function decodeWallpaper(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('Empty image');
    return url;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function refreshWallpaper(
  sourceUrl: string,
  signal: AbortSignal,
): Promise<WallpaperRecord> {
  // New tabs share this lock so only one downloads today's 4K image at a time.
  return navigator.locks.request(
    'duoyu:daily-wallpaper',
    { signal },
    async () => {
      const cached = await readWallpaper();
      if (cached?.sourceUrl === sourceUrl) {
        try {
          const url = await decodeWallpaper(cached.blob);
          URL.revokeObjectURL(url);
          return cached;
        } catch {
          // A corrupt cache is replaced only after a valid download is ready.
        }
      }
      const response = await fetch(sourceUrl, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error(`Wallpaper HTTP ${response.status}`);
      const blob = await response.blob();
      if (
        !blob.type.startsWith('image/') ||
        !blob.size ||
        blob.size > 20 * 1024 * 1024
      )
        throw new Error('Invalid wallpaper response');
      const decoded = await decodeWallpaper(blob);
      URL.revokeObjectURL(decoded);
      signal.throwIfAborted();
      const record: WallpaperRecord = {
        id: 'daily',
        sourceUrl,
        blob,
        savedAt: Date.now(),
      };
      try {
        // Keep one last-good image; a failed request never deletes it.
        await database.wallpapers.put(record);
      } catch {
        // Even when the disk is full, the downloaded image can still be displayed.
      }
      return record;
    },
  );
}
