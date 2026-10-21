export const SEARCH_ENGINES = [
  {
    id: 'bing',
    name: 'Bing',
    icon: '/images/bing.svg',
    endpoint: 'https://www.bing.com/search',
    parameter: 'q',
  },
  {
    id: 'google',
    name: 'Google',
    icon: '/images/google.png',
    endpoint: 'https://www.google.com/search',
    parameter: 'q',
  },
  {
    id: 'baidu',
    name: '百度',
    icon: '/images/baidu.png',
    endpoint: 'https://www.baidu.com/s',
    parameter: 'wd',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: '/images/github.png',
    endpoint: 'https://github.com/search',
    parameter: 'q',
  },
  {
    id: 'yandex',
    name: 'Yandex',
    icon: '/images/yandex.png',
    endpoint: 'https://yandex.com/search/',
    parameter: 'text',
  },
] as const;

export type SearchEngineId = (typeof SEARCH_ENGINES)[number]['id'];
export function isSearchEngineId(value: unknown): value is SearchEngineId {
  return SEARCH_ENGINES.some((engine) => engine.id === value);
}
export function getSearchEngine(id: SearchEngineId) {
  return SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES[0];
}
export function getSearchUrl(id: SearchEngineId, query: string) {
  const engine = getSearchEngine(id);
  const url = new URL(engine.endpoint);
  url.searchParams.set(engine.parameter, query.trim());
  return url.toString();
}
