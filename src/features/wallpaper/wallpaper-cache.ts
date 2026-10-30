import { accountStorage } from '../../shared/storage/account';
import { database, type WallpaperRecord } from '../../shared/storage/database';
import { saveWallpaperPreview } from './wallpaper-preview';

async function syncPreview(record: WallpaperRecord) {
  const url = URL.createObjectURL(record.blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    saveWallpaperPreview(
      image,
      record.contentHash || `${record.sourceUrl}:${record.savedAt}`,
      record.sourceUrl,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Share the writer's lock: an old tab must never restore an older preview. */
export async function readWallpaperForDisplay() {
  return navigator.locks.request('duoyu:daily-wallpaper', async () => {
    const record = await readWallpaper();
    if (record) {
      try {
        await syncPreview(record);
      } catch {
        /* Refresh will repair corrupt originals. */
      }
    }
    return record;
  });
}

async function fingerprint(blob: Blob) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

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
        contentHash: await fingerprint(blob),
      };
      if (cached && record.contentHash === (await fingerprint(cached.blob))) {
        record.blob = cached.blob;
        record.savedAt = cached.savedAt;
      }
      try {
        // Keep one last-good image; a failed request never deletes it.
        await database.wallpapers.put(record);
        await syncPreview(record);
      } catch {
        // Even when the disk is full, the downloaded image can still be displayed.
      }
      return record;
    },
  );
}

export async function importWallpaper(blob: Blob) {
  if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024)
    throw new Error('请选择不超过 20 MB 的图片');
  const decoded = await decodeWallpaper(blob);
  URL.revokeObjectURL(decoded);
  await navigator.locks.request('duoyu:daily-wallpaper', async () => {
    const record: WallpaperRecord = {
      id: 'daily',
      sourceUrl: 'local:' + (await fingerprint(blob)),
      blob,
      savedAt: Date.now(),
      contentHash: await fingerprint(blob),
    };
    await database.wallpapers.put(record);
    await syncPreview(record);
    accountStorage.setItem('duoyu-wallpaper-mode', 'custom');
  });
  window.dispatchEvent(new Event('duoyu-wallpaper-change'));
}

/** Explicit deletion of the selected local upload. The captured row deletion
 * releases its cloud reference; shared images remain until their final use ends. */
export async function removeUploadedWallpaper() {
  await navigator.locks.request('duoyu:daily-wallpaper', async () => {
    const current = await database.wallpapers.get('daily');
    if (current?.sourceUrl.startsWith('local:'))
      await database.wallpapers.delete('daily');
    accountStorage.removeItem('duoyu:wallpaper-preview');
    accountStorage.removeItem('duoyu-wallpaper-mode');
  });
  window.dispatchEvent(new Event('duoyu-wallpaper-change'));
}
