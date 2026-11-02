import { same, type Entity, type Change, type Row } from './model';
import type { LibraryItem } from '../../shared/storage/database';
import { layoutLibraryItems } from '../library/grid-layout';
import { HOME_GRID_ROWS, LIBRARY_GRID_ROWS } from '../library/grid-config';
export function previewVersion(
  shadow: Entity[],
  changes: Change[],
  local: boolean,
): Entity[] {
  const map = new Map(
    shadow
      .filter((e) => !e.deleted)
      .map((e) => [e.table + ':' + e.id, { ...e, payload: { ...e.payload } }]),
  );
  if (local)
    for (const c of changes) {
      const key = c.table + ':' + c.id;
      if (c.value === null) map.delete(key);
      else
        map.set(key, {
          table: c.table,
          id: c.id,
          payload: { ...c.value },
          deleted: false,
          revision: map.get(key)?.revision ?? '0',
        });
    }
  return [...map.values()];
}
/** Use the desktop's placement rules, with the selected local positions reserved first. */
export function prepareLocalPreview(shadow: Entity[], changes: Change[]) {
  const entities = previewVersion(shadow, changes, true);
  const index = new Map(entities.map((e) => [e.table + ':' + e.id, e]));
  const affected = new Set<string>(),
    priority = new Set(
      changes.filter((c) => c.table === 'libraryItems').map((c) => c.id),
    );
  for (const c of changes) {
    if (c.table === 'libraryItems') {
      if (c.base) affected.add(c.base.pageId || 'home');
      if (c.value) affected.add(c.value.pageId || 'home');
    }
    if (c.table === 'libraryPages') affected.add(c.id);
  }
  const library = previewItems(entities, 'page:home').all;
  let overflow = 0;
  for (const item of library) {
    const e = index.get('libraryItems:' + item.id);
    if (
      e &&
      (e.payload.parent !== item.parent || e.payload.pageId !== item.pageId)
    ) {
      affected.add(e.payload.pageId || 'home');
      affected.add(item.pageId || 'home');
      e.payload = { ...e.payload, parent: item.parent, pageId: item.pageId };
    }
  }
  for (const page of affected) {
    if (page === '__dock') continue;
    const items = library.filter(
      (i) => !i.parent && (i.pageId || 'home') === page,
    );
    const layout = layoutLibraryItems(
      items,
      page === 'home' ? HOME_GRID_ROWS : LIBRARY_GRID_ROWS,
      priority,
    );
    overflow += layout.overflow;
    for (const entry of layout.items) {
      const e = index.get('libraryItems:' + entry.item.id);
      if (e) e.payload = { ...e.payload, gridX: entry.x, gridY: entry.y };
    }
  }
  return { entities, overflow };
}
export function previewResolutionChanges(
  shadow: Entity[],
  original: Change[],
  desired: Entity[],
): Change[] {
  const before = new Map(shadow.map((e) => [e.table + ':' + e.id, e])),
    after = new Map(desired.map((e) => [e.table + ':' + e.id, e]));
  const result = original.map((c) =>
    c.value === null
      ? c
      : { ...c, value: after.get(c.table + ':' + c.id)?.payload ?? c.value },
  );
  const keys = new Set(result.map((c) => c.table + ':' + c.id));
  for (const e of desired) {
    const key = e.table + ':' + e.id,
      old = before.get(key);
    if (e.table !== 'libraryItems' || keys.has(key) || !old || old.deleted)
      continue;
    if (
      ['gridX', 'gridY', 'parent', 'pageId'].some(
        (k) => old.payload[k] !== e.payload[k],
      )
    )
      result.push({
        table: e.table,
        id: e.id,
        base: old.payload,
        value: e.payload,
        revision: old.revision,
      });
  }
  return result;
}
export function previewPages(versions: Entity[][]) {
  const pages = new Map<string, string>([
    ['page:home', '首页'],
    ['page:__dock', 'Dock'],
  ]);
  for (const entities of versions)
    for (const e of entities) {
      if (e.table === 'libraryPages')
        pages.set('page:' + e.id, e.payload.name || '收藏页');
      if (e.table === 'libraryItems' && e.payload.kind === 'folder')
        pages.set(
          'folder:' + e.id,
          '文件夹 · ' + (e.payload.name || '新文件夹'),
        );
      if (
        e.table === 'libraryItems' &&
        e.payload.pageId &&
        !['home', '__dock'].includes(e.payload.pageId) &&
        !pages.has('page:' + e.payload.pageId)
      )
        pages.set('page:' + e.payload.pageId, '收藏页');
      if (e.table === 'workspaceSpaces')
        pages.set('space:' + e.id, '工作区 · ' + (e.payload.name || '空间'));
      if (e.table === 'tabCollections')
        pages.set('tabs:' + e.id, '集合 · ' + (e.payload.name || '标签'));
      if (
        e.table === 'savedTabs' &&
        !pages.has('tabs:' + e.payload.collectionId)
      )
        pages.set(
          'tabs:' + e.payload.collectionId,
          '集合 · ' +
            (entities.find(
              (g) =>
                g.table === 'tabCollections' && g.id === e.payload.collectionId,
            )?.payload.name || '待恢复标签'),
        );
      if (e.table === 'tabCollections')
        pages.set(
          'space:' + (e.payload.spaceId || ''),
          '工作区 · ' +
            (entities.find(
              (s) =>
                s.table === 'workspaceSpaces' && s.id === e.payload.spaceId,
            )?.payload.name || '空间'),
        );
      if (e.table === 'shortcuts')
        pages.set(
          'shortcuts:' + e.id,
          '快捷方式 · ' + (e.payload.name || e.id),
        );
    }
  return [...pages].map(([id, name]) => ({ id, name }));
}
export function previewItems(entities: Entity[], view: string) {
  const library = entities
    .filter(
      (e) =>
        e.table === 'libraryItems' &&
        ['link', 'folder', 'widget'].includes(e.payload.kind),
    )
    .map((e) => ({ ...e.payload, id: e.id }) as LibraryItem);
  const known = new Set(
    library.filter((i) => i.kind === 'folder').map((i) => i.id),
  );
  const pages = new Set(
    entities.filter((e) => e.table === 'libraryPages').map((e) => e.id),
  );
  for (const item of library) {
    if (item.parent && !known.has(item.parent)) item.parent = '';
    if (
      item.pageId &&
      !['home', '__dock'].includes(item.pageId) &&
      !pages.has(item.pageId)
    )
      item.pageId = 'home';
  }
  if (view.startsWith('folder:')) {
    const id = view.slice(7);
    return {
      all: library,
      items: library
        .filter((i) => i.parent === id)
        .map((i) => ({
          ...i,
          parent: '',
          gridX: undefined,
          gridY: undefined,
          width: 1,
          height: 1,
        })),
    };
  }
  if (view.startsWith('page:')) {
    const page = view.slice(5);
    return {
      all: library,
      items: library.filter((i) => !i.parent && (i.pageId || 'home') === page),
    };
  }
  if (view.startsWith('tabs:') || view.startsWith('shortcuts:')) {
    const tabs = view.startsWith('tabs:');
    const id = view.slice(tabs ? 5 : 10);
    const links = entities
      .filter((e) =>
        tabs
          ? e.table === 'savedTabs' && e.payload.collectionId === id
          : e.table === 'shortcutItems' && e.payload.groupId === id,
      )
      .sort((a, b) => (a.payload.position || 0) - (b.payload.position || 0))
      .map(
        (e) =>
          ({
            id: e.id,
            kind: 'link',
            name: e.payload.title || e.payload.name || '网址',
            url: e.payload.url || '',
            icon: e.payload.icon || '',
            parent: '',
            order: e.payload.position || 0,
            updatedAt: 0,
            width: 1,
            height: 1,
          }) as LibraryItem,
      );
    return { all: links, items: links };
  }
  const items: LibraryItem[] = [],
    all: LibraryItem[] = [];
  const link = (e: Entity, parent: string): LibraryItem => ({
    id: e.id,
    kind: 'link',
    name: e.payload.title || e.payload.name || '网址',
    url: e.payload.url || '',
    icon: e.payload.icon || '',
    parent,
    order: e.payload.position || 0,
    updatedAt: 0,
    width: 1,
    height: 1,
  });
  const groups = entities.filter((e) =>
    view.startsWith('space:')
      ? e.table === 'tabCollections' &&
        (e.payload.spaceId || '') === view.slice(6)
      : e.table === 'shortcuts' && e.id === view.slice(10),
  );
  for (const group of groups) {
    const children = entities
      .filter((e) =>
        view.startsWith('space:')
          ? e.table === 'savedTabs' && e.payload.collectionId === group.id
          : e.table === 'shortcutItems' && e.payload.groupId === group.id,
      )
      .sort((a, b) => (a.payload.position || 0) - (b.payload.position || 0));
    const id = 'preview-group-' + group.id;
    const folder: LibraryItem = {
      id,
      kind: 'folder',
      name: group.payload.name || '快捷方式',
      icon: '',
      url: '',
      parent: '',
      order: 0,
      updatedAt: 0,
      width: Math.max(3, Math.min(5, children.length)),
      height: Math.max(1, Math.min(4, Math.ceil(children.length / 5))),
    };
    items.push(folder);
    all.push(folder, ...children.map((c) => link(c, id)));
  }
  return { all, items };
}
export const previewPreference = (entities: Entity[], id: string) =>
  entities.find((e) => e.table === 'preferences' && e.id === id)?.payload.value;
