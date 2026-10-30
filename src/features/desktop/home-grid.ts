import { database, type LibraryItem } from '../../shared/storage/database';
import { activeAccountKey } from '../../shared/storage/account';
import { WIDGET_GROUPS } from './widget-links';
import { DESKTOP_GRID_COLUMNS, HOME_GRID_ROWS } from '../library/grid-config';

/** Copy existing home groups once; all pages subsequently share LibraryGrid storage. */
export async function ensureHomeGrid() {
  if (activeAccountKey()) return;
  await database.transaction(
    'rw',
    database.libraryItems,
    database.widgetLayouts,
    async () => {
      if (await database.widgetLayouts.get('home-grid-v1')) return;
      if (
        !(await database.libraryItems.where('pageId').equals('home').count())
      ) {
        const saved = await database.widgetLayouts.get('categories');
        const all = new Map(
          WIDGET_GROUPS.flatMap((g) => g.links).map((link) => [link.id, link]),
        );
        const used = new Set<string>();
        const groups = WIDGET_GROUPS.map((g) => ({
          ...g,
          links: saved
            ? (saved.groups.find((s) => s.id === g.id)?.linkIds || []).flatMap(
                (id) => {
                  const link = all.get(id);
                  if (!link || used.has(id)) return [];
                  used.add(id);
                  return [link];
                },
              )
            : [...g.links],
        }));
        if (saved)
          for (const group of WIDGET_GROUPS)
            for (const link of group.links)
              if (!used.has(link.id))
                groups.find((g) => g.id === group.id)!.links.push(link);
        const items: LibraryItem[] = [];
        groups.forEach((group, index) => {
          const id = `home-${group.id}`;
          items.push({
            id,
            pageId: 'home',
            kind: 'folder',
            name: group.title,
            parent: '',
            url: '',
            icon: '',
            order: index,
            width: 4,
            height: 2,
            gridX:
              Math.floor((DESKTOP_GRID_COLUMNS - groups.length * 4) / 2) +
              index * 4,
            gridY: HOME_GRID_ROWS - 2,
            updatedAt: Date.now(),
          });
          group.links.forEach((link, order) =>
            items.push({
              ...link,
              id: `home-${link.id}`,
              pageId: 'home',
              kind: 'link',
              parent: id,
              order,
              updatedAt: Date.now(),
            }),
          );
        });
        await database.libraryItems.bulkPut(items);
      }
      await database.widgetLayouts.put({ id: 'home-grid-v1', groups: [] });
    },
  );
}
