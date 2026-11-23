import { database, type Memo } from '../../shared/storage/database';
import { scopedKey } from '../../shared/storage/account';

export interface MemoCheckpoint {
  operation: string;
  base: Memo;
  source: string;
  committed: string | null;
  writing: string | null;
}

const prefix = scopedKey('pending-memo:');

export function checkpointMemo({
  operation,
  base,
  source,
  committed,
  writing,
}: MemoCheckpoint) {
  const key = prefix + operation;
  const value = JSON.stringify({ operation, base, source, committed, writing });
  try {
    localStorage.setItem(key, value);
    return localStorage;
  } catch {
    // The tab's separate quota can still protect a reload when local storage is full.
    try {
      sessionStorage.setItem(key, value);
      return sessionStorage;
    } catch {
      return undefined;
    }
  }
}

export function clearMemoCheckpoint(storage: Storage, operation: string) {
  storage.removeItem(prefix + operation);
}

async function recover({
  operation,
  base,
  source,
  committed,
  writing,
}: MemoCheckpoint) {
  await database.transaction(
    'rw',
    database.memos,
    database.syncConflicts,
    async () => {
      const row = await database.memos.get(base.id);
      const plain = row && !row.title && row.html == null;
      if (plain && row.body === source) return;
      const unchanged =
        row &&
        row.title === base.title &&
        row.html === base.html &&
        row.body === base.body;
      if (
        row &&
        (unchanged ||
          (plain && (row.body === committed || row.body === writing)))
      ) {
        await database.memos.update(base.id, {
          title: '',
          html: undefined,
          body: source,
          updatedAt: Date.now(),
        });
        return;
      }
      // A different writer changed the document or deleted it while this tab
      // was closing. Keep both intents available in the existing conflict UI.
      if (await database.syncConflicts.get(operation)) return;
      const createdAt = Date.now();
      await database.syncConflicts.add({
        id: operation,
        createdAt,
        state: 'blocked',
        reason: row ? 'field_conflict' : 'deleted_or_missing',
        operation: {
          id: operation,
          createdAt,
          rows: {
            ['memos:' + base.id]: {
              table: 'memos',
              id: base.id,
              base,
              value: {
                ...base,
                title: '',
                body: source,
                html: undefined,
                updatedAt: createdAt,
              },
            },
          },
        },
      });
    },
  );
}

export async function recoverMemoDrafts() {
  for (const storage of [localStorage, sessionStorage]) {
    const keys = Object.keys(storage).filter((key) => key.startsWith(prefix));
    for (const key of keys) {
      const value = storage.getItem(key);
      if (!value) continue;
      let entry: MemoCheckpoint;
      try {
        entry = JSON.parse(value) as MemoCheckpoint;
      } catch {
        storage.removeItem(key);
        continue;
      }
      if (
        entry?.operation !== key.slice(prefix.length) ||
        typeof entry.base?.id !== 'string' ||
        typeof entry.base?.body !== 'string' ||
        typeof entry.base?.title !== 'string' ||
        typeof entry.source !== 'string'
      ) {
        storage.removeItem(key);
        continue;
      }
      try {
        await recover(entry);
      } catch {
        // A transient failure should leave just this entry available to retry.
        continue;
      }
      if (storage.getItem(key) === value) storage.removeItem(key);
    }
  }
}
