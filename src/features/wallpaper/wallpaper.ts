/** API docs: https://api-bimg-cc.apifox.cn/ — uhd=true requests the 4K image. */
export function getDailyWallpaperUrl(date = new Date()): string {
  const url = new URL('https://api.bimg.cc/today');
  url.searchParams.set('uhd', 'true');
  url.searchParams.set('mkt', 'zh-CN');
  // Local calendar date invalidates the browser cache once per day.
  url.searchParams.set(
    'date',
    `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
  );
  return url.toString();
}

/** Gallery thumbnails are never used as the desktop source. */
export function getBingOriginalUrl(source: string): string {
  const url = new URL(source);
  if (url.protocol !== 'https:' || !/^(www\.)?bing\.com$/.test(url.hostname))
    throw new Error('壁纸地址无效');
  const id = url.searchParams.get('id');
  if (id)
    url.searchParams.set(
      'id',
      id.replace(/_(?:\d+x\d+|UHD)(?=\.[^.]+$)/i, '_UHD'),
    );
  else url.pathname = url.pathname.replace(/_\d+x\d+(?=\.[^.]+$)/i, '_UHD');
  for (const key of ['w', 'h', 'width', 'height', 'qlt', 'pid'])
    url.searchParams.delete(key);
  return url.toString();
}
