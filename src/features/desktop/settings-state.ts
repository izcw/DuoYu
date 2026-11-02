import { ref } from 'vue';
export type SettingsSection = 'account' | 'general' | 'backup';
export const settingsOpen = ref(false);
export const settingsSection = ref<SettingsSection>('general');
export const settingsPage = ref('home');
export function openSettings(
  section: SettingsSection = 'general',
  pageId?: string,
) {
  settingsSection.value = section;
  if (pageId) settingsPage.value = pageId;
  settingsOpen.value = true;
}
