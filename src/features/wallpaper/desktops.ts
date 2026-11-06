import { ref } from 'vue';
import { database } from '../../shared/storage/database';
import { accountStorage, scopedKey } from '../../shared/storage/account';
export const prefix = 'wallpaperDesktop:';
const key = 'duoyu-device-desktop';
export const activeDesktop = ref(accountStorage.getItem(key) || 'default');
export interface Desktop {
  id: string;
  created: number;
  name?: string;
  selection: string;
  asset?: string;
}
const resumeKey = 'wallpaperResumeDesktop';

export async function chooseDesktop(id: string) {
  await database.preferences.put({ id: resumeKey, value: id });
  switchDesktop(id);
}

// Only a fresh device follows the account's choice. An existing device keeps
// its own current desktop when another device switches.
export function restoreDesktop(preferences: { id: string; value: unknown }[]) {
  if (accountStorage.getItem(key) !== null) return;
  const saved = preferences.find((p) => p.id === resumeKey);
  const desktops = preferences.filter((p) => p.id.startsWith(prefix));
  if (saved) {
    const exists =
      typeof saved.value === 'string' &&
      desktops.some((p) => p.id === prefix + saved.value);
    switchDesktop(exists ? String(saved.value) : 'default');
    return;
  }
  // Older accounts synced the selected image and desktop, but no resume ID.
  // Recover a unique match without guessing between desktops sharing an image.
  const store = preferences.find((p) => p.id === 'savedWallpaper:store')
    ?.value as { selection?: string; blob?: string } | undefined;
  const matches = desktops.filter((p) => {
    if (!store?.blob || !store.selection?.startsWith('bing:')) return false;
    const desktop = p.value as Desktop | null;
    return (
      desktop &&
      desktop.selection === store.selection &&
      desktop.asset === store.blob
    );
  });
  switchDesktop(
    matches.length === 1 ? matches[0]!.id.slice(prefix.length) : 'default',
  );
}

export function switchDesktop(id: string) {
  accountStorage.setItem(key, id);
  activeDesktop.value = id;
  window.dispatchEvent(new Event('duoyu-wallpaper-change'));
}
window.addEventListener('storage', (e) => {
  if (e.key === scopedKey(key)) {
    activeDesktop.value = e.newValue || 'default';
    window.dispatchEvent(new Event('duoyu-wallpaper-change'));
  }
});
export async function addDesktop() {
  const id = crypto.randomUUID();
  await database.preferences.add({
    id: prefix + id,
    value: { id, created: Date.now(), selection: 'daily' },
  });
  return id;
}
export async function saveDesktopChoice(
  id: string,
  selection: string,
  asset?: string,
) {
  const previous = (await database.preferences.get(prefix + id))?.value as
    Desktop | undefined;
  if (!previous && id !== 'default') throw Error('桌面已不存在');
  if (
    activeDesktop.value === id &&
    (await database.preferences.get(resumeKey))?.value !== id
  )
    await database.preferences.put({ id: resumeKey, value: id });
  await database.preferences.put({
    id: prefix + id,
    value: {
      id,
      created: previous?.created ?? 0,
      ...(previous?.name ? { name: previous.name } : {}),
      selection,
      ...(asset ? { asset } : {}),
    },
  });
}

export async function renameDesktop(id: string, raw: string) {
  const name = raw.trim();
  if (!name || name.length > 40) throw Error('桌面名称需为 1 至 40 个字符');
  await database.transaction('rw', database.preferences, async () => {
    const previous = (await database.preferences.get(prefix + id))?.value as
      Desktop | undefined;
    if (!previous && id !== 'default') throw Error('桌面已不存在');
    await database.preferences.put({
      id: prefix + id,
      value: { ...(previous ?? { id, created: 0, selection: 'legacy' }), name },
    });
  });
}
export async function deleteDesktop(id: string) {
  if (id === 'default') throw Error('默认桌面需要保留');
  await database.transaction('rw', database.preferences, async () => {
    await database.preferences.delete(prefix + id);
    if ((await database.preferences.get(resumeKey))?.value === id)
      await database.preferences.put({ id: resumeKey, value: 'default' });
  });
  if (activeDesktop.value === id) switchDesktop('default');
}
