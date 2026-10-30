export type Row = Record<string, any>;
export interface Entity {
  table: string;
  id: string;
  payload: Row;
  deleted: boolean;
  revision: string;
}
export interface Change {
  table: string;
  id: string;
  base: Row | null;
  value: Row | null;
  revision: string;
  restore?: boolean;
}
export function normalized(table: string, row: Row | null): Row[] {
  if (!row) return [];
  if (table === 'tabCollections') {
    const { tabs = [], ...group } = row;
    return [
      { table, id: row.id, payload: group },
      ...tabs.map((t: Row, i: number) => ({
        table: 'savedTabs',
        id: t.id,
        payload: { ...t, collectionId: row.id, position: i },
      })),
    ];
  }
  if (table === 'shortcuts')
    return [
      { table, id: row.id, payload: { id: row.id } },
      ...(row.items || []).map((v: Row, i: number) => ({
        table: 'shortcutItems',
        id: row.id + ':' + v.id,
        payload: {
          ...v,
          id: row.id + ':' + v.id,
          groupId: row.id,
          position: i,
        },
      })),
    ];
  if (table === 'wallpapers')
    return String(row.sourceUrl).startsWith('local:')
      ? [
          {
            table,
            id: row.id,
            payload: {
              id: row.id,
              asset: row.blob ?? row.asset,
              sourceUrl: row.sourceUrl,
              contentHash: row.contentHash,
            },
          },
        ]
      : [];
  return [{ table, id: row.id, payload: row }];
}
export const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
/** Plain IndexedDB-safe values from view models, preserving immutable Blob resources. */
export function snapshotValue<T>(value: T): T {
  return sorted(value);
}
function sorted(v: any): any {
  return Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object' && !(v instanceof Blob)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;
}
export function rowChanges(
  rows: Record<string, { table: string; id: string; base: any; value: any }>,
): Change[] {
  const before = new Map<string, Row>(),
    after = new Map<string, Row>();
  for (const r of Object.values(rows)) {
    for (const e of normalized(r.table, r.base))
      before.set(e.table + ':' + e.id, e);
    for (const e of normalized(r.table, r.value))
      after.set(e.table + ':' + e.id, e);
  }
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((k) => {
    const a = before.get(k),
      b = after.get(k);
    return same(a?.payload ?? null, b?.payload ?? null)
      ? []
      : [
          {
            table: (a ?? b)!.table,
            id: (a ?? b)!.id,
            base: a?.payload ?? null,
            value: b?.payload ?? null,
            revision: '0',
          },
        ];
  });
}
export function overlay(remote: Map<string, Entity>, changes: Change[]) {
  for (const c of changes) {
    const k = c.table + ':' + c.id;
    if (c.value === null) {
      remote.delete(k);
      continue;
    }
    const payload = { ...(remote.get(k)?.payload ?? c.base ?? {}) };
    for (const field of Object.keys({ ...c.base, ...c.value }))
      if (!same(c.base?.[field], c.value[field])) {
        if (field in c.value) payload[field] = c.value[field];
        else delete payload[field];
      }
    payload.id = c.id;
    remote.set(k, {
      table: c.table,
      id: c.id,
      payload,
      deleted: false,
      revision: '0',
    });
  }
}
export function denormalized(entities: Entity[]): Record<string, Row[]> {
  const tables: Record<string, Row[]> = {
    libraryPages: [],
    libraryItems: [],
    workspaceSpaces: [],
    tabCollections: [],
    shortcuts: [],
    preferences: [],
    wallpapers: [],
  };
  const live = entities.filter((e) => !e.deleted);
  for (const e of live) {
    if (e.table === 'savedTabs' || e.table === 'shortcutItems') continue;
    const p = { ...e.payload };
    if (e.table === 'tabCollections')
      p.tabs = live
        .filter(
          (t) => t.table === 'savedTabs' && t.payload.collectionId === e.id,
        )
        .sort((a, b) => a.payload.position - b.payload.position)
        .map((t) => {
          const { collectionId, position, ...tab } = t.payload;
          return tab;
        });
    if (e.table === 'shortcuts')
      p.items = live
        .filter(
          (t) => t.table === 'shortcutItems' && t.payload.groupId === e.id,
        )
        .sort((a, b) => a.payload.position - b.payload.position)
        .map((t) => {
          const { groupId, position, ...item } = t.payload;
          item.id = item.id.slice(groupId.length + 1);
          return item;
        });
    if (e.table === 'wallpapers') {
      p.blob = p.asset;
      delete p.asset;
      p.savedAt = Date.now();
    }
    tables[e.table]?.push(p);
  }
  return tables;
}
