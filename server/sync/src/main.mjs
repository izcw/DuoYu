import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { createAuthenticator, createSyncServer } from './http.mjs';
const pool = new Pool({
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
if (process.argv.includes('--migrate')) {
  await pool.query(
    await readFile(new URL('../schema.sql', import.meta.url), 'utf8'),
  );
  await pool.end();
  console.log('Migration complete');
  process.exit(0);
}
const issuer = process.env.DUOYU_ISSUER;
const clientId = process.env.DUOYU_CLIENT_ID;
if (!issuer?.startsWith('https://') || !clientId)
  throw Error('Configure DUOYU_ISSUER and DUOYU_CLIENT_ID');
const authenticate = await createAuthenticator({ issuer, clientId });
const origins = (process.env.SYNC_ORIGINS ?? '').split(',').filter(Boolean);
if (!origins.length) throw Error('Configure SYNC_ORIGINS');
const server = createSyncServer({ pool, authenticate, origins });
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(Number(process.env.PORT ?? 5260), '127.0.0.1', () =>
  console.log('DuoYu sync listening on loopback'),
);
async function close() {
  server.close();
  await pool.end();
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
