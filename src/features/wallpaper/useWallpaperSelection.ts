import { ref, onUnmounted, onActivated } from 'vue';
import { liveQuery } from 'dexie';
import { database } from '../../shared/storage/database';
import { accountStorage } from '../../shared/storage/account';
export function useWallpaperSelection() {
  const selected = ref(
    accountStorage.getItem('duoyu-wallpaper-mode') === 'custom' ? '' : 'daily',
  );
  let generation = 0;
  let disposed = false;
  async function read() {
    // Read a consistent snapshot. The image cache can still contain the previous
    // wallpaper while the newly selected original is downloading or hydrating.
    return database.transaction(
      'r',
      database.wallpapers,
      database.preferences,
      async () => {
        const selection = (await database.preferences.get('wallpaperSelection'))
          ?.value;
        if (
          typeof selection === 'string' &&
          /^(daily|upload|bing:.+|cloud:.+)$/.test(selection)
        )
          return selection;

        // Legacy installations have no explicit selection preference yet.
        const mode = await database.preferences.get('wallpaperMode');
        const custom = mode
          ? mode.value === 'custom'
          : accountStorage.getItem('duoyu-wallpaper-mode') === 'custom';
        if (!custom) return 'daily';
        return (await database.wallpapers.get('daily'))?.selection || 'upload';
      },
    );
  }

  async function refresh() {
    const request = ++generation;
    try {
      const value = await read();
      if (!disposed && request === generation) selected.value = value;
    } catch (error) {
      console.warn('Unable to read wallpaper selection', error);
    }
  }
  const subscription = liveQuery(read).subscribe({
    next: () => {
      void refresh();
    },
    error: (error) =>
      console.warn('Wallpaper selection subscription failed', error),
  });
  void refresh();
  onActivated(refresh);
  window.addEventListener('duoyu-wallpaper-change', refresh);
  window.addEventListener('duoyu-sync-preferences', refresh);
  onUnmounted(() => {
    disposed = true;
    generation++;
    subscription.unsubscribe();
    window.removeEventListener('duoyu-wallpaper-change', refresh);
    window.removeEventListener('duoyu-sync-preferences', refresh);
  });
  return selected;
}
