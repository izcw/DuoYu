import { browser } from 'wxt/browser';
import { database } from '../../shared/storage/database';
function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function backupDesktop() {
  const tables: Record<string, unknown[]> = {};
  // Read a consistent snapshot before encoding binary wallpaper data.
  await database.transaction('r', database.tables, async () => {
    for (const table of database.tables)
      tables[table.name] = await table.toArray();
  });
  tables.wallpapers = await Promise.all(
    (tables.wallpapers || []).map(async (value) => {
      const record = value as Record<string, unknown>;
      return {
        ...record,
        blob:
          record.blob instanceof Blob
            ? await blobData(record.blob)
            : record.blob,
      };
    }),
  );
  const storage = await browser.storage.local.get(null);
  const preferences = Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith('duoyu')),
  );
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: 'duoyu-backup',
          version: 1,
          createdAt: new Date().toISOString(),
          tables,
          storage,
          preferences,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download =
    'duoyu-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