export function previewDefaultPage(changes: Change[]) {
  for (const c of changes) {
    const p: Row = c.value ?? c.base ?? {};
    if (c.table === 'libraryItems')
      return p.parent ? 'folder:' + p.parent : 'page:' + (p.pageId || 'home');
    if (c.table === 'libraryPages') return 'page:' + c.id;
    if (c.table === 'tabCollections') return 'space:' + (p.spaceId || '');
    if (c.table === 'workspaceSpaces') return 'space:' + c.id;
    if (c.table === 'savedTabs') return 'tabs:' + p.collectionId;
    if (c.table === 'shortcuts' || c.table === 'shortcutItems')
      return 'shortcuts:' + (p.groupId || c.id);
  }
  return 'page:home';
}
/** Include both sides of a move, without showing unrelated desktop pages. */
export function previewConflictViews(changes: Change[], versions: Entity[][]) {
  const views = new Set<string>();
  for (const change of changes) {
    const payloads = [
      change.value,
      change.base,
      ...versions.flatMap((version) =>
        version
          .filter(
            (e) => !e.deleted && e.table === change.table && e.id === change.id,
          )
          .map((e) => e.payload),
      ),
    ];
    for (const payload of payloads) {
      if (payload)
        views.add(previewDefaultPage([{ ...change, value: payload }]));
    }
    if (payloads.every((p) => !p)) views.add(previewDefaultPage([change]));
  }
  return views.size ? [...views] : ['page:home'];
}
/** Merge chronological edits field by field so a later icon edit cannot erase an earlier rename. */
export function mergePreviewChanges(groups: Change[][]): Change[] {
  const merged = new Map<string, Change>();
  for (const changes of groups)
    for (const change of changes) {
      const key = change.table + ':' + change.id;
      const previous = merged.get(key);
      if (!previous || !previous.value || !change.value) {
        merged.set(key, {
          ...change,
          value: change.value ? { ...change.value } : null,
        });
        continue;
      }
      const value = { ...previous.value };
      for (const field of Object.keys({ ...change.base, ...change.value })) {
        if (same(change.base?.[field], change.value[field])) continue;
        if (field in change.value) value[field] = change.value[field];
        else delete value[field];
      }
      merged.set(key, { ...previous, value });
    }
  return [...merged.values()];
}

