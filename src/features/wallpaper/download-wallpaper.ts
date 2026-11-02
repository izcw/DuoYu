export type WallpaperProgress = {
  loaded: number;
  total?: number;
  complete: boolean;
};
export async function downloadWallpaper(
  url: string | URL,
  onProgress: (progress: WallpaperProgress) => void,
  options: RequestInit = {},
): Promise<Blob> {
  const response = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Error('壁纸下载失败，请重试');
  const limit = 20 * 1024 * 1024;
  const length = Number(response.headers.get('content-length'));
  const total =
    length > 0 && !response.headers.get('content-encoding')
      ? length
      : undefined;
  if (total && total > limit) throw Error('壁纸超过20MB');
  const reader = response.body?.getReader();
  if (!reader) throw Error('无法读取壁纸下载内容');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  onProgress({ loaded, total, complete: false });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > limit) throw Error('壁纸超过20MB');
      chunks.push(new Uint8Array(value));
      onProgress({ loaded, total, complete: false });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!loaded) throw Error('壁纸下载内容为空');
  onProgress({ loaded, total: loaded, complete: true });
  return new Blob(chunks, {
    type: response.headers.get('content-type') || 'image/jpeg',
  });
}
