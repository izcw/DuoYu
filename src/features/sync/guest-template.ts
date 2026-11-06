import { restoreDesktop } from '../wallpaper/desktops';
import Dexie from 'dexie';
import { database } from '../../shared/storage/database';
import { guestMode } from '../../shared/storage/account';
import { denormalized, type Entity } from './model';
import { readResponseBytes } from '../../shared/response-body';
import { ref } from 'vue';

export const guestTemplateStatus = ref('');
export async function loadGuestTemplate() {
  if (!guestMode) return;
  try {
    await navigator.locks.request('duoyu:official-guest-template', async () => {
      const response = await fetch(
        new URL('/api/v1/guest-template', import.meta.env.VITE_SYNC_URL),
        { credentials: 'omit', signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok) throw Error();
      const snapshot = JSON.parse(
        new TextDecoder().decode(
          await readResponseBytes(response, 10 * 1024 * 1024),
        ),
      );
      if (
        !Array.isArray(snapshot.entities) ||
        typeof snapshot.configured !== 'boolean'
      )
        throw Error();
      if (typeof snapshot.revision !== 'string') throw Error();
      const last = await database.syncMeta.get('guestRevision');
      const tables = denormalized(snapshot.entities as Entity[]);
      if (last?.value !== snapshot.revision)
        await database.transaction('rw', database.tables, async () => {
          (
            Dexie.currentTransaction!.idbtrans as IDBTransaction & {
              guestTemplate: boolean;
            }
          ).guestTemplate = true;
          for (const [name, rows] of Object.entries(tables)) {
            await database.table(name).clear();
            if (name === 'wallpapers') {
              // Legacy originals are represented by their template asset, not an IndexedDB Blob.
              await database.syncShadow.clear();
              for (const e of snapshot.entities.filter(
                (e: Entity) => e.table === 'wallpapers',
              ))
                await database.syncShadow.put({
                  id: 'wallpapers:' + e.id,
                  entityId: e.id,
                  table: e.table,
                  payload: e.payload,
                  deleted: false,
                  revision: '0',
                });
            } else if (rows.length) await database.table(name).bulkPut(rows);
          }
          await database.syncMeta.put({
            id: 'guestRevision',
            value: snapshot.revision,
          });
          await database.syncMeta.put({
            id: 'guestSnapshot',
            value: snapshot.configured,
          });
        });
      guestTemplateStatus.value = snapshot.configured
        ? ''
        : '尚未设置官方默认模板';
      const prefs = await database.preferences.toArray();
      restoreDesktop(prefs);
      const mode = prefs.find((p) => p.id === 'glassMode')?.value;
      document.documentElement.dataset.glassMode = [
        'real',
        'natural',
        'soft',
      ].includes(String(mode))
        ? String(mode)
        : 'real';
      // Only these projected settings drive the existing dock and grid readers.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (
          key?.startsWith('guest-template:duoyu-layout-') ||
          key === 'guest-template:duoyu-dock-order'
        )
          localStorage.removeItem(key);
      }
      for (const pref of prefs) {
        const key =
          pref.id === 'dockOrder'
            ? 'duoyu-dock-order'
            : pref.id.startsWith('layout:')
              ? 'duoyu-layout-' + pref.id.slice(7)
              : '';
        if (key && pref.value != null)
          localStorage.setItem(
            'guest-template:' + key,
            typeof pref.value === 'string'
              ? pref.value
              : JSON.stringify(pref.value),
          );
      }
      window.dispatchEvent(new Event('duoyu-sync-preferences'));
    });
  } catch {
    guestTemplateStatus.value = (await database.syncMeta.get('guestSnapshot'))
      ?.value
      ? '离线显示上次下载的官方模板'
      : '官方模板暂时无法加载';
  }
}
