// Isolated browser-like client: separate IndexedDB, storage, locks and module state.
// Only the parent test's localhost server is allowed; never a production endpoint.
import 'fake-indexeddb/auto';
import { createHash, randomUUID } from 'node:crypto';
const state = JSON.parse(process.env.DUOYU_SYNC_TEST_CONTEXT);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(state.origin))
  throw Error('Local test server required');
globalThis.__syncTest = state;
const values = new Map([
  [
    'duoyu-sync-account',
    createHash('sha256')
      .update(state.account.issuer + '\0' + state.account.sub)
      .digest('hex'),
  ],
]);
globalThis.localStorage = {
  getItem: (k) => values.get(k) ?? null,
  setItem: (k, v) => values.set(k, v),
  removeItem: (k) => values.delete(k),
};
globalThis.window = new EventTarget();
globalThis.document = {
  documentElement: { dataset: {} },
  createElement: () => ({}),
};
globalThis.location = {
  reload() {
    throw Error('unexpected reload');
  },
};
if (!navigator.locks)
  Object.defineProperty(navigator, 'locks', {
    value: { request: async (_name, fn) => fn() },
  });
const { database } = await import('../../work/sync-integration/database.mjs');
let client = await import('../../work/sync-integration/client.mjs');
await client.initializeCloud();
process.send({ id: 'ready', state: client.syncState.value });
process.on('message', async (message) => {
  try {
    if (message.action === 'add') await database.libraryItems.put(message.item);
    if (message.action === 'sync') await client.syncNow();
    if (message.action === 'legacy') state.noResponse = true;
    if (message.action === 'offline') state.offline = true;
    if (message.action === 'online') state.offline = false;
    if (message.action === 'refresh') {
      client.stopCloud();
      state.noResponse = false;
      client = await import(
        '../../work/sync-integration/client.mjs?reload=' + randomUUID()
      );
      await client.initializeCloud();
    }
    if (message.action === 'stop') {
      client.stopCloud();
      database.close();
      process.send({ id: message.id, ok: true });
      process.exit(0);
    }
    process.send({
      id: message.id,
      state: client.syncState.value,
      items: await database.libraryItems.toArray(),
      pending: await database.syncOutbox.count(),
    });
  } catch (e) {
    process.send({ id: message.id, error: e.message });
  }
});
