import { Dexie, type EntityTable } from 'dexie';
import { activeAccountKey } from './account';
import {
  installSyncCapture,
  type CapturedOperation,
  type SyncConflict,
} from '../../features/sync/capture';

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
  id: 'categories' | 'dock' | 'library-demo-v1' | 'home-grid-v1';
  groups: { id: string; linkIds: string[] }[];
}

export interface WallpaperRecord {
  contentHash?: string;
  id: 'daily';
  sourceUrl: string;
  blob: Blob;
  savedAt: number;
}

export interface SavedTab {
  starred?: boolean;
  id: string;
  title: string;
  url: string;
  icon: string;
  savedAt: number;
}
export interface TabCollection {
  spaceId?: string;
  id: string;
  name: string;
  order: number;
  updatedAt: number;
  tabs: SavedTab[];
}
export interface WorkspaceSpace {
  id: string;
  name: string;
  order: number;
}
export interface LibraryPage {
  icon?: string;
  id: string;
  name: string;
  order: number;
}
export interface LibraryItem {
  pageId?: string;
  id: string;
  kind: 'link' | 'folder' | 'widget';
  gridX?: number;
  gridY?: number;
  width?: number;
  height?: number;
  widget?: 'calendar' | 'weather' | 'note';
  text?: string;
  name: string;
  url: string;
  icon: string;
  parent: string;
  order: number;
  updatedAt: number;
}

/** Shared IndexedDB entry point. Add future tables through versioned migrations. */
export const database = new Dexie(
  activeAccountKey() ? 'duoyu-account-' + activeAccountKey() : 'duoyu',
) as Dexie & {
  preferences: EntityTable<{ id: string; value: unknown }, 'id'>;
  syncOutbox: EntityTable<CapturedOperation, 'id'>;
  syncShadow: EntityTable<
    {
      id: string;
      table: string;
      entityId: string;
      payload: unknown;
      deleted: boolean;
      revision: string;
    },
    'id'
  >;
  syncMeta: EntityTable<{ id: string; value: unknown }, 'id'>;
  syncConflicts: EntityTable<SyncConflict, 'id'>;
  syncAssets: EntityTable<
    {
      id: string;
      blob: Blob;
      uploadedEpoch?: string;
      uploadedAt?: number;
      createdAt?: number;
    },
    'id'
  >;
  wallpapers: EntityTable<WallpaperRecord, 'id'>;
  shortcuts: EntityTable<ShortcutRecord, 'id'>;
  widgetLayouts: EntityTable<WidgetLayoutRecord, 'id'>;
  tabCollections: EntityTable<TabCollection, 'id'>;
  libraryItems: EntityTable<LibraryItem, 'id'>;
  libraryPages: EntityTable<LibraryPage, 'id'>;
  workspaceSpaces: EntityTable<WorkspaceSpace, 'id'>;
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
database
  .version(6)
  .stores({
    tabCollections: 'id, spaceId, order, updatedAt',
    workspaceSpaces: 'id, order',
  })
  .upgrade(async (tx) => {
    await tx
      .table('workspaceSpaces')
      .put({ id: 'default', name: '个人空间', order: 0 });
    await tx
      .table('tabCollections')
      .toCollection()
      .modify({ spaceId: 'default' });
  });

database.version(8).stores({
  preferences: 'id',
  syncOutbox: 'id,createdAt',
  syncShadow: 'id',
  syncMeta: 'id',
  syncConflicts: 'id,createdAt',
});
installSyncCapture(database, !!activeAccountKey());
database.version(9).stores({ syncAssets: 'id' });

database
  .version(7)
  .stores({
    libraryItems: 'id, pageId, parent, order, updatedAt',
    libraryPages: 'id, order',
  })
  .upgrade(async (tx) => {
    await tx
      .table('libraryPages')
      .put({ id: 'default', name: '常用收藏', order: 0 });
    await tx.table('libraryItems').toCollection().modify({ pageId: 'default' });
  });
