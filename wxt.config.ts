import { defineConfig } from 'wxt';
import { createPublicKey } from 'node:crypto';
import distributionIdentity from './extension-identity.json';

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
    // Unpacked releases have a persistent identity. Store builds can supply
    // their own public manifest key when the store assigns one.
    const extensionKey = (
      process.env.VITE_EXTENSION_PUBLIC_KEY?.trim() || distributionIdentity.key
    ).replace(/\s/g, '');
    try {
      const bytes = Buffer.from(extensionKey, 'base64');
      const key = createPublicKey({
        key: bytes,
        format: 'der',
        type: 'spki',
      });
      if (
        key.asymmetricKeyType !== 'rsa' ||
        bytes.toString('base64') !== extensionKey ||
        !key.export({ format: 'der', type: 'spki' }).equals(bytes)
      )
        throw new Error('Invalid public key');
    } catch {
      throw new Error(
        '扩展身份必须为 Base64 RSA 公钥，请检查 extension-identity.json 或 VITE_EXTENSION_PUBLIC_KEY',
      );
    }
    return {
      key: extensionKey,
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
