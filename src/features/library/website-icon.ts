import {
  readMetadataHTML,
  readResponseBytes,
} from '../../shared/response-body';

/** Resolve only website-provided icons; do not send browsing URLs to third parties. */
export function iconCandidates(html: string, page: string) {
  const result: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(
      /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    ))
      attributes[match[1]!.toLowerCase()] =
        match[2] ?? match[3] ?? match[4] ?? '';
    if (
      !/(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/i.test(attributes.rel || '')
    )
      continue;
    try {
      const url = new URL((attributes.href || '').replace(/&amp;/g, '&'), page);
      if (
        attributes.href &&
        /^https?:$/.test(url.protocol) &&
        !url.username &&
        !url.password
      )
        result.push(url.href);
    } catch {
      /* Ignore malformed icon declarations. */
    }
  }
  result.push(new URL('/favicon.ico', page).href);
  return [...new Set(result)].slice(0, 8);
}

export async function websiteIcon(page: string) {
  const url = new URL(page);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw Error('无效网址');
  const signal = AbortSignal.timeout(12000);
  let candidates = [new URL('/favicon.ico', url).href];
  try {
    const response = await fetch(url.href, {
      credentials: 'omit',
      signal,
      cache: 'no-cache',
    });
    if (response.ok)
      candidates = iconCandidates(
        await readMetadataHTML(response),
        response.url || url.href,
      );
    else await response.body?.cancel();
  } catch {
    /* A blocked HTML page may still serve a public favicon. */
  }
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        credentials: 'omit',
        signal,
        cache: 'no-cache',
      });
      const type =
        response.headers.get('content-type')?.split(';')[0]?.trim() || '';
      if (
        !response.ok ||
        !type.startsWith('image/') ||
        Number(response.headers.get('content-length')) > 1024 * 1024
      ) {
        await response.body?.cancel();
        continue;
      }
      const bytes = await readResponseBytes(response, 1024 * 1024);
      if (!bytes.length || bytes.length > 1024 * 1024) continue;
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return `data:${type};base64,${btoa(binary)}`;
    } catch {
      if (signal.aborted) break;
    }
  }
  return '';
}
