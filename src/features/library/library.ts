import { truncateLinkTitle } from './link-title';
import { normalizeSize } from './grid-layout';
export { normalizeSize } from './grid-layout';
import { database, type LibraryItem } from '../../shared/storage/database';
import { webUrl } from '../workspace/collections';

export type LibraryDraft = Pick<
  LibraryItem,
  | 'kind'
  | 'name'
  | 'url'
  | 'icon'
  | 'parent'
  | 'pageId'
  | 'gridX'
  | 'gridY'
  | 'width'
  | 'height'
>;
export async function saveLibraryItem(draft: LibraryDraft, id?: string) {
  let name = draft.name.trim().slice(0, 80);
  if (!name && draft.kind === 'link' && webUrl(draft.url.trim())) {
    name = new URL(draft.url.trim()).hostname;
    try {
      const response = await fetch(draft.url.trim(), {
        credentials: 'omit',
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        const html = (await response.text()).slice(0, 300000);
        name =
          new DOMParser()
            .parseFromString(html, 'text/html')
            .title.trim()
            .slice(0, 80) || name;
      }
    } catch {
      /* Cross-origin pages may prohibit title lookup; keep the hostname. */
    }
  }
  if (draft.kind === 'link') name = truncateLinkTitle(name);
  if (!name) throw new Error('请输入名称');
  const url = draft.kind === 'link' ? webUrl(draft.url.trim()) : '';
  if (url === null) throw new Error('请输入完整的 http:// 或 https:// 网址');
  const icon = draft.icon.trim();
  if (icon && !webUrl(icon) && !icon.startsWith('duoyu-icon:'))
    throw new Error('图标地址须为 http:// 或 https:// 网址');
  await database.transaction('rw', database.libraryItems, async () => {
    const previous = id ? await database.libraryItems.get(id) : undefined;
    if (id && !previous) throw new Error('该收藏已被删除');
    if (draft.parent) {
      const folder = await database.libraryItems.get(draft.parent);
      if (
        draft.kind === 'folder' ||
        folder?.kind !== 'folder' ||
        (folder.pageId || 'default') !== (draft.pageId || 'default')
      )
        throw new Error('请选择有效的文件夹');
    }
    const all = await database.libraryItems.toArray();
    const order =
      previous?.parent === draft.parent
        ? previous.order
        : Math.max(
            -1,
            ...all.filter((i) => i.parent === draft.parent).map((i) => i.order),
          ) + 1;
    await database.libraryItems.put({
      ...previous,
      ...draft,
      pageId: draft.pageId || previous?.pageId || 'default',
      id: id || crypto.randomUUID(),
      name,
      url: url || '',
      icon,
      order,
      updatedAt: Date.now(),
    });
  });
}
export async function moveLibraryItem(
  id: string,
  parent: string,
  before?: string,
) {
  if (id === before) return;
  await database.transaction('rw', database.libraryItems, async () => {
    const item = await database.libraryItems.get(id);
    if (!item) return;
    if (parent) {
      const folder = await database.libraryItems.get(parent);
      if (
        item.kind !== 'link' ||
        folder?.kind !== 'folder' ||
        (folder.pageId || 'default') !== (item.pageId || 'default')
      )
        throw new Error('文件夹暂不支持嵌套');
    }
    const siblings = (
      await database.libraryItems.where('parent').equals(parent).sortBy('order')
    ).filter(
      (i) =>
        i.id !== id && (i.pageId || 'default') === (item.pageId || 'default'),
    );
    const index = siblings.findIndex((i) => i.id === before);
    siblings.splice(index < 0 ? siblings.length : index, 0, {
      ...item,
      parent,
    });
    await database.libraryItems.bulkPut(
      siblings.map((entry, order) => ({
        ...entry,
        gridX: undefined,
        gridY: undefined,
        order,
        updatedAt: Date.now(),
      })),
    );
  });
}
export async function deleteLibraryItem(id: string) {
  await database.transaction('rw', database.libraryItems, async () => {
    const item = await database.libraryItems.get(id);
    if (!item) return;
    // Removing a folder keeps its links by moving them back to the root.
    if (item.kind === 'folder') {
      const root = await database.libraryItems
        .where('parent')
        .equals('')
        .toArray();
      const children = await database.libraryItems
        .where('parent')
        .equals(id)
        .sortBy('order');
      const start = Math.max(-1, ...root.map((i) => i.order)) + 1;
      await database.libraryItems.bulkPut(
        children.map((entry, index) => ({
          ...entry,
          parent: '',
          order: start + index,
          updatedAt: Date.now(),
        })),
      );
    }
    await database.libraryItems.delete(id);
  });
}

export async function resizeLibraryItem(
  id: string,
  width: number,
  height: number,
) {
  await database.transaction('rw', database.libraryItems, async () => {
    const item = await database.libraryItems.get(id);
    if (item)
      await database.libraryItems.update(id, {
        ...normalizeSize(width, height, item.kind),
        updatedAt: Date.now(),
      });
  });
}
export async function mergeLibraryLinks(sourceId: string, targetId: string) {
  if (sourceId === targetId) return;
  await database.transaction('rw', database.libraryItems, async () => {
    const source = await database.libraryItems.get(sourceId),
      target = await database.libraryItems.get(targetId);
    if (
      !source ||
      !target ||
      source.kind !== 'link' ||
      target.kind !== 'link' ||
      source.pageId !== target.pageId ||
      source.parent !== target.parent
    )
      return;
    if (source.parent) return; // No nested folders.
    const id = crypto.randomUUID();
    await database.libraryItems.add({
      id,
      kind: 'folder',
      name: '新文件夹',
      pageId: target.pageId,
      parent: '',
      url: '',
      icon: '',
      order: target.order,
      updatedAt: Date.now(),
      width: 3,
      height: 1,
    });
    await database.libraryItems.update(targetId, { parent: id, order: 0 });
    await database.libraryItems.update(sourceId, { parent: id, order: 1 });
  });
}
export async function seedLibraryDemo() {
  if (database.name !== 'duoyu') return;
  await database.transaction(
    'rw',
    database.libraryItems,
    database.libraryPages,
    database.widgetLayouts,
    async () => {
      if (await database.widgetLayouts.get('library-demo-v1')) return;
      const pageId = 'library-demo';
      const pages = await database.libraryPages.toArray();
      await database.libraryPages.put({
        id: pageId,
        name: '体验桌面',
        order: Math.max(-1, ...pages.map((p) => p.order)) + 1,
      });
      const base = {
        pageId,
        parent: '',
        url: '',
        icon: '',
        updatedAt: Date.now(),
      };
      await database.libraryItems.bulkPut([
        {
          ...base,
          id: 'demo-calendar',
          kind: 'widget',
          widget: 'calendar',
          name: '日历',
          order: 0,
          width: 3,
          height: 2,
        },
        {
          ...base,
          id: 'demo-folder',
          kind: 'folder',
          name: '常用网站',
          order: 1,
          width: 3,
          height: 1,
        },
        {
          ...base,
          id: 'demo-weather',
          kind: 'widget',
          widget: 'weather',
          name: '天气',
          order: 2,
          width: 3,
          height: 1,
        },
        {
          ...base,
          id: 'demo-note',
          kind: 'widget',
          widget: 'note',
          name: '便签',
          text: '在这里记下今天的灵感。',
          order: 3,
          width: 3,
          height: 2,
        },
        ...[
          ['ChatGPT', 'https://chatgpt.com/', '/images/widgets/chatgpt.svg'],
          [
            'DeepSeek',
            'https://chat.deepseek.com/',
            '/images/shortcuts/deepseek.png',
          ],
          ['GitHub', 'https://github.com/', '/images/github.png'],
          [
            '哔哩哔哩',
            'https://www.bilibili.com/',
            '/images/shortcuts/bilibili.png',
          ],
          ['少数派', 'https://sspai.com/', '/images/shortcuts/sspai.ico'],
          [
            '微信读书',
            'https://weread.qq.com/',
            '/images/shortcuts/weread.png',
          ],
          [
            '百度翻译',
            'https://fanyi.baidu.com/',
            '/images/shortcuts/translate.png',
          ],
          ['多鱼', 'https://lumehub.duoyu.link/', '/images/duoyu.png'],
          ['网易邮箱', 'https://mail.163.com/', '/images/shortcuts/mail.ico'],
          ['Claude', 'https://claude.ai/', '/images/widgets/claude.png'],
          [
            'DeepL',
            'https://www.deepl.com/translator',
            '/images/widgets/deepl.ico',
          ],
          ['音乐', 'https://music.163.com/', '/images/widgets/music.ico'],
        ].map(([name, url, icon], i) => ({
          ...base,
          id: `demo-link-${i}`,
          kind: 'link' as const,
          name: name!,
          url: url!,
          icon: icon!,
          parent: i < 10 ? 'demo-folder' : '',
          order: i < 10 ? i : i + 4,
        })),
      ]);
      await database.widgetLayouts.put({ id: 'library-demo-v1', groups: [] });
    },
  );
}
