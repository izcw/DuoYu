import { activeDesktop } from './desktops';
import { ref, onUnmounted, onActivated } from 'vue';
import { liveQuery } from 'dexie';
import { readDesktop } from './desktop-profile';
export function useWallpaperSelection() {
  const selected = ref('');
  let subscription: { unsubscribe(): void } | undefined;
  function refresh() {
    // Each desktop observes different IndexedDB keys. Switch the subscription
    // itself so subsequent writes to the new desktop also update its selection.
    subscription?.unsubscribe();
    const desktop = activeDesktop.value;
    subscription = liveQuery(
      async () => (await readDesktop(desktop)).selection,
    ).subscribe({
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
