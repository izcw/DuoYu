export function truncateLinkTitle(value: string) {
  return Array.from(value).slice(0, 16).join('');
}
