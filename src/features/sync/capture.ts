import type { DBCore, Dexie } from 'dexie';
export const SYNC_TABLES = [
  'libraryPages',
  'libraryItems',
  'workspaceSpaces',
  'tabCollections',
  'shortcuts',
  'preferences',
  'wallpapers',
];
export interface CapturedOperation {
  id: string;
  createdAt: number;
  rows: Record<
    string,
    { table: string; id: string; base: unknown; value: unknown }
  >;
  prepared?: unknown;
  resolutionOf?: string;
}
export interface SyncConflict {
  id: string;
  createdAt: number;
  operation: unknown;
  reason: string;
  resolvedAt?: number;
  state?: 'conflict' | 'blocked' | 'resolving';
  server?: boolean;
}
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export function installSyncCapture(database: Dexie, enabled: boolean) {
  if (!enabled) return;
  database.use({
    stack: 'dbcore',
    name: 'duoyu-durable-outbox',
    level: 1,
    create(down: DBCore): DBCore {
      const states = new WeakMap<
        IDBTransaction,
        { op: CapturedOperation; tail: Promise<unknown> }
      >();
      return {
        ...down,
        transaction(stores, mode, options) {
          return down.transaction(
            mode === 'readwrite' && stores.some((n) => SYNC_TABLES.includes(n))
              ? [...new Set([...stores, 'syncOutbox', 'syncMeta'])]
              : stores,
            mode,
            options,
          );
        },
        table(name) {
          const table = down.table(name);
          if (!SYNC_TABLES.includes(name)) return table;
          return {
            ...table,
            mutate(req) {
              const tx = req.trans as IDBTransaction & { syncRemote?: boolean };
              if (tx.syncRemote) return table.mutate(req);
              let state = states.get(tx);
              if (!state) {
                state = {
                  op: {
                    id: crypto.randomUUID(),
                    createdAt: Date.now(),
                    rows: {},
                  },
                  tail: Promise.resolve(),
                };
                state.tail = request(
                  tx.objectStore('syncMeta').get('outboxClock'),
                ).then((clock: any) => {
                  state!.op.createdAt = Math.max(
                    Date.now(),
                    Number(clock?.value ?? 0) + 1,
                  );
                  return request(
                    tx
                      .objectStore('syncMeta')
                      .put({ id: 'outboxClock', value: state!.op.createdAt }),
                  );
                });
                states.set(tx, state);
                tx.addEventListener('complete', () => {
                  globalThis.dispatchEvent?.(new Event('duoyu-local-write'));
                });
              }
              const current = state;
              const task = current.tail.then(async () => {
                const query = {
                  trans: req.trans,
                  values: true,
                  query: {
                    index: table.schema.primaryKey,
                    range: {
                      type: 3 as const,
                      lower: undefined,
                      upper: undefined,
                    },
                  },
                };
                const before = (await table.query(query)).result;
                const result = await table.mutate(req);
                const after = (await table.query(query)).result;
                const a = new Map(before.map((v) => [v.id, v])),
                  b = new Map(after.map((v) => [v.id, v]));
                for (const id of new Set([...a.keys(), ...b.keys()])) {
                  const old = a.get(id) ?? null,
                    value = b.get(id) ?? null;
                  // Daily wallpaper downloads are a device cache, not user changes.
                  if (
                    name === 'wallpapers' &&
                    !String(
                      value?.sourceUrl ?? old?.sourceUrl ?? '',
                    ).startsWith('local:')
                  )
                    continue;
                  if (
                    name !== 'wallpapers' &&
                    JSON.stringify(old) === JSON.stringify(value)
                  )
                    continue;
                  const k = name + ':' + id;
                  current.op.rows[k] = {
                    table: name,
                    id,
                    base: k in current.op.rows ? current.op.rows[k]!.base : old,
                    value,
                  };
                }
                if (Object.keys(current.op.rows).length)
                  await request(tx.objectStore('syncOutbox').put(current.op));
                return result;
              });
              current.tail = task.catch(() => {});
              return task;
            },
          };
        },
      };
    },
  });
}
