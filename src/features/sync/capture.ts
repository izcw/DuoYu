import type { DBCore, DBCoreMutateRequest, DBCoreTable, Dexie } from 'dexie';
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

function affectedKeys(table: DBCoreTable, req: DBCoreMutateRequest) {
  if (req.type === 'deleteRange') return undefined;
  const index = table.schema.primaryKey;
  const keys =
    req.type === 'delete' || index.outbound
      ? req.keys
      : req.values.map((value) => index.extractKey?.(value));
  // All existing synchronized tables use string IDs. Fall back to scanning
  // for unfamiliar keys so IndexedDB retains its normal failure semantics.
  return keys?.every((key) => typeof key === 'string')
    ? [...new Set(keys)]
    : undefined;
}
interface SyncRow {
  id: string;
  sourceUrl?: string;
}
function mergeCapturedRows(
  op: CapturedOperation,
  name: string,
  before: (SyncRow | undefined)[],
  after: (SyncRow | undefined)[],
) {
  const a = new Map(
      before.filter((row): row is SyncRow => !!row).map((v) => [v.id, v]),
    ),
    b = new Map(
      after.filter((row): row is SyncRow => !!row).map((v) => [v.id, v]),
    );
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(id) ?? null,
      value = b.get(id) ?? null;
    // Daily wallpaper downloads are a device cache, not user changes.
    if (
      name === 'wallpapers' &&
      !String(value?.sourceUrl ?? old?.sourceUrl ?? '').startsWith('local:')
    )
      continue;
    if (name !== 'wallpapers' && JSON.stringify(old) === JSON.stringify(value))
      continue;
    const k = name + ':' + id;
    const base = k in op.rows ? op.rows[k]!.base : old;
    if (
      name !== 'wallpapers' &&
      JSON.stringify(base) === JSON.stringify(value)
    ) {
      delete op.rows[k];
    } else {
      op.rows[k] = { table: name, id, base, value };
    }
  }
}
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
                  if (Object.keys(state!.op.rows).length)
                    globalThis.dispatchEvent?.(new Event('duoyu-local-write'));
                });
              }
              const current = state;
              const task = current.tail.then(async () => {
                const keys = affectedKeys(table, req);
                const range =
                  req.type === 'deleteRange'
                    ? req.range
                    : { type: 3 as const, lower: undefined, upper: undefined };
                const query = {
                  trans: req.trans,
                  values: true,
                  query: { index: table.schema.primaryKey, range },
                };
                // Keep reads in the same transaction as the mutation, including
                // actual post-write values when a bulk request partially fails.
                if (range.type === 4) return table.mutate(req);
                const lookup = keys && { trans: req.trans, keys };
                const before = lookup
                  ? await table.getMany(lookup)
                  : (await table.query(query)).result;
                const result = await table.mutate(req);
                try {
                  let after: typeof before = [];
                  if (lookup) after = await table.getMany(lookup);
                  else if (req.type !== 'deleteRange' || result.numFailures)
                    after = (await table.query(query)).result;
                  mergeCapturedRows(current.op, name, before, after);
                  if (Object.keys(current.op.rows).length)
                    await request(tx.objectStore('syncOutbox').put(current.op));
                  else
                    await request(
                      tx.objectStore('syncOutbox').delete(current.op.id),
                    );
                } catch (error) {
                  // A caller may catch a rejected mutation inside its transaction.
                  // Once the store write succeeded, an outbox failure must abort
                  // that transaction to prevent committing an unsynchronized edit.
                  try {
                    tx.abort();
                  } catch {
                    /* Already inactive or aborted. */
                  }
                  throw error;
                }
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
