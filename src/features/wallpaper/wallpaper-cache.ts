import { activeDesktop, saveDesktopChoice } from './desktops';
import { readDesktop } from './desktop-profile';
import {
  downloadWallpaper,
  type WallpaperProgress,
} from './download-wallpaper';
import { getDailyWallpaperUrl } from './wallpaper';
import { cacheAsset } from '../sync/assets';

import { database, type WallpaperRecord } from '../../shared/storage/database';

async function decodeImage(image: HTMLImageElement, timeout = 15_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('壁纸图片解码超时，请重试')),
          timeout,
        );
      }),
    ]);
  } catch (error) {
    image.src = '';
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
// Daily downloads are a device cache. This table is never uploaded.
export async function readDailyCache(): Promise<WallpaperRecord | undefined> {
  return (await database.syncMeta.get('dailyImageCache'))?.value as
    WallpaperRecord | undefined;
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

async function prepareWallpaperImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await decodeImage(image);
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('Empty image');
    return { url, image };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
export async function decodeWallpaper(blob: Blob): Promise<string> {
  return (await prepareWallpaperImage(blob)).url;
}

export async function refreshWallpaper(
  sourceUrl: string,
  signal: AbortSignal,
  onProgress?: (value: WallpaperProgress) => void,
): Promise<WallpaperRecord> {
  // New tabs share this lock so only one downloads today's 4K image at a time.
  return navigator.locks.request(
    'duoyu:daily-wallpaper',
    { signal },
    async () => {
      const cached = await readDailyCache();
      if (cached?.sourceUrl === sourceUrl) {
        try {
          const url = await decodeWallpaper(cached.blob);
          URL.revokeObjectURL(url);
          return cached;
        } catch {
          // A corrupt cache is replaced only after a valid download is ready.
        }
      }
      const blob = await downloadWallpaper(
        sourceUrl,
        onProgress ?? (() => {}),
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
          referrerPolicy: 'no-referrer',
        },
      );
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
        await database.syncMeta.put({ id: 'dailyImageCache', value: record });
      } catch {
        // Even when the disk is full, the downloaded image can still be displayed.
      }
      return record;
    },
  );
}

export async function importWallpaper(blob: Blob, selection = 'upload') {
  if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024)
    throw new Error('请选择不超过 20 MB 的图片');
  const desktopId = activeDesktop.value;
  const prepared = await prepareWallpaperImage(blob);
  try {
    const asset = await cacheAsset(blob);
    await database.transaction('rw', database.preferences, async () => {
      await saveDesktopChoice(desktopId, selection, asset);
      await database.preferences.put({
        id:
          selection === 'upload'
            ? 'savedWallpaper:upload'
            : 'savedWallpaper:store',
        value: {
          selection,
          blob: asset,
          contentHash: asset.slice('duoyu-asset:'.length),
        },
      });
    });
  } finally {
    URL.revokeObjectURL(prepared.url);
  }
}

export async function removeUploadedWallpaper() {
  const id = activeDesktop.value;
  await database.transaction(
    'rw',
    database.preferences,
    database.wallpapers,
    database.syncShadow,
    async () => {
      const profile = await readDesktop(id);
      if (profile.selection === 'upload') await saveDesktopChoice(id, 'daily');
      await database.preferences.delete('savedWallpaper:upload');
    },
  );
}

export async function selectDailyWallpaper(
  onProgress?: (value: WallpaperProgress) => void,
) {
  const id = activeDesktop.value;
  if (onProgress) {
    const record = await refreshWallpaper(
      getDailyWallpaperUrl(),
      AbortSignal.timeout(20000),
      onProgress,
    );
    onProgress({
      loaded: record.blob.size,
      total: record.blob.size,
      complete: true,
    });
  }
  await database.transaction('rw', database.preferences, async () => {
    await saveDesktopChoice(id, 'daily');
    await database.preferences.put({
      id: 'savedWallpaper:store',
      value: { selection: 'daily' },
    });
  });
}
