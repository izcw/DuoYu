export interface SuggestionResult {
  items: string[];
  related: boolean;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const CACHE_TTL = 5 * 60_000;
const CACHE_LIMIT = 100;
const rawCache = new Map<string, CacheEntry<string[]>>();
const resultCache = new Map<string, CacheEntry<SuggestionResult>>();

function readCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}
function writeCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
) {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Queries stay in page memory only, including results for long-query fallbacks. */
export function getCachedResult(query: string): SuggestionResult | undefined {
  return readCache(resultCache, query);
}
export function getBingSearchUrl(query: string): string {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query.trim());
  return url.toString();
}

async function fetchSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted();
  const cached = readCache(rawCache, query);
  if (cached !== undefined) return cached;
  const url = new URL('https://api.bing.com/osjson.aspx');
  url.searchParams.set('query', query);
  url.searchParams.set('market', 'zh-CN');
  const response = await fetch(url, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('Suggestion service unavailable');
  const body = response.status === 204 ? '' : await response.text();
  const data: unknown = body.trim() ? JSON.parse(body) : [query, []];
  if (!Array.isArray(data) || !Array.isArray(data[1]))
    throw new Error('Invalid suggestion response');
  const seen = new Set<string>();
  const items = data[1]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
  signal.throwIfAborted();
  writeCache(rawCache, query, items);
  return items;
}

export async function resolveSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<SuggestionResult> {
  signal.throwIfAborted();
  const cached = getCachedResult(query);
  if (cached) return cached;
  // One deadline for the entire request chain, not a fresh timeout per fallback.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
  const items = await fetchSuggestions(query, deadline);
  let result: SuggestionResult = { items, related: false };
  if (!items.length) {
    const chars = Array.from(query);
    const words = query.split(/\s+/);
    const prefixes =
      words.length > 1
        ? [
            words.slice(0, -1).join(' '),
            words.slice(0, Math.ceil(words.length / 2)).join(' '),
          ]
        : [
            Math.min(12, Math.floor(chars.length * 0.75)),
            Math.min(7, Math.floor(chars.length * 0.5)),
          ].map((length) => chars.slice(0, length).join(''));
    for (const prefix of new Set(
      prefixes.filter((value) => value.length >= 2 && value !== query),
    )) {
      const related = await fetchSuggestions(prefix, deadline);
      if (related.length) {
        result = { items: related, related: true };
        break;
      }
    }
  }
  deadline.throwIfAborted();
  writeCache(resultCache, query, result);
  return result;
}
