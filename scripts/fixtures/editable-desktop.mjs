import { createHash } from 'node:crypto';
import { readDataModule } from './data-module.mjs';
const { WIDGET_GROUPS } = await readDataModule(new URL('../../src/features/desktop/widget-links.ts', import.meta.url));

// UI-only tests edit a disposable account in a fresh browser profile. The
// real login, transport and server side are exercised by auth-isolated.mjs.
export async function prepareEditableDesktop(context) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = new URL(worker.url()).host;
  const account = { issuer: 'https://fixture.invalid', sub: 'desktop-ui', name: '桌面测试' };
  const owner = createHash('sha256').update(account.issuer + '\0' + account.sub).digest('hex');
  await context.addInitScript(({ origin, owner, account }) => {
    if (globalThis.chrome?.runtime?.id !== origin) return;
    localStorage.setItem('duoyu-sync-account', owner);
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...args) => {
      if (message?.type === 'duoyu-auth' && message.action === 'status')
        return Promise.resolve({ view: { account } });
      if (message?.type === 'duoyu-auth' && message.action === 'sync')
        return Promise.resolve({ status: 503, error: 'Offline UI fixture' });
      return send(message, ...args);
    };
  }, { origin, owner, account });
  const page = await context.newPage();
  try {
    await page.goto('chrome-extension://' + origin + '/newtab.html');
    await page.locator('.clock-time').waitFor();
    await page.evaluate(async ({ owner, groups }) => {
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open('duoyu-account-' + owner);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        const tx = db.transaction(['libraryPages', 'libraryItems', 'workspaceSpaces'], 'readwrite');
        const done = new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
        });
        tx.objectStore('workspaceSpaces').put({ id: 'default', name: '个人空间', order: 0 });
        tx.objectStore('libraryPages').put({ id: 'default', name: '常用收藏', order: 0 });
        tx.objectStore('libraryPages').put({ id: 'library-demo', name: '体验桌面', order: 1 });
        const rows = tx.objectStore('libraryItems');
        const put = row => rows.put({ url: '', icon: '', parent: '', updatedAt: 1, ...row });
        for (const [order, group] of groups.entries()) {
          const id = 'home-' + group.id;
          put({ id, pageId: 'home', kind: 'folder', name: group.title, order,
            gridX: 2 + order * 4, gridY: 3, width: 4, height: 2 });
          for (const [order, link] of group.links.entries())
            put({ ...link, id: 'home-' + link.id, pageId: 'home', kind: 'link', parent: id, order });
        }
        const pageId = 'library-demo';
        for (const [order, [key, name, height]] of [
          ['calendar', '日历', 2], ['folder', '常用网站', 1], ['weather', '天气', 1], ['note', '便签', 2],
        ].entries())
          put({ id: 'demo-' + key, pageId, order, name, width: 3, height,
            ...(key === 'folder' ? { kind: 'folder' } : { kind: 'widget', widget: key }) });
        const links = [...groups.flatMap(group => group.links), ...['多鱼', '站点 A', '站点 B'].map((name, i) =>
          ({ name, url: 'https://example.invalid/' + i, icon: '' }))];
        for (const [i, link] of links.entries())
          put({ ...link, id: 'demo-link-' + i, pageId, kind: 'link',
            parent: i < 10 ? 'demo-folder' : '', order: i < 10 ? i : i + 4 });
        await done;
      } finally {
        db.close();
      }
    }, { owner, groups: WIDGET_GROUPS });
  } finally {
    await page.close();
  }
}
