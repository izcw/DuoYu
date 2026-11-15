import type { ShortcutItem } from '../../shared/storage/database';
export const dockPages = ['duoyu-home', 'duoyu-workspace', 'duoyu-canvas', 'duoyu-memo'] as const;
export type DockPage = (typeof dockPages)[number];

export function isDockPage(id: string): id is DockPage {
  return dockPages.some((page) => page === id);
}

export const shortcutActions: ShortcutItem[] = [
  { id: 'duoyu-canvas', name: '画布', icon: '/images/shortcuts/canvas.png' },
  { id: 'duoyu-memo', name: '便签', icon: '/images/shortcuts/memo.png' },
  {
    id: 'duoyu-translate',
    name: '翻译',
    icon: '/images/shortcuts/translate.png',
    url: 'https://fanyi.baidu.com/',
  },
  {
    id: 'duoyu-workspace',
    name: '标签工作区',
    icon: '/images/shortcuts/label.png',
  },
];
