export interface WidgetLink {
  id: string;
  name: string;
  url: string;
  icon: string;
}
export const WIDGET_GROUPS = [
  {
    id: 'widget-1',
    title: 'AI 助手',
    links: [
      {
        id: 'chatgpt',
        name: 'ChatGPT',
        url: 'https://chatgpt.com/',
        icon: '/images/widgets/chatgpt.svg',
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        url: 'https://chat.deepseek.com/',
        icon: '/images/shortcuts/deepseek.png',
      },
      {
        id: 'claude',
        name: 'Claude',
        url: 'https://claude.ai/',
        icon: '/images/widgets/claude.png',
      },
    ],
  },
  {
    id: 'widget-2',
    title: '休闲娱乐',
    links: [
      {
        id: 'bilibili',
        name: '哔哩哔哩',
        url: 'https://www.bilibili.com/',
        icon: '/images/shortcuts/bilibili.png',
      },
      {
        id: 'xiaohongshu',
        name: '小红书',
        url: 'https://www.xiaohongshu.com/',
        icon: '/images/shortcuts/xiaohongshu.png',
      },
      {
        id: 'music',
        name: '网易云音乐',
        url: 'https://music.163.com/',
        icon: '/images/widgets/music.ico',
      },
    ],
  },
  {
    id: 'widget-3',
    title: '常用工具',
    links: [
      {
        id: 'github',
        name: 'GitHub',
        url: 'https://github.com/',
        icon: '/images/github.png',
      },
      {
        id: 'deepl',
        name: 'DeepL 翻译',
        url: 'https://www.deepl.com/translator',
        icon: '/images/widgets/deepl.ico',
      },
      {
        id: 'mail',
        name: '网易邮箱',
        url: 'https://mail.163.com/',
        icon: '/images/shortcuts/mail.ico',
      },
    ],
  },
] satisfies { id: string; title: string; links: WidgetLink[] }[];
