import { createHash, randomUUID } from 'node:crypto';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const canonical = (value) => JSON.stringify(sort(value));
function sort(v) {
  return Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        )
      : v;
}
export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const types = [
  'libraryPages',
  'libraryItems',
  'workspaceSpaces',
  'tabCollections',
  'savedTabs',
  'shortcuts',
  'shortcutItems',
  'preferences',
  'wallpapers',
];
const fields = {
  libraryPages: ['id', 'name', 'icon', 'order'],
  libraryItems: [
    'id',
    'pageId',
    'kind',
    'gridX',
    'gridY',
    'width',
    'height',
    'widget',
    'text',
    'name',
    'url',
    'icon',
    'parent',
    'order',
    'updatedAt',
  ],
  workspaceSpaces: ['id', 'name', 'order', 'icon'],
  tabCollections: ['id', 'spaceId', 'name', 'order', 'updatedAt'],
  savedTabs: [
    'id',
    'collectionId',
    'position',
    'title',
    'url',
    'icon',
    'savedAt',
    'starred',
  ],
  shortcuts: ['id'],
  shortcutItems: ['id', 'groupId', 'position', 'name', 'url', 'icon'],
  preferences: ['id', 'value'],
  wallpapers: ['id', 'asset', 'sourceUrl', 'contentHash'],
};
const same = (a, b) => canonical(a ?? null) === canonical(b ?? null);
export function validateOperation(op) {
  if (
    !op ||
    !uuid.test(op.id) ||
    !uuid.test(op.deviceId) ||
    !Array.isArray(op.changes) ||
    !op.changes.length ||
    op.changes.length > 2000
  )
    throw new ApiError(400, 'invalid_operation');
  const seen = new Set();
  for (const c of op.changes) {
    if (
      !types.includes(c.table) ||
      typeof c.id !== 'string' ||
      !c.id.length ||
      c.id.length > 200 ||
      seen.has(c.table + ':' + c.id) ||
      !/^(0|[1-9][0-9]*)$/.test(c.revision)
    )
      throw new ApiError(400, 'invalid_change');
    seen.add(c.table + ':' + c.id);
    for (const p of [c.base, c.value])
      if (
        p !== null &&
        (!p ||
          typeof p !== 'object' ||
          Array.isArray(p) ||
          Object.keys(p).some((k) => !fields[c.table].includes(k)) ||
          p.id !== c.id)
      )
        throw new ApiError(400, 'invalid_entity');
  }
}
// Three-way merge, preserving the remote value on conflicting edits.
export function merge(change, remote) {
  if (same(change.base, change.value)) return remote;
  if (!remote || remote.deleted) {
    if (change.revision !== '0' || change.base !== null)
      throw new ApiError(409, 'deleted_or_missing');
    if (change.value === null) return remote;
    return { payload: change.value, deleted: false };
  }
  const current = remote.payload;
  if (change.revision !== remote.revision) {
    if (change.value === null) throw new ApiError(409, 'delete_conflict');
    const changed = Object.keys({ ...change.base, ...change.value }).filter(
      (k) => k !== 'updatedAt' && !same(change.base?.[k], change.value[k]),
    );
    const location = [
      'pageId',
      'parent',
      'order',
      'gridX',
      'gridY',
      'width',
      'height',
      'collectionId',
      'position',
      'spaceId',
    ];
    if (
      changed.some((k) => location.includes(k)) &&
      location.some((k) => !same(change.base?.[k], current[k]))
    )
      throw new ApiError(409, 'layout_conflict');
    if (
      changed.some(
        (k) =>
          !same(change.base?.[k], current[k]) &&
          !same(change.value[k], current[k]),
      )
    )
      throw new ApiError(409, 'field_conflict');
    const result = { ...current };
    for (const k of changed) {
      if (k in change.value) result[k] = change.value[k];
      else delete result[k];
    }
    if (change.value.updatedAt) result.updatedAt = change.value.updatedAt;
    return { payload: result, deleted: false };
  }
  // Verify the base rather than trusting a caller's revision alone.
  if (!same(change.base, current)) throw new ApiError(409, 'base_mismatch');
  return { payload: change.value ?? current, deleted: change.value === null };
}
export function validateGraph(rows) {
  if (
    rows.length > 10000 ||
    Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 * 1024
  )
    throw new ApiError(413, 'account_data_quota');
  const all = new Map(
    rows
      .filter((r) => !r.deleted)
      .map((r) => [r.table + ':' + r.id, r.payload]),
  );
  for (const r of rows.filter((r) => !r.deleted)) {
    const p = r.payload;
    if (
      (typeof p.name === 'string' && p.name.length > 200) ||
      (typeof p.text === 'string' && p.text.length > 200000)
    )
      throw new ApiError(400, 'field_too_long');
    if (p.url && (!/^https?:\/\//i.test(p.url) || p.url.length > 10000))
      throw new ApiError(400, 'invalid_url');
    if (r.table === 'libraryItems') {
      if (!['link', 'folder', 'widget'].includes(p.kind))
        throw new ApiError(400, 'invalid_kind');
      if (p.parent) {
        const folder = all.get('libraryItems:' + p.parent);
        if (
          !folder ||
          folder.kind !== 'folder' ||
          folder.pageId !== p.pageId ||
          p.kind !== 'link'
        )
          throw new ApiError(409, 'invalid_parent');
      }
      if (
        p.pageId &&
        !['home', '__dock'].includes(p.pageId) &&
        !all.has('libraryPages:' + p.pageId)
      )
        throw new ApiError(409, 'missing_page');
      for (const k of ['width', 'height', 'gridX', 'gridY'])
        if (
          p[k] !== undefined &&
          (!Number.isInteger(p[k]) ||
            p[k] < (k === 'width' || k === 'height' ? 1 : 0) ||
            p[k] > (k === 'height' || k === 'gridY' ? 8 : 18))
        )
          throw new ApiError(400, 'invalid_geometry');
      if (
        p.pageId === 'home' &&
        !p.parent &&
        (p.gridY ?? 0) + (p.height ?? 1) > 5
      )
        throw new ApiError(409, 'out_of_bounds');
      if (
        !p.parent &&
        ((p.gridX ?? 0) + (p.width ?? 1) > 16 ||
          (p.gridY ?? 0) + (p.height ?? 1) > 8)
      )
        throw new ApiError(409, 'out_of_bounds');
    }
    if (
      r.table === 'tabCollections' &&
      p.spaceId &&
      !all.has('workspaceSpaces:' + p.spaceId)
    )
      throw new ApiError(409, 'missing_space');
    if (r.table === 'savedTabs' && !all.has('tabCollections:' + p.collectionId))
      throw new ApiError(409, 'missing_collection');
    if (r.table === 'shortcutItems' && !all.has('shortcuts:' + p.groupId))
      throw new ApiError(409, 'missing_shortcut_group');
    if (
      r.table === 'preferences' &&
      !['glassMode', 'searchEngine', 'dockOrder', 'wallpaperMode'].includes(
        p.id,
      ) &&
      !p.id.startsWith('layout:')
    )
      throw new ApiError(400, 'invalid_preference');
  }
  // Persisted free layouts must not overlap. Folder children have automatic layout.
  const occupied = new Set();
  for (const r of rows.filter(
    (r) =>
      r.table === 'libraryItems' &&
      !r.deleted &&
      !r.payload.parent &&
      r.payload.pageId !== '__dock',
  )) {
    const p = r.payload;
    if (p.gridX === undefined || p.gridY === undefined) continue;
    for (let y = p.gridY; y < p.gridY + (p.height ?? 1); y++)
      for (let x = p.gridX; x < p.gridX + (p.width ?? 1); x++) {
        const k = `${p.pageId}:${x}:${y}`;
        if (occupied.has(k)) throw new ApiError(409, 'layout_overlap');
        occupied.add(k);
      }
  }
}
export async function applyOperation(pool, account, op) {
  validateOperation(op);
  const digest = hash(canonical(op));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.account_id',$1,true)", [account.id]);
    await db.query(
      'INSERT INTO sync_accounts(id,issuer,subject) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO NOTHING',
      [account.id, account.issuer, account.sub],
    );
    const a = (
      await db.query(
        'SELECT * FROM sync_accounts WHERE issuer=$1 AND subject=$2 FOR UPDATE',
        [account.issuer, account.sub],
      )
    ).rows[0];
    const receipt = (
      await db.query(
        'SELECT request_hash,result FROM sync_receipts WHERE account_id=$1 AND operation_id=$2',
        [a.id, op.id],
      )
    ).rows[0];
    if (receipt) {
      if (receipt.request_hash !== digest)
        throw new ApiError(409, 'idempotency_mismatch');
      await db.query('COMMIT');
      return receipt.result;
    }
    const rows = (
      await db.query(
        'SELECT entity_type AS table,entity_id AS id,payload,deleted,revision::text FROM sync_entities WHERE account_id=$1',
        [a.id],
      )
    ).rows;
    const indexed = new Map(rows.map((r) => [r.table + ':' + r.id, r]));
    const updates = [];
    let conflict;
    try {
      for (const c of op.changes) {
        const remote = indexed.get(c.table + ':' + c.id);
        const merged = merge(c, remote);
        if (!merged) continue;
        const next = { table: c.table, id: c.id, ...merged };
        indexed.set(c.table + ':' + c.id, next);
        updates.push(next);
      }
      validateGraph([...indexed.values()]);
      const assetRefs = JSON.stringify(updates).matchAll(
        /duoyu-asset:([0-9a-f]{64})/g,
      );
      for (const [, sha] of assetRefs)
        if (
          !(
            await db.query(
              'SELECT 1 FROM sync_assets WHERE account_id=$1 AND sha256=$2',
              [a.id, sha],
            )
          ).rowCount
        )
          throw new ApiError(409, 'missing_asset');
    } catch (e) {
      if (e.status !== 409) throw e;
      conflict = e.code;
    }
    let result;
    if (conflict) {
      result = {
        status: 'conflict',
        code: conflict,
        revision: a.head_revision,
      };
      await db.query(
        'INSERT INTO sync_conflicts(id,account_id,operation_id,detail) VALUES($1,$2,$3,$4)',
        [
          randomUUID(),
          a.id,
          op.id,
          JSON.stringify({ code: conflict, changes: op.changes }),
        ],
      );
    } else {
      const revision = (BigInt(a.head_revision) + 1n).toString();
      for (const u of updates) {
        u.revision = revision;
        await db.query(
          'INSERT INTO sync_entities(account_id,entity_type,entity_id,payload,deleted,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(account_id,entity_type,entity_id) DO UPDATE SET payload=EXCLUDED.payload,deleted=EXCLUDED.deleted,revision=EXCLUDED.revision',
          [a.id, u.table, u.id, JSON.stringify(u.payload), u.deleted, revision],
        );
      }
      await db.query('UPDATE sync_accounts SET head_revision=$2 WHERE id=$1', [
        a.id,
        revision,
      ]);
      await db.query(
        'INSERT INTO sync_changes(account_id,revision,operation_id,changes) VALUES($1,$2,$3,$4)',
        [a.id, revision, op.id, JSON.stringify(updates)],
      );
      result = { status: 'applied', revision, changes: updates };
    }
    await db.query(
      'INSERT INTO sync_receipts(account_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4)',
      [a.id, op.id, digest, JSON.stringify(result)],
    );
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
