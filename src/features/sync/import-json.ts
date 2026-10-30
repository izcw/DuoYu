import { database } from '../../shared/storage/database';
import { activeAccountKey } from '../../shared/storage/account';
import { cacheAsset, collectAssets, ASSET_PREFIX } from './assets';
import { rowChanges, type Row } from './model';
export interface ImportPlan {
  tables: Record<string, Row[]>;
  assets: Blob[];
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
export async function planJsonImport(
  content: string,
  includeSettings = false,
): Promise<ImportPlan> {
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
    assets: Blob[] = [];
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
  for (const original of items) {
    if (!['link', 'folder', 'widget'].includes(original.kind))
      throw Error('备份项目类型不支持');
    if (
      original.parent &&
      (!itemIds.has(original.parent) ||
        items.find((i) => i.id === original.parent)?.kind !== 'folder' ||
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
          16,
          Math.floor(finite(original.width, original.kind === 'link' ? 1 : 3)),
        ),
      ),
      height: Math.max(1, Math.min(8, Math.floor(finite(original.height, 1)))),
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
  const occupied = new Map<string, Set<number>>();
  for (const item of tables.libraryItems!.filter((i) => !i.parent)) {
    let page = item.pageId;
    let placed = false;
    while (!placed) {
      const cells = occupied.get(page) ?? new Set<number>();
      occupied.set(page, cells);
      outer: for (let y = 0; y <= 8 - item.height; y++)
        for (let x = 0; x <= 16 - item.width; x++) {
          if (
            Array.from({ length: item.height }, (_, dy) =>
              Array.from({ length: item.width }, (_, dx) =>
                cells.has((y + dy) * 16 + x + dx),
              ),
            )
              .flat()
              .some(Boolean)
          )
            continue;
          item.pageId = page;
          item.gridX = x;
          item.gridY = y;
          for (let dy = 0; dy < item.height; dy++)
            for (let dx = 0; dx < item.width; dx++)
              cells.add((y + dy) * 16 + x + dx);
          placed = true;
          break outer;
        }
      if (!placed) {
        page = crypto.randomUUID();
        tables.libraryPages!.push({
          id: page,
          name: '导入的收藏（续）',
          order: tables.libraryPages!.length,
        });
      }
    }
  }
  for (const item of tables.libraryItems!.filter((i) => i.parent))
    item.pageId = tables.libraryItems!.find(
      (i) => i.id === item.parent,
    )!.pageId;
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
      name: text(g.name, 200, '导入的集合'),
      order: finite(g.order, tables.tabCollections!.length),
      updatedAt: Date.now(),
      tabs,
    });
  }
  for (const entry of array(source.assets)) {
    if (!object(entry) || typeof entry.data !== 'string')
      throw Error('备份图片资源格式不正确');
    const blob = image(entry.data);
    const sha = [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    if (entry.id !== sha) throw Error('备份图片校验失败');
    assets.push(blob);
  }
  if (includeSettings) {
    for (const r of array(raw.preferences)) {
      if (
        object(r) &&
        (['glassMode', 'searchEngine', 'dockOrder', 'wallpaperMode'].includes(
          r.id,
        ) ||
          String(r.id).startsWith('layout:'))
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
  const known = new Set(
    assets.length
      ? await Promise.all(
          assets.map(
            async (blob) =>
              ASSET_PREFIX +
              [
                ...new Uint8Array(
                  await crypto.subtle.digest(
                    'SHA-256',
                    await blob.arrayBuffer(),
                  ),
                ),
              ]
                .map((x) => x.toString(16).padStart(2, '0'))
                .join(''),
          ),
        )
      : [],
  );
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
  return {
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
  for (const blob of plan.assets) await cacheAsset(blob);
  await database.transaction('rw', database.tables, async () => {
    const key = 'import:' + plan.digest;
    if (await database.syncMeta.get(key)) throw Error('这个文件已经导入过了');
    for (const [table, rows] of Object.entries(plan.tables))
      if (rows.length) await database.table(table).bulkPut(rows);
    await database.syncMeta.put({ id: key, value: Date.now() });
  });
}
