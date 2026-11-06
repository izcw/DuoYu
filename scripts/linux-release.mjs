// Isolated Linux verification. No production volumes, credentials or ports are used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  copyFile,
  readdir,
  writeFile,
  readFile,
} from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
assert.ok(process.env.GO_BINARY, 'Set GO_BINARY to the local Go compiler');
assert.equal(
  JSON.parse(await readFile('package.json', 'utf8')).name,
  'duoyu-extension',
);
const root = await mkdtemp(path.resolve('work/linux-release-'));
const backend = path.resolve('../DuoYu-Backend');
const identity = path.resolve('../DuoYu-ID');
const label = randomBytes(8).toString('hex');
const container = 'duoyu-review-pg-' + label;
const stages = [];
const nodeImage =
  'node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c';
async function run(name, file, args, options = {}) {
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', (error) => {
      output += error.message;
    });
    child.on('close', (code) => resolve({ code, output }));
  });
  await writeFile(path.join(root, name + '.log'), result.output);
  stages.push({ name, code: result.code, elapsedMs: Date.now() - started });
  console.log(name, result.code === 0 ? 'PASS' : 'FAIL');
  if (result.code !== 0)
    throw Error(name + ' failed; see ' + path.join(root, name + '.log'));
  return result.output;
}
async function copyScripts(source, target) {
  await mkdir(target, { recursive: true });
  for (const name of await readdir(source)) {
    if (name.endsWith('.mjs'))
      await copyFile(path.join(source, name), path.join(target, name));
  }
}
await mkdir(path.join(root, 'backend'));
await mkdir(path.join(root, 'id'));
await mkdir(path.join(root, 'sync'));
await copyScripts(
  path.join(backend, 'server/sync/src'),
  path.join(root, 'sync/src'),
);
await copyScripts(
  path.join(backend, 'server/sync/test'),
  path.join(root, 'sync/test'),
);
for (const name of ['schema.sql', 'package.json', 'package-lock.json'])
  await copyFile(
    path.join(backend, 'server/sync', name),
    path.join(root, 'sync', name),
  );
await copyFile(
  path.join(backend, 'server/backend/schema.sql'),
  path.join(root, 'backend/schema.sql'),
);
await copyFile(
  'scripts/fixtures/linux-process-smoke.mjs',
  path.join(root, 'process-smoke.mjs'),
);
const goEnv = {
  ...process.env,
  GOOS: 'linux',
  GOARCH: 'amd64',
  CGO_ENABLED: '0',
};
const dockerArgs = [
  'run',
  '--rm',
  '--label',
  'duoyu.review=' + label,
  '--network',
  'container:' + container,
  '--mount',
  'type=bind,source=' + root + ',target=/review',
  '--memory',
  '2g',
  '--cpus',
  '2',
];
const dsn =
  'postgres://duoyu:duoyu_dev_only@127.0.0.1:55432/duoyu_sync_test?sslmode=disable';
let created = false,
  passed = false,
  cleaned = false;
