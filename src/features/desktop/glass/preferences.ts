import { getSyncPreference, setSyncPreference } from '../../sync/client';
import type { InjectionKey } from 'vue';
import { browser } from 'wxt/browser';
import type { GlassMode } from './renderer';

export const initialGlassModeKey: InjectionKey<GlassMode> =
  Symbol('initialGlassMode');

/** Resolve the saved material before Vue renders any glass or selection state. */
export async function loadGlassMode(): Promise<GlassMode> {
  try {
    const glassMode = await getSyncPreference('glassMode');
    if (glassMode === 'real' || glassMode === 'natural' || glassMode === 'soft')
      return glassMode;
  } catch {
    // A missing or unavailable preference must not prevent opening a new tab.
  }
  return 'real';
}
