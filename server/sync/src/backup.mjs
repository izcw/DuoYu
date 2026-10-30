import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
const dir = '/www/backup/duoyu-sync',
  keyPath = '/www/server/duoyu-sync-backup.key';
const key = await readFile(keyPath);
if (key.length !== 32) throw Error('Invalid backup key');
if (process.argv[2] === '--verify') {
  const file = process.argv[3];
  if (!file?.startsWith(dir + '/sync-') || !file.endsWith('.enc'))
    throw Error('Invalid backup path');
  const bytes = await readFile(file);
  if (bytes.subarray(0, 4).toString() !== 'DYS1') throw Error('Invalid backup');
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16));
  cipher.setAuthTag(bytes.subarray(-16));
  cipher.update(bytes.subarray(16, -16));
  cipher.final();
  console.log('Encrypted backup integrity verified');
  process.exit(0);
}
await mkdir(dir, { recursive: true, mode: 0o700 });
const file =
  dir + '/sync-' + new Date().toISOString().replaceAll(':', '-') + '.dump.enc';
const nonce = randomBytes(12),
  cipher = createCipheriv('aes-256-gcm', key, nonce);
const output = createWriteStream(file, { flags: 'wx', mode: 0o600 });
output.write(Buffer.concat([Buffer.from('DYS1'), nonce]));
const child = spawn(
  'runuser',
  [
    '-u',
    'postgres',
    '--',
    '/www/server/pgsql/bin/pg_dump',
    '-Fc',
    'duoyu_extensions',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
child.stderr.resume();
const completed = new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(Error('Database dump failed')),
  );
});
try {
  await Promise.all([pipeline(child.stdout, cipher, output), completed]);
  await writeFile(file, cipher.getAuthTag(), { flag: 'a', mode: 0o600 });
  console.log(file);
  for (const entry of await readdir(dir))
    if (/^sync-[\dT.Z-]+\.dump\.enc$/.test(entry)) {
      const path = dir + '/' + entry;
      if ((await stat(path)).mtimeMs < Date.now() - 14 * 86400000)
        await unlink(path);
    }
} catch (e) {
  child.kill();
  await unlink(file).catch(() => {});
  throw e;
}
