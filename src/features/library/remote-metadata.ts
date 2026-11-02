interface Metadata {
  title?: string;
  icon?: string;
}
const pending = new Map<string, Promise<Metadata>>();
export function remoteMetadata(url: string): Promise<Metadata> {
  const existing = pending.get(url);
  if (existing) return existing;
  const task = (async () => {
    const endpoint = import.meta.env.VITE_SYNC_URL;
    if (!endpoint?.startsWith('https://')) return {};
    try {
      const response = await fetch(
        `${endpoint.replace(/\/$/, '')}/api/v1/website-metadata?url=${encodeURIComponent(url)}`,
        {
          credentials: 'omit',
          signal: AbortSignal.timeout(16000),
        },
      );
      if (!response.ok) return {};
      const value = await response.json();
      return {
        title:
          typeof value.title === 'string' ? value.title.slice(0, 1000) : '',
        icon:
          typeof value.icon === 'string' &&
          value.icon.startsWith('data:image/') &&
          value.icon.length < 1500000
            ? value.icon
            : '',
      };
    } catch {
      return {};
    }
  })();
  pending.set(url, task);
  void task.finally(() => {
    if (pending.get(url) === task) pending.delete(url);
  });
  return task;
}
