import type { Dexie } from 'dexie';

export const ACCOUNT_STORAGE_KEY = 'duoyu-sync-account';
export function activeAccountKey() {
  return localStorage.getItem(ACCOUNT_STORAGE_KEY) || '';
}
// The database and preference namespace belong to one page lifetime.
// A different tab may update the shared marker before this page reloads.
export const pageAccountKey = activeAccountKey();
export function assertCurrentPageAccount() {
  if (activeAccountKey() !== pageAccountKey)
    throw Error('账号已切换，请在当前账号重新操作');
}
// A tab can finish a file download or a dialog save after another tab signs
// out. Abort the entire write, including any outbox rows, in its original DB.
export function guardAccountWrites(db: Dexie) {
  db.use({
    stack: 'dbcore',
    name: 'duoyu-account-write-guard',
    level: 2,
    create: (down) => ({
      ...down,
      table(name) {
        const table = down.table(name);
        return {
          ...table,
          mutate(req) {
            if (activeAccountKey() !== pageAccountKey) {
              req.trans.abort();
              throw Error('账号已切换，请在当前账号重新操作');
            }
            return table.mutate(req);
          },
        };
      },
    }),
  });
}
export function scopedKey(key: string) {
  return pageAccountKey ? `account:${pageAccountKey}:${key}` : key;
}
export const accountStorage = {
  getItem(key: string) {
    if (activeAccountKey() !== pageAccountKey) return null;
    return localStorage.getItem(scopedKey(key));
  },
  setItem(key: string, value: string) {
    assertCurrentPageAccount();
    localStorage.setItem(scopedKey(key), value);
    window.dispatchEvent(
      new CustomEvent('duoyu-preference-change', { detail: { key, value } }),
    );
  },
  removeItem(key: string) {
    assertCurrentPageAccount();
    localStorage.removeItem(scopedKey(key));
    window.dispatchEvent(
      new CustomEvent('duoyu-preference-change', {
        detail: { key, value: null },
      }),
    );
  },
};
