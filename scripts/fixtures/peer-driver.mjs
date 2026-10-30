import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export async function startPeer(context) {
  const child = fork('scripts/fixtures/cloud-peer.mjs', [], {
    env: { ...process.env, DUOYU_SYNC_TEST_CONTEXT: JSON.stringify(context) },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const pending = new Map();
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors += chunk.toString();
  });
  child.on('message', (message) => {
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    message.error ? task.reject(Error(message.error)) : task.resolve(message);
  });
  child.on('exit', (code) => {
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(Error('Peer exited ' + code + ': ' + errors));
    }
    pending.clear();
  });
  function wait(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Peer timeout: ' + errors));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
    });
  }
  const ready = await wait('ready');
  return {
    ready,
    async call(action, extra = {}) {
      const id = randomUUID(),
        result = wait(id);
      child.send({ id, action, ...extra });
      return result;
    },
    async close() {
      if (child.connected) await this.call('stop').catch(() => {});
      child.kill();
    },
  };
}
