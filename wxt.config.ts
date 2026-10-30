import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue'],
  manifest: () => {
    const issuer = new URL(process.env.VITE_AUTH_ISSUER || '');
    if (
      !['http:', 'https:'].includes(issuer.protocol) ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    ) {
      throw new Error('请在 .env 中配置有效的 VITE_AUTH_ISSUER');
    }
    if (!process.env.VITE_AUTH_CLIENT_ID || !process.env.VITE_AUTH_SCOPE) {
      throw new Error(
        '请在 .env 中配置 VITE_AUTH_CLIENT_ID 和 VITE_AUTH_SCOPE',
      );
    }
    return {
      name: '多鱼 · 新标签页',
      description: '让搜索更便捷，让收藏更有序。',
      host_permissions: ['http://*/*', 'https://*/*'],
      permissions: ['storage', 'tabs', 'tabGroups', 'favicon', 'identity'],
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
    };
  },
});
