import { Dexie, type EntityTable } from 'dexie';

export interface ShortcutItem {
  id: string;
  name: string;
  url?: string;
  icon: string;
}
export interface ShortcutRecord {
  id: 'wallpaper' | 'engines';
  items: ShortcutItem[];
}

export interface WidgetLayoutRecord {
  id: 'categories';
  groups: { id: string; linkIds: string[] }[];
}

export interface WallpaperRecord {
  id: 'daily';
  sourceUrl: string;
  blob: Blob;
  savedAt: number;
}

export interface SavedTab {
  id: string;
  title: string;
  url: string;
  icon: string;
  savedAt: number;
}
export interface TabCollection {
  id: string;
  name: string;
  order: number;
  updatedAt: number;
  tabs: SavedTab[];
}
export interface LibraryItem {
  id: string;
  kind: 'link' | 'folder';
  name: string;
  url: string;
  icon: string;
  parent: string;
  order: number;
  updatedAt: number;
}

/** Shared IndexedDB entry point. Add future tables through versioned migrations. */
export const database = new Dexie('duoyu') as Dexie & {
  wallpapers: EntityTable<WallpaperRecord, 'id'>;
  shortcuts: EntityTable<ShortcutRecord, 'id'>;
  widgetLayouts: EntityTable<WidgetLayoutRecord, 'id'>;
  tabCollections: EntityTable<TabCollection, 'id'>;
  libraryItems: EntityTable<LibraryItem, 'id'>;
};

database.version(1).stores({
  wallpapers: 'id',
});
database.version(2).stores({ wallpapers: 'id', shortcuts: 'id' });

database
  .version(3)
  .stores({ wallpapers: 'id', shortcuts: 'id', widgetLayouts: 'id' });

database.version(4).stores({
  wallpapers: 'id',
  shortcuts: 'id',
  widgetLayouts: 'id',
  tabCollections: 'id, order, updatedAt',
});
database.version(5).stores({
  wallpapers: 'id',
  shortcuts: 'id',
  widgetLayouts: 'id',
  tabCollections: 'id, order, updatedAt',
  libraryItems: 'id, parent, order, updatedAt',
});
