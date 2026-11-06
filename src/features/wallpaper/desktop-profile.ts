import { database } from '../../shared/storage/database';
import { accountStorage, pageAccountKey } from '../../shared/storage/account';
import { prefix, type Desktop } from './desktops';

export async function readDesktop(
  id: string,
): Promise<Desktop & { legacyBlob?: Blob }> {
  const profile = (await database.preferences.get(prefix + id))?.value as
    Desktop | undefined;
  if (profile && profile.selection !== 'legacy') return profile;
  const base = profile ?? { id, created: 0 };
  if (id !== 'default') return { ...base, selection: 'daily' };

  // Read historical account formats without rewriting the cloud or deriving a
  // choice from a downloaded preview. Only explicit edits create a desktop row.
  const explicit = (await database.preferences.get('wallpaperSelection'))
    ?.value;
  const mode = (await database.preferences.get('wallpaperMode'))?.value;
  const shadow = await database.syncShadow.get('wallpapers:daily');
  const remote = !shadow?.deleted
    ? (shadow?.payload as { selection?: string; asset?: string } | undefined)
    : undefined;
  const record = await database.wallpapers.get('daily');
  const custom =
    mode === 'custom' ||
    (mode === undefined &&
      (remote ||
        record?.sourceUrl?.startsWith('local:') ||
        (!pageAccountKey &&
          accountStorage.getItem('duoyu-wallpaper-mode') === 'custom')));
  const selection =
    typeof explicit === 'string'
      ? explicit
      : custom
        ? remote?.selection || record?.selection || 'upload'
        : 'daily';
  if (selection === 'daily') return { ...base, selection };
  const saved = (
    await database.preferences.get(
      selection === 'upload' ? 'savedWallpaper:upload' : 'savedWallpaper:store',
    )
  )?.value as { selection?: string; blob?: string | Blob } | undefined;
  const image =
    remote?.asset && (!remote.selection || remote.selection === selection)
      ? remote.asset
      : saved?.selection === selection
        ? saved.blob
        : undefined;
  return {
    ...base,
    selection,
    asset: typeof image === 'string' ? image : undefined,
    legacyBlob:
      image instanceof Blob
        ? image
        : record?.sourceUrl?.startsWith('local:') &&
            (!record.selection || record.selection === selection)
          ? record.blob
          : undefined,
  };
}
