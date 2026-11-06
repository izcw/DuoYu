// Runs only inside linux-release's disposable, unexposed PostgreSQL network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
assert.equal(process.platform, 'linux');
assert.equal(process.env.DUOYU_LINUX_FIXTURE, 'isolated');
const dsn =
  'postgres://duoyu:duoyu_dev_only@127.0.0.1:55432/duoyu_sync_test?sslmode=disable';
const issuer = 'https://localhost:5552';
const children = [],
  results = [];
let proxy;
function start(name, file, args, overrides = {}, cwd = '/review') {
  const child = spawn(file, args, {
    cwd,
    env: { ...process.env, DATABASE_URL: dsn, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { name, child, output: '', ended: false };
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      state.output += chunk;
    });
  state.done = new Promise((resolve) => {
    child.once('error', (error) => {
      state.output += error.message;
    });
    child.once('close', (code, signal) => {
      state.ended = true;
      resolve({ code, signal });
    });
  });
  children.push(state);
  return state;
}
async function completion(state, ms = 15000) {
  let timer;
  try {
    return await Promise.race([
      state.done,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(state.name + ' timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function ready(state, url) {
  let lastObservation = 'no response';
  for (let i = 0; i < 100; i++) {
    if (state.ended)
      throw Error(state.name + ' exited before readiness: ' + state.output);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      await response.arrayBuffer();
      if (response.ok) return;
      lastObservation = 'HTTP ' + response.status;
    } catch (error) {
      lastObservation = error.cause?.code ?? error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(state.name + ' never became healthy: ' + lastObservation +
    '; process output: ' + (state.output.trim() || '(empty)'));
}
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  }
}
const idEnv = {
  DUOYU_SECRET: '12'.repeat(32),
  DUOYU_ORIGIN: issuer,
  DUOYU_ADDR: '127.0.0.1:5551',
  DUOYU_ROLE: 'api',
  DUOYU_DATA_DIR: '/review/id/runtime',
};
const backendEnv = {
  SESSION_KEY: '34'.repeat(32),
  DUOYU_ISSUER: issuer,
  DUOYU_CLIENT_ID: 'process-smoke',
  ADMIN_CLIENT_ID: 'process-admin',
  SUPER_ADMIN_SUB: 'synthetic-admin',
  PUBLIC_ORIGIN: 'http://localhost:5553',
  LISTEN: '127.0.0.1:5553',
  SYNC_UPSTREAM: 'http://127.0.0.1:5554',
  ASSET_ROOT: '/review/backend/runtime/users',
  BACKUP_DIR: '/review/backend/runtime/backups',
  SSL_CERT_FILE: '/review/cert.pem',
};
try {
  proxy = createServer(
    {
      cert: await readFile('/review/cert.pem'),
      key: await readFile('/review/key.pem'),
    },
    (req, res) => {
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: 5551,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => {
        if (!res.writableFinished) upstream.destroy();
      });
      req.pipe(upstream);
    },
  );
  await new Promise((resolve) => proxy.listen(5552, resolve));
  const identity = start('identity', '/review/id/duoyu-id', [], idEnv);
  await ready(identity, 'http://127.0.0.1:5551/healthz');
  await check('invalid-role-exits-nonzero', async () => {
    const bad = start('invalid-role', '/review/id/duoyu-id', [], {
      ...idEnv,
      DUOYU_ROLE: 'invalid-fixture-role',
    });
    const result = await completion(bad);
    assert.match(bad.output, /invalid DUOYU_ROLE/);
    assert.equal(result.signal, null);
    assert.notEqual(
      result.code,
      0,
      'Invalid role was reported as successful exit',
    );
  });
  await check('occupied-port-exits-nonzero', async () => {
    const duplicate = start('occupied-port', '/review/id/duoyu-id', [], idEnv);
    const result = await completion(duplicate);
    assert.match(duplicate.output, /listen failed/);
    assert.equal(result.signal, null);
    assert.notEqual(
      result.code,
      0,
      'Listen failure was reported as successful exit',
    );
  });
  const pgEnv = {
    PGHOST: '127.0.0.1',
    PGPORT: '55432',
    PGUSER: 'duoyu',
    PGPASSWORD: 'duoyu_dev_only',
    PGDATABASE: 'duoyu_sync_test',
  };
  assert.equal(
    (
      await completion(
        start(
          'sync-migrate',
          process.execPath,
          ['src/main.mjs', '--migrate'],
          pgEnv,
          '/review/sync',
        ),
      )
    ).code,
    0,
  );
  assert.equal(
    (
      await completion(
        start(
          'backend-migrate',
          '/review/backend/duoyu-backend',
          ['migrate'],
          backendEnv,
          '/review/backend',
        ),
      )
    ).code,
    0,
  );
  const sync = start(
    'sync',
    process.execPath,
    ['src/main.mjs'],
    {
      ...pgEnv,
      DUOYU_ISSUER: issuer,
      DUOYU_CLIENT_ID: 'process-smoke',
      NODE_EXTRA_CA_CERTS: '/review/cert.pem',
      SYNC_ORIGINS: 'http://localhost:5553',
      PORT: '5554',
    },
    '/review/sync',
  );
  await ready(sync, 'http://127.0.0.1:5554/healthz');
  const backend = start(
    'backend',
    '/review/backend/duoyu-backend',
    [],
    backendEnv,
    '/review/backend',
  );
  await ready(backend, 'http://127.0.0.1:5553/healthz');
  for (const [state, port] of [
    [identity, 5551],
    [backend, 5553],
    [sync, 5554],
  ]) {
    await check(state.name + '-concurrent-health-and-SIGTERM', async () => {
      const durations = [];
      const began = performance.now();
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          for (let i = 0; i < 25; i++) {
            const started = performance.now();
            const response = await fetch(
              'http://127.0.0.1:' + port + '/healthz',
              { signal: AbortSignal.timeout(3000) },
            );
            assert.equal(response.status, 200);
            await response.json();
            durations.push(performance.now() - started);
          }
        }),
      );
      durations.sort((a, b) => a - b);
      await writeFile(
        '/review/' + state.name + '-health-metrics.json',
        JSON.stringify(
          {
            requests: durations.length,
            concurrency: 8,
            elapsedMs: performance.now() - began,
            p50Ms: durations[99],
            p95Ms: durations[189],
            maxMs: durations.at(-1),
            scope:
              'Health endpoint plus real database connectivity; not authenticated workload capacity',
          },
          null,
          2,
        ),
      );
      assert.equal(state.child.kill('SIGTERM'), true);
      assert.deepEqual(await completion(state), { code: 0, signal: null });
    });
  }
} finally {
  for (const state of children) {
    if (!state.ended) {
      state.child.kill('SIGKILL');
      await state.done;
    }
    await writeFile('/review/process-' + state.name + '.log', state.output);
  }
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  await writeFile(
    '/review/process-results.json',
    JSON.stringify({ results, smtpSent: false }, null, 2),
  );
}
assert.equal(results.length, 5);
assert.ok(
  results.every((result) => result.passed),
  JSON.stringify(results),
);
console.log(
  'PASS actual Linux entrypoints, discovery, migrations, 600 health requests and SIGTERM; no SMTP',
);
