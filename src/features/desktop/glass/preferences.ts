import { liveQuery } from 'dexie';
import { onUnmounted } from 'vue';
import { activeAccountKey, pageAccountKey } from '../../../shared/storage/account';
import { database } from '../../../shared/storage/database';
import { getSyncPreference } from '../../sync/client';
import type { GlassMode } from './renderer';

function normalizeGlassMode(value: unknown): GlassMode {
  return value === 'natural' || value === 'soft' ? value : 'real';
}

/** Resolve the saved material before Vue renders the desktop. */
export async function loadGlassMode(): Promise<GlassMode> {
  try {
    return normalizeGlassMode(await getSyncPreference('glassMode'));
  } catch {
    return 'real';
  }
}

export function useGlassMode() {
  const subscription = liveQuery(() => database.preferences.get('glassMode')).subscribe((record) => {
    if (activeAccountKey() === pageAccountKey)
      document.documentElement.dataset.glassMode = normalizeGlassMode(record?.value);
  });
  onUnmounted(() => subscription.unsubscribe());
}
