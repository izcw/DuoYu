export const ACCOUNT_STORAGE_KEY = 'duoyu-sync-account';
export function activeAccountKey() {
  return localStorage.getItem(ACCOUNT_STORAGE_KEY) || '';
}
export function scopedKey(key: string) {
  const account = activeAccountKey();
  return account ? `account:${account}:${key}` : key;
}
export const accountStorage = {
  getItem(key: string) {
    return localStorage.getItem(scopedKey(key));
  },
  setItem(key: string, value: string) {
    localStorage.setItem(scopedKey(key), value);
    window.dispatchEvent(
      new CustomEvent('duoyu-preference-change', { detail: { key, value } }),
    );
  },
  removeItem(key: string) {
    localStorage.removeItem(scopedKey(key));
    window.dispatchEvent(
      new CustomEvent('duoyu-preference-change', {
        detail: { key, value: null },
      }),
    );
  },
};
