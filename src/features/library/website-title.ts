export function websiteTitle(html: string, url: URL) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (title) return title;
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map((match) => [
        match[1]!.toLowerCase(),
        match[3]!,
      ]),
    );
    if (
      ['og:title', 'twitter:title'].includes(
        (attributes.property || attributes.name || '').toLowerCase(),
      ) &&
      attributes.content?.trim()
    )
      return attributes.content.trim();
  }
  // A site-name fallback is appropriate only for its homepage, never a video title.
  if (
    url.pathname === '/' &&
    ['douyin.com', 'www.douyin.com'].includes(url.hostname)
  )
    return '抖音';
  return '';
}