try {
  await run('loopback-certificate', process.env.GO_BINARY, [
    'run',
    path.resolve('scripts/fixtures/local-tls.go'),
    root,
  ]);
  await run(
    'backend-linux-test-build',
    process.env.GO_BINARY,
    ['test', '-c', '-o', path.join(root, 'backend/backend.test'), '.'],
    { cwd: path.join(backend, 'server/backend'), env: goEnv },
  );
  await run(
    'identity-linux-test-build',
    process.env.GO_BINARY,
    ['test', '-c', '-o', path.join(root, 'id/identity.test'), './server'],
    { cwd: identity, env: goEnv },
  );
  await run(
    'rotation-linux-test-build',
    process.env.GO_BINARY,
    [
      'test',
      '-c',
      '-o',
      path.join(root, 'id/rotation.test'),
      './cmd/rotate-key',
    ],
    { cwd: identity, env: goEnv },
  );
  await run(
    'backend-linux-build',
    process.env.GO_BINARY,
    ['build', '-trimpath', '-o', path.join(root, 'backend/duoyu-backend'), '.'],
    { cwd: path.join(backend, 'server/backend'), env: goEnv },
  );
  await run(
    'identity-linux-build',
    process.env.GO_BINARY,
    ['build', '-trimpath', '-o', path.join(root, 'id/duoyu-id'), './server'],
    { cwd: identity, env: goEnv },
  );
  await run('postgres-start', 'docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    container,
    '--label',
    'duoyu.review=' + label,
    '-e',
    'POSTGRES_USER=duoyu',
    '-e',
    'POSTGRES_PASSWORD=duoyu_dev_only',
    '-e',
    'POSTGRES_DB=duoyu_sync_test',
    'postgres:17',
    '-p',
    '55432',
  ]);
  created = true;
  await run('postgres-ready', 'docker', [
    'exec',
    container,
    'sh',
    '-c',
    'for i in $(seq 1 60); do pg_isready -h 127.0.0.1 -p 55432 -U duoyu && exit 0; sleep 1; done; exit 1',
  ]);
  await run('image-metadata', 'docker', [
    'image',
    'inspect',
    nodeImage,
    'postgres:17',
    '--format',
    '{{json .RepoDigests}}',
  ]);
  await run('linux-runtime', 'docker', [
    ...dockerArgs,
    nodeImage,
    'node',
    '-p',
    'JSON.stringify({platform:process.platform,arch:process.arch,node:process.version})',
  ]);
  await run('node-install', 'docker', [
    ...dockerArgs,
    '-w',
    '/review/sync',
    'node:24-bookworm-slim',
    'npm',
    'ci',
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
  ]);
  await run('node-linux-tests', 'docker', [
    ...dockerArgs,
    '-w',
    '/review/sync',
    '-e',
    'DUOYU_RESTORE_TEST_DATABASE_URL=' + dsn,
    'node:24-bookworm-slim',
    'npm',
    'test',
  ]);
  await run('backend-linux-tests', 'docker', [
    ...dockerArgs,
    '-w',
    '/review/backend',
    '-e',
    'BACKEND_TEST_DATABASE_URL=' + dsn,
    'node:24-bookworm-slim',
    './backend.test',
    '-test.v',
    '-test.timeout=3m',
  ]);
  await run('identity-linux-tests', 'docker', [
    ...dockerArgs,
    '-w',
    '/review/id',
    '-e',
    'DUOYU_TEST_DATABASE_URL=' + dsn,
    'node:24-bookworm-slim',
    './identity.test',
    '-test.v',
    '-test.timeout=3m',
  ]);
  await run('rotation-linux-tests', 'docker', [
    ...dockerArgs,
    '-w',
    '/review/id',
    'node:24-bookworm-slim',
    './rotation.test',
    '-test.v',
  ]);
  await run('linux-process-smoke', 'docker', [
    ...dockerArgs,
    '-e',
    'DUOYU_LINUX_FIXTURE=isolated',
    nodeImage,
    'node',
    '/review/process-smoke.mjs',
  ]);
  const hashes = {};
  for (const file of ['backend/duoyu-backend', 'id/duoyu-id'])
    hashes[file] = createHash('sha256')
      .update(await readFile(path.join(root, file)))
      .digest('hex');
  await writeFile(
    path.join(root, 'sha256.json'),
    JSON.stringify(hashes, null, 2),
  );
  passed = true;
} finally {
  if (created) {
    const actual = (
      await run('verify-container-owner', 'docker', [
        'inspect',
        '--format',
        '{{ index .Config.Labels "duoyu.review" }}',
        container,
      ])
    ).trim();
    assert.equal(
      actual,
      label,
      'Refuse to remove a container not created by this run',
    );
    await run('postgres-cleanup', 'docker', ['stop', '-t', '10', container]);
    cleaned = true;
  }
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify(
      { passed, cleaned, label, stages, smtpSent: false },
      null,
      2,
    ),
  );
  console.log('Evidence:', root);
}
