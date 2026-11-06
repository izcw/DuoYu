import { browser } from 'wxt/browser';
import { webUrl } from '../features/workspace/collections';

export async function openWebTab(value: string) {
  const url = webUrl(value);
  if (!url) throw new Error('无法打开收藏，请检查是否为完整的网页地址');
  await browser.tabs.create({ url });
}
