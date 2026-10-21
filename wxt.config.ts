import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: '多鱼 · 新标签页',
    description: '让搜索更便捷，让收藏更有序。',
    host_permissions: [
      'https://api.bing.com/*',
      'https://api.bimg.cc/*',
      'https://bing.com/*',
    ],
    permissions: ['storage', 'tabs', 'favicon'],
    action: {
      default_title: '多鱼',
      default_state: 'enabled',
      default_icon: {
        16: '/icons/16.png',
        32: '/icons/32.png',
        48: '/icons/48.png',
      },
    },
    icons: {
      16: '/icons/16.png',
      32: '/icons/32.png',
      48: '/icons/48.png',
      128: '/icons/128.png',
    },
  },
});
