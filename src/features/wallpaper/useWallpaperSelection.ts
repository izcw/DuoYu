import { activeDesktop, prefix, type Desktop } from './desktops';
import { ref, onUnmounted, onActivated } from 'vue';
import { liveQuery } from 'dexie';
import { database } from '../../shared/storage/database';
import { accountStorage } from '../../shared/storage/account';
export function useWallpaperSelection() {
  const selected = ref(
    accountStorage.getItem('duoyu-wallpaper-mode') === 'custom' ? '' : 'daily',
  );
  let subscription: { unsubscribe(): void } | undefined;
  async function read(desktop: string) {
    // Read a consistent snapshot. The image cache can still contain the previous
    // wallpaper while the newly selected original is downloading or hydrating.
    return database.transaction(
      'r',
      database.wallpapers,
      database.preferences,
      async () => {
        const profile = (await database.preferences.get(prefix + desktop))
          ?.value as Desktop | undefined;
        if (profile && profile.selection !== 'legacy') return profile.selection;
        if (desktop !== 'default') return 'daily';
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

  function refresh() {
    // Each desktop observes different IndexedDB keys. Switch the subscription
    // itself so subsequent writes to the new desktop also update its selection.
    subscription?.unsubscribe();
    const desktop = activeDesktop.value;
    subscription = liveQuery(() => read(desktop)).subscribe({
      next: (value) => {
        selected.value = value;
      },
      error: (error) =>
        console.warn('Unable to read wallpaper selection', error),
    });
  }
  refresh();
  onActivated(refresh);
  window.addEventListener('duoyu-wallpaper-change', refresh);
  window.addEventListener('duoyu-sync-preferences', refresh);
  onUnmounted(() => {
    subscription?.unsubscribe();
    window.removeEventListener('duoyu-wallpaper-change', refresh);
    window.removeEventListener('duoyu-sync-preferences', refresh);
  });
  return selected;
}