/** Keep multi-menu operations together rather than splitting an atomic edit. */
export function groupPreviewMenus<T extends { id: string; createdAt: number }>(
  records: T[],
  getChanges: (record: T) => Change[],
  shadow: Entity[],
) {
  const allChanges = mergePreviewChanges(
    [...records]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(getChanges),
  );
  const versions = [previewVersion(shadow, allChanges, true), shadow];
  const menuOf = (view: string): string => {
    if (!view.startsWith('folder:')) return view;
    let id = view.slice(7);
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = versions
        .flat()
        .find((e) => e.table === 'libraryItems' && e.id === id);
      const payload =
        folder?.payload ??
        allChanges.find((c) => c.table === 'libraryItems' && c.id === id)?.base;
      if (!payload) break;
      if (!payload.parent) return 'page:' + (payload.pageId || 'home');
      id = payload.parent;
    }
    return 'page:home';
  };
  const groups: {
    id: string;
    menus: string[];
    records: T[];
    changes: Change[];
    name: string;
  }[] = [];
  for (const record of records) {
    const menus = new Set(
      previewConflictViews(getChanges(record), versions).map(menuOf),
    );
    const matching = groups.filter((group) =>
      group.menus.some((menu) => menus.has(menu)),
    );
    const members = [record, ...matching.flatMap((group) => group.records)];
    for (const group of matching) {
      group.menus.forEach((menu) => menus.add(menu));
      groups.splice(groups.indexOf(group), 1);
    }
    const keys = [...menus].sort();
    members.sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
    const changes = mergePreviewChanges(members.map(getChanges));
    const labels = previewPages([
      previewVersion(shadow, changes, true),
      shadow,
    ]);
    groups.push({
      id: keys.join('|'),
      menus: keys,
      records: members,
      changes,
      name: keys
        .map((key) => labels.find((p) => p.id === key)?.name || '桌面菜单')
        .join(' · '),
    });
  }
  return groups.sort(
    (a, b) => b.records.at(-1)!.createdAt - a.records.at(-1)!.createdAt,
  );
}
