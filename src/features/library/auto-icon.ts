import { browser } from 'wxt/browser';

const cache = new Map<string, { time: number; result: Promise<string> }>();
export function automaticIcon(url: string, refresh = 0): Promise<string> {
  const key = `${url}\n${refresh}`;
  const previous = cache.get(key);
  if (previous && Date.now() - previous.time < 60000) return previous.result;
  const result = browser.runtime
    .sendMessage({ type: 'website-icon', url })
    .then((response) =>
      typeof response?.icon === 'string' &&
      /^(data:image\/|https?:\/\/)/i.test(response.icon)
        ? response.icon
        : '',
    )
    .catch(() => '');
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { time: Date.now(), result });
  return result;
}
