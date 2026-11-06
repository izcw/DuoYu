import {
  DESKTOP_GRID_COLUMNS,
  LIBRARY_GRID_ROWS,
} from '../library/grid-config';
import { collectionColor } from '../../shared/collection-colors';
import {
  database,
  isCurrentDatabaseAccount,
} from '../../shared/storage/database';
import { activeAccountKey } from '../../shared/storage/account';
import {
  prepareAsset,
  storePreparedAsset,
  collectAssets,
  ASSET_PREFIX,
  type PreparedAsset,
} from './assets';
import { rowChanges, type Row } from './model';
export interface ImportPlan {
  account: string;
  tables: Record<string, Row[]>;
  assets: PreparedAsset[];
  digest: string;
  counts: Record<string, number>;
}
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
function safeTree(v: any, depth = 0) {
  if (depth > 25) throw Error('JSON层级过深');
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k))
        throw Error('JSON包含不允许的字段');
      safeTree(x, depth + 1);
    }
  }
}
function array(value: any) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10000)
    throw Error('备份项目数量或格式不正确');
  return value;
}
function ids(rows: Row[]) {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (
      !object(row) ||
      typeof row.id !== 'string' ||
      !row.id ||
      map.has(row.id)
    )
      throw Error('备份包含无效或重复项目ID');
    map.set(row.id, crypto.randomUUID());
  }
  return map;
}
function text(v: any, max: number, fallback = '') {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}
function url(v: any) {
  if (!v) return '';
  try {
    const u = new URL(v);
    if (!['http:', 'https:'].includes(u.protocol)) throw Error();
    return u.href;
  } catch {
    throw Error('备份包含无效网址');
  }
}
function image(data: string) {
  if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(data))
    throw Error('备份图片格式不支持');
  const [header, body] = data.split(',');
  try {
    const bytes = Uint8Array.from(atob(body!), (c) => c.charCodeAt(0));
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Error();
    return new Blob([bytes], { type: header!.slice(5).split(';')[0] });
  } catch {
    throw Error('备份图片无效或超过20MB');
  }
}
const finite = (v: any, fallback = 0) => (Number.isFinite(v) ? v : fallback);
function requireImportTarget(account: string) {
  if (!isCurrentDatabaseAccount(account))
    throw Error('账号已切换，请在当前账号重新预览备份');
}
type ImportGrid = { id: string; occupied: Set<number> };
function placeOnPage(item: Row, grid: ImportGrid) {
  const { width, height } = item;
  if (
    DESKTOP_GRID_COLUMNS * LIBRARY_GRID_ROWS - grid.occupied.size <
    width * height
  )
    return false;
  for (let y = 0; y <= LIBRARY_GRID_ROWS - height; y++) {
    candidate: for (let x = 0; x <= DESKTOP_GRID_COLUMNS - width; x++) {
      for (let dy = 0; dy < height; dy++)
        for (let dx = 0; dx < width; dx++) {
          if (grid.occupied.has((y + dy) * DESKTOP_GRID_COLUMNS + x + dx))
            continue candidate;
        }
      item.pageId = grid.id;
      item.gridX = x;
      item.gridY = y;
      for (let dy = 0; dy < height; dy++)
        for (let dx = 0; dx < width; dx++)
          grid.occupied.add((y + dy) * DESKTOP_GRID_COLUMNS + x + dx);
      return true;
    }
  }
  return false;
}
export async function planJsonImport(
  content: string,
  includeSettings = false,
  account = activeAccountKey(),
): Promise<ImportPlan> {
  requireImportTarget(account);
  if (content.length > 50 * 1024 * 1024) throw Error('JSON文件不能超过50MB');
  let source;
  try {
    source = JSON.parse(content);
  } catch {
    throw Error('文件不是有效JSON');
  }
  safeTree(source);
  if (
    !object(source) ||
    source.format !== 'duoyu-backup' ||
    source.version !== 1 ||
    !object(source.tables)
  )
    throw Error('请选择多鱼导出的JSON备份文件');
  const raw = source.tables,
    tables: Record<string, Row[]> = {
      libraryPages: [],
      libraryItems: [],
      workspaceSpaces: [],
      tabCollections: [],
      shortcuts: [],
      preferences: [],
      wallpapers: [],
    },
    assets: PreparedAsset[] = [];
  const pages = array(raw.libraryPages),
    items = array(raw.libraryItems),
    spaces = array(raw.workspaceSpaces),
    groups = array(raw.tabCollections);
  const pageIds = ids(pages),
    itemIds = ids(items),
    spaceIds = ids(spaces),
    groupIds = ids(groups);
  for (const p of pages)
    tables.libraryPages!.push({
      id: pageIds.get(p.id),
      name: text(p.name, 60, '导入的收藏'),
      icon: text(p.icon, 80, 'Bookmark'),
      order: finite(p.order, tables.libraryPages!.length),
    });
  function importedPage(old: string) {
    let id = pageIds.get(old);
    if (!id) {
      id = crypto.randomUUID();
      pageIds.set(old, id);
      tables.libraryPages!.push({
        id,
        name:
          old === 'home'
            ? '导入的首页'
            : old === '__dock'
              ? '导入的Dock'
              : '导入的收藏',
        order: tables.libraryPages!.length,
      });
    }
    return id;
  }
  const sourceKinds = new Map(items.map((item) => [item.id, item.kind]));
  for (const original of items) {
    if (!['link', 'folder', 'widget'].includes(original.kind))
      throw Error('备份项目类型不支持');
    if (
      original.parent &&
      (!itemIds.has(original.parent) ||
        sourceKinds.get(original.parent) !== 'folder' ||
        original.kind !== 'link')
    )
      throw Error('备份文件夹关系不正确');
    const value: Row = {
      id: itemIds.get(original.id),
      kind: original.kind,
      pageId: importedPage(original.pageId || 'default'),
      parent: original.parent ? itemIds.get(original.parent) : '',
      name: text(original.name, 200, '导入的项目'),
      url: url(original.url),
      icon: text(original.icon, 4 * 1024 * 1024),
      order: finite(original.order, tables.libraryItems!.length),
      updatedAt: Date.now(),
      width: Math.max(
        1,
        Math.min(
          DESKTOP_GRID_COLUMNS,
          Math.floor(finite(original.width, original.kind === 'link' ? 1 : 3)),
        ),
      ),
      height: Math.max(
        1,
        Math.min(LIBRARY_GRID_ROWS, Math.floor(finite(original.height, 1))),
      ),
    };
    if (original.kind === 'widget') {
      if (!['calendar', 'weather', 'note'].includes(original.widget))
        throw Error('备份组件类型不支持');
      value.widget = original.widget;
      value.text = text(original.text, 200000);
    }
    tables.libraryItems!.push(value);
  }
  // Additive import gets dedicated pages and bounded positions, leaving existing
  // cloud items untouched. Overflow creates another imported page.
  const gridsBySource = new Map<string, ImportGrid[]>();
  const importedItems = tables.libraryItems!;
  for (const item of importedItems) {
    if (item.parent) continue;
    const sourcePage = item.pageId;
    let grids = gridsBySource.get(sourcePage);
    if (!grids) {
      grids = [{ id: sourcePage, occupied: new Set() }];
      gridsBySource.set(sourcePage, grids);
    }
    if (grids.some((grid) => placeOnPage(item, grid))) continue;
    const next = { id: crypto.randomUUID(), occupied: new Set<number>() };
    tables.libraryPages!.push({
      id: next.id,
      name: '导入的收藏（续）',
      order: tables.libraryPages!.length,
    });
    grids.push(next);
    // Dimensions were bounded above, so the item fits an empty page.
    placeOnPage(item, next);
  }
  const byId = new Map(importedItems.map((item) => [item.id, item]));
  for (const item of importedItems) {
    if (item.parent) item.pageId = byId.get(item.parent)!.pageId;
  }
  for (const s of spaces)
    tables.workspaceSpaces!.push({
      id: spaceIds.get(s.id),
      name: text(s.name, 80, '导入的空间'),
      order: finite(s.order, tables.workspaceSpaces!.length),
      ...(s.icon ? { icon: text(s.icon, 80) } : {}),
    });
  function importedSpace(old: string) {
    let id = spaceIds.get(old);
    if (!id) {
      id = crypto.randomUUID();
      spaceIds.set(old, id);
      tables.workspaceSpaces!.push({
        id,
        name: '导入的空间',
        order: tables.workspaceSpaces!.length,
      });
    }
    return id;
  }
  for (const g of groups) {
    const seen = new Set<string>();
    const tabs = array(g.tabs).map((tab: Row, index: number) => {
      if (!object(tab) || typeof tab.id !== 'string' || seen.has(tab.id))
        throw Error('备份标签格式不正确');
      seen.add(tab.id);
      return {
        id: crypto.randomUUID(),
        title: text(tab.title, 500),
        url: url(tab.url),
        icon: text(tab.icon, 4 * 1024 * 1024),
        savedAt: finite(tab.savedAt, Date.now()),
        ...(tab.starred ? { starred: true } : {}),
      };
    });
    tables.tabCollections!.push({
      id: groupIds.get(g.id),
      spaceId: importedSpace(g.spaceId || 'default'),
      ...(g.color ? { color: collectionColor(g.color) } : {}),
      name: text(g.name, 200, '导入的集合'),
      order: finite(g.order, tables.tabCollections!.length),
      updatedAt: Date.now(),
      tabs,
    });
  }
  for (const entry of array(source.assets)) {
    if (!object(entry) || typeof entry.data !== 'string')
      throw Error('备份图片资源格式不正确');
    const asset = await prepareAsset(image(entry.data));
    if (entry.id !== asset.id) throw Error('备份图片校验失败');
    assets.push(asset);
  }
  if (includeSettings) {
    for (const r of array(raw.preferences)) {
      if (
        object(r) &&
        ([
          'glassMode',
          'searchEngine',
          'dockOrder',
          'wallpaperResumeDesktop',
          'wallpaperMode',
          'wallpaperSelection',
          'savedWallpaper:store',
          'savedWallpaper:upload',
        ].includes(r.id) ||
          String(r.id).startsWith('layout:') ||
          String(r.id).startsWith('wallpaperDesktop:'))
      )
        tables.preferences!.push({ id: r.id, value: r.value });
    }
    for (const key of ['glassMode', 'searchEngine'])
      if (
        source.storage?.[key] !== undefined &&
        !tables.preferences!.some((p) => p.id === key)
      )
        tables.preferences!.push({ id: key, value: source.storage[key] });
    for (const w of array(raw.wallpapers)) {
      if (w.id !== 'daily' || !String(w.sourceUrl).startsWith('local:'))
        continue;
      const blob =
        typeof w.blob === 'string' && w.blob.startsWith('data:')
          ? image(w.blob)
          : undefined;
      if (blob) {
        tables.wallpapers!.push({
          id: 'daily',
          sourceUrl: w.sourceUrl,
          blob,
          contentHash: w.contentHash,
          savedAt: Date.now(),
        });
        tables.preferences!.push({ id: 'wallpaperMode', value: 'custom' });
      }
    }
  }
  const known = new Set(assets.map((asset) => ASSET_PREFIX + asset.id));
  for (const ref of collectAssets(tables))
    if (
      !known.has(ref) &&
      !(await database.syncAssets.get(ref.slice(ASSET_PREFIX.length)))
    )
      throw Error('备份缺少图片文件，请在原设备重新导出完整备份');
  const changes = rowChanges(
    Object.fromEntries(
      Object.entries(tables).flatMap(([table, rows]) =>
        rows.map((value) => [
          table + ':' + value.id,
          { table, id: value.id, base: null, value },
        ]),
      ),
    ),
  );
  if (changes.length > 2000) throw Error('单次导入最多2000条，请拆分备份文件');
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(content + '\0' + includeSettings),
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  requireImportTarget(account);
  return {
    account,
    tables,
    assets,
    digest,
    counts: {
      页面: tables.libraryPages!.length,
      图标与组件: tables.libraryItems!.length,
      空间: tables.workspaceSpaces!.length,
      集合: tables.tabCollections!.length,
      标签: groups.reduce((n, g) => n + (g.tabs?.length || 0), 0),
      图片: assets.length,
    },
  };
}
export async function commitJsonImport(plan: ImportPlan) {
  if (!activeAccountKey()) throw Error('请先登录再导入账号数据');
  requireImportTarget(plan.account);
  try {
    await database.transaction('rw', database.tables, async () => {
      const key = 'import:' + plan.digest;
      if (await database.syncMeta.get(key)) throw Error('这个文件已经导入过了');
      for (const asset of plan.assets) await storePreparedAsset(asset);
      for (const [table, rows] of Object.entries(plan.tables))
        if (rows.length) await database.table(table).bulkPut(rows);
      await database.syncMeta.put({ id: key, value: Date.now() });
      requireImportTarget(plan.account);
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'QuotaExceededError')
        throw Error('本机存储空间不足，导入未保存，请释放空间后重试', {
          cause: error,
        });
      if (['AbortError', 'TransactionInactiveError'].includes(error.name))
        throw Error('导入中断，数据未保存，请重试', { cause: error });
    }
    throw error;
  }
}
