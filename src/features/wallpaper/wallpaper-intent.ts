import { database } from '../../shared/storage/database';
import { accountStorage } from '../../shared/storage/account';
const KEY = 'duoyu-wallpaper-intent';
type Choice = {
  selection: string;
  contentHash?: string;
  asset?: string;
  sourceUrl?: string;
};
export function rememberWallpaperChoice(choice: Choice) {
  accountStorage.setItem(KEY, JSON.stringify(choice));
}
function readChoice(): Choice | undefined {
  try {
    const c = JSON.parse(accountStorage.getItem(KEY) || 'null');
    if (
      c &&
      typeof c.selection === 'string' &&
      /^(daily|upload|bing:.+|cloud:.+)$/.test(c.selection)
    )
      return c;
  } catch {}
}
export async function restoreWallpaperChoice() {
  let choice = readChoice();
  if (!choice && !accountStorage.getItem('duoyu-wallpaper-intent-migrated')) {
    accountStorage.setItem('duoyu-wallpaper-intent-migrated', '1');
    try {
      const preview = JSON.parse(
        accountStorage.getItem('duoyu:wallpaper-preview') || 'null',
      );
      const current = await database.wallpapers.get('daily');
      if (
        preview?.sourceUrl?.startsWith('local:') &&
        /^[a-f0-9]{64}$/.test(preview.version) &&
        current?.contentHash !== preview.version
      ) {
        const saved = (await database.preferences.get('savedWallpaper:store'))
          ?.value as any;
        const selected = (await database.preferences.get('wallpaperSelection'))
          ?.value;
        choice = {
          selection:
            saved?.contentHash === preview.version
              ? saved.selection
              : typeof selected === 'string' && selected !== 'daily'
                ? selected
                : current?.selection || 'upload',
          contentHash: preview.version,
          sourceUrl: preview.sourceUrl,
          asset: 'duoyu-asset:' + preview.version,
        };
        rememberWallpaperChoice(choice);
      }
    } catch {}
  }
  if (!choice) return;
  const c = choice;
  const expected = accountStorage.getItem(KEY);
  if (c.selection === 'daily') {
    await database.transaction('rw', database.preferences, async () => {
      if (accountStorage.getItem(KEY) !== expected) return;
      if (
        (await database.preferences.get('wallpaperSelection'))?.value !==
        'daily'
      )
        await database.preferences.put({
          id: 'wallpaperSelection',
          value: 'daily',
        });
      if ((await database.preferences.get('wallpaperMode'))?.value !== null)
        await database.preferences.put({ id: 'wallpaperMode', value: null });
    });
    return;
  }
  if (!c.contentHash || !c.asset || !/^[a-f0-9]{64}$/.test(c.contentHash))
    return;
  const cached = await database.syncAssets.get(c.contentHash);
  if (!(cached?.blob instanceof Blob)) return;
  await database.transaction(
    'rw',
    database.wallpapers,
    database.preferences,
    async () => {
      if (accountStorage.getItem(KEY) !== expected) return;
      const current = await database.wallpapers.get('daily');
      if (
        current?.contentHash !== c.contentHash ||
        current?.selection !== c.selection
      )
        await database.wallpapers.put({
          id: 'daily',
          sourceUrl: c.sourceUrl || 'local:' + c.contentHash,
          selection: c.selection,
          contentHash: c.contentHash,
          blob: cached.blob,
          savedAt: Date.now(),
        });
      for (const p of [
        { id: 'wallpaperSelection', value: c.selection },
        { id: 'wallpaperMode', value: 'custom' },
        {
          id:
            c.selection === 'upload'
              ? 'savedWallpaper:upload'
              : 'savedWallpaper:store',
          value: {
            selection: c.selection,
            contentHash: c.contentHash,
            blob: c.asset,
          },
        },
      ]) {
        const existing = await database.preferences.get(p.id);
        if (JSON.stringify(existing?.value) !== JSON.stringify(p.value))
          await database.preferences.put(p);
      }
    },
  );
}
export async function settleWallpaperChoice() {
  const expected = accountStorage.getItem(KEY);
  const c = readChoice();
  if (!c) return;
  const selectionShadow = await database.syncShadow.get(
    'preferences:wallpaperSelection',
  );
  const selected = selectionShadow?.payload as { value?: unknown } | undefined;
  if (selectionShadow?.deleted || selected?.value !== c.selection) return;
  if (c.selection !== 'daily') {
    const image = await database.syncShadow.get('wallpapers:daily');
    const p = image?.payload as any;
    if (
      image?.deleted ||
      p?.contentHash !== c.contentHash ||
      p?.selection !== c.selection
    )
      return;
  }
  // A newer user choice may have arrived while reading its predecessor's acknowledgment.
  if (accountStorage.getItem(KEY) === expected) accountStorage.removeItem(KEY);
}
