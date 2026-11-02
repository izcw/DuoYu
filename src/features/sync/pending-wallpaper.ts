import type { Change } from './model';
/** Retain only the unresolved version currently visible, never resurrect older choices. */
export function pendingWallpaperChanges(
  currentHash: string | undefined,
  conflicts: { resolvedAt?: number; changes: Change[] }[],
): Change[] {
  if (!currentHash) return [];
  const match = conflicts.findLast(
    (record) =>
      !record.resolvedAt &&
      record.changes.some(
        (change) =>
          change.table === 'wallpapers' &&
          change.id === 'daily' &&
          change.value?.contentHash === currentHash,
      ),
  );
  return (
    match?.changes.filter(
      (change) =>
        change.table === 'wallpapers' ||
        (change.table === 'preferences' &&
          [
            'wallpaperMode',
            'wallpaperSelection',
            'savedWallpaper:store',
            'savedWallpaper:upload',
          ].includes(change.id)),
    ) ?? []
  );
}
