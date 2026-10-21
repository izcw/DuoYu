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
