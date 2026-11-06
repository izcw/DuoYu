// Real PostgreSQL dumps restored into disposable databases; no production access.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  readdir,
  stat,
} from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  createSnapshot,
  restoreSnapshot,
} from '../../DuoYu-Backend/server/sync/src/snapshot-backup.mjs';

assert.equal(
  process.platform,
  'win32',
  'The ID operational scripts require PowerShell',
);
assert.ok(process.env.GO_BINARY, 'Set GO_BINARY to the Go compiler');
const root = await mkdtemp(path.resolve('work/restore-drill-'));
const identity = path.resolve('../DuoYu-ID');
const backend = path.resolve('../DuoYu-Backend/server');
const label = randomBytes(8).toString('hex');
const pg = 'duoyu-restore-pg-' + label;
const app = 'duoyu-restore-id-' + label;
const pgImage =
  'postgres@sha256:3b0cda93be7c8dba2ed484d19393d93845dc3dafb88973e248ba8e6d99d784e1';
const nodeImage =
  'node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c';
const stages = [],
  checks = [],
  measurements = [];
const started = Date.now();
const powershell = process.env.POWERSHELL_BINARY || 'pwsh.exe';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let passed = false,
  cleaned = false;
async function run(
  name,
  file,
  args,
  { input, expectFailure = false, ...options } = {},
) {
  const begin = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    let output = '';
    child.stdout.on('data', (b) => {
      output += b;
    });
    child.stderr.on('data', (b) => {
      output += b;
    });
    child.on('error', (e) => {
      output += e.message;
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', (code) => resolve({ code, output }));
  });
  await writeFile(path.join(root, name + '.log'), result.output);
  const ok = expectFailure ? result.code !== 0 : result.code === 0;
  stages.push({
    name,
    code: result.code,
    expectedFailure: expectFailure,
    passed: ok,
    elapsedMs: Date.now() - begin,
  });
  if (!ok) throw Error(name + ' failed; see ' + path.join(root, name + '.log'));
  return result.output;
}
const docker = (name, args, options) => run(name, 'docker', args, options);
const sql = (name, db, query) =>
  docker(
    name,
    [
      'exec',
      '-i',
      pg,
      'psql',
      '-X',
      '-qAt',
      '-U',
      'duoyu',
      '-d',
      db,
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query },
  );
async function check(name, fn) {
  const begin = Date.now();
  try {
    await fn();
    checks.push({ name, passed: true, elapsedMs: Date.now() - begin });
    console.log('PASS', name);
  } catch (e) {
    checks.push({ name, passed: false, error: e.message });
    throw e;
  }
}
async function contents(db, prefix) {
  const names = JSON.parse(
    (
      await sql(
        prefix + '-tables',
        db,
        "SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public';",
      )
    ).trim(),
  );
  const data = {};
  for (const name of names) {
    assert.match(name, /^[a-z_0-9]+$/);
    const result = await sql(
      prefix + '-' + name,
      db,
      `SELECT json_build_object('count',count(*),'digest',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''))) FROM "${name}" t;`,
    );
    data[name] = JSON.parse(result.trim());
  }
  const sequences = JSON.parse(
    (
      await sql(
        prefix + '-sequences',
        db,
        "SELECT coalesce(json_agg(json_build_object('name',sequencename,'value',last_value) ORDER BY sequencename),'[]') FROM pg_sequences WHERE schemaname='public';",
      )
    ).trim(),
  );
  const policies = JSON.parse(
    (
      await sql(
        prefix + '-policies',
        db,
        "SELECT coalesce(json_agg(to_jsonb(p) ORDER BY tablename,policyname),'[]') FROM pg_policies p WHERE schemaname='public';",
      )
    ).trim(),
  );
  return { data, sequences, policies };
}
async function tree(dir) {
  const result = {};
  async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name,
        file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file, relative + '/');
      else {
        assert.ok(entry.isFile());
        result[relative] = sha(await readFile(file));
      }
    }
  }
  await walk(dir);
  return result;
}
async function stopOwned(name) {
  const metadata = await docker('inspect-' + name, [
    'inspect',
    name,
    '--format',
    '{{json .Config.Labels}}',
  ]);
  assert.equal(JSON.parse(metadata)['duoyu.restore'], label);
  await docker('stop-' + name, ['stop', '-t', '30', name]);
}
async function startID(db, data) {
  await docker('start-' + db, [
    'run',
    '--rm',
    '-d',
    '--name',
    app,
    '--label',
    'duoyu.restore=' + label,
    '--network',
    'container:' + pg,
    '--mount',
    'type=bind,source=' + root + ',target=/review',
    '--memory',
    '512m',
    '--cpus',
    '1',
    '-e',
    'DATABASE_URL=postgres://duoyu:duoyu_dev_only@127.0.0.1:5432/' +
      db +
      '?sslmode=disable',
    '-e',
    'DUOYU_SECRET=' + '12'.repeat(32),
    '-e',
    'DUOYU_ROLE=api',
    '-e',
    'DUOYU_ORIGIN=https://restore.invalid',
    '-e',
    'DUOYU_ADDR=127.0.0.1:5551',
    '-e',
    'DUOYU_DATA_DIR=/review/' + data,
    '--entrypoint',
    '/review/duoyu-id',
    nodeImage,
  ]);
  appRunning = true;
  const probe = `for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:5551/healthz');if(r.ok)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,100))}process.exit(1)`;
  await docker('ready-' + db, [
    'exec',
    app,
    'node',
    '--input-type=module',
    '-e',
    probe,
  ]);
  const jwks = await docker('jwks-' + db, [
    'exec',
    app,
    'node',
    '--input-type=module',
    '-e',
    "const d=await(await fetch('http://127.0.0.1:5551/.well-known/openid-configuration')).json();const u=new URL(d.jwks_uri);u.protocol='http:';u.host='127.0.0.1:5551';const r=await fetch(u);if(!r.ok)throw Error('JWKS failed');console.log(JSON.stringify(await r.json()))",
  ]);
  return JSON.parse(jwks);
}
async function dump(db, target, name) {
  await docker(name, [
    'exec',
    pg,
    'pg_dump',
    '-U',
    'duoyu',
    '-d',
    db,
    '-Fc',
    '-f',
    '/tmp/' + db + '.dump',
  ]);
  await docker(name + '-copy', ['cp', pg + ':/tmp/' + db + '.dump', target]);
}
let pgRunning = false,
  appRunning = false;
try {
  await run(
    'id-build',
    process.env.GO_BINARY,
    ['build', '-trimpath', '-o', path.join(root, 'duoyu-id'), './server'],
    {
      cwd: identity,
      env: { ...process.env, GOOS: 'linux', GOARCH: 'amd64', CGO_ENABLED: '0' },
    },
  );
  await docker('postgres-start', [
    'run',
    '--rm',
    '-d',
    '--name',
    pg,
    '--label',
    'duoyu.restore=' + label,
    '--memory',
    '768m',
    '--cpus',
    '2',
    '-e',
    'POSTGRES_USER=duoyu',
    '-e',
    'POSTGRES_PASSWORD=duoyu_dev_only',
    '-e',
    'POSTGRES_DB=id_source',
    pgImage,
  ]);
  pgRunning = true;
  await docker('postgres-ready', [
    'exec',
    pg,
    'sh',
    '-c',
    'for i in $(seq 1 60); do pg_isready -U duoyu && exit 0; sleep 1; done; exit 1',
  ]);
  const originalJWKS = await startID('id_source', 'id-data');
  await stopOwned(app);
  appRunning = false;
  await sql(
    'id-fixture',
    'id_source',
    `
    INSERT INTO users(id,email,name) VALUES('restore-user','restore@example.invalid','恢复演练');
    INSERT INTO apps(id,name,redirects,public) VALUES('restore-project','隔离项目',ARRAY['https://restore.invalid/callback'],true);
    INSERT INTO grants(app_id,user_id) VALUES('restore-project','restore-user');
    INSERT INTO audit(action,user_id,success) VALUES('restore.fixture','restore-user',true);
  `,
  );
  await writeFile(
    path.join(root, 'id-data/avatars/fixture.bin'),
    randomBytes(2048),
  );
  const idBefore = await contents('id_source', 'id-before');
  const idFiles = await tree(path.join(root, 'id-data'));
  const idBackup = path.join(root, 'id-backup');
  const beginID = Date.now();
  await run('id-backup', powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(identity, 'scripts/backup.ps1'),
    '-Container',
    pg,
    '-Database',
    'id_source',
    '-User',
    'duoyu',
    '-Destination',
    idBackup,
    '-DataDirectory',
    path.join(root, 'id-data'),
  ]);
  const restoreArgs = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(identity, 'scripts/restore-check.ps1'),
    '-Container',
    pg,
    '-User',
    'duoyu',
    '-Backup',
    idBackup,
    '-TargetDatabase',
    'duoyu_restore_id',
  ];
  await check(
    'identity real backup, database restore and every table/sequence',
    async () => {
      await run('id-restore', powershell, restoreArgs);
      assert.deepEqual(
        await contents('duoyu_restore_id', 'id-restored'),
        idBefore,
      );
      assert.deepEqual(await tree(path.join(idBackup, 'data')), idFiles);
    },
  );
  measurements.push({
    name: 'identity-backup-and-restore',
    elapsedMs: Date.now() - beginID,
    dumpBytes: (await stat(path.join(idBackup, 'database.dump'))).size,
    tables: Object.keys(idBefore.data).length,
  });
  await check(
    'existing restore database is refused and unchanged',
    async () => {
      await run('id-existing-refused', powershell, restoreArgs, {
        expectFailure: true,
      });
      assert.deepEqual(
        await contents('duoyu_restore_id', 'id-existing-unchanged'),
        idBefore,
      );
    },
  );
  await check(
    'restored identity starts with preserved signing key and JWKS',
    async () => {
      await cp(
        path.join(idBackup, 'data'),
        path.join(root, 'id-restored-data'),
        { recursive: true, errorOnExist: true, force: false },
      );
      const restoredJWKS = await startID(
        'duoyu_restore_id',
        'id-restored-data',
      );
      assert.deepEqual(restoredJWKS, originalJWKS);
      await stopOwned(app);
      appRunning = false;
      assert.deepEqual(
        await tree(path.join(root, 'id-restored-data')),
        idFiles,
      );
    },
  );
  await check(
    'incomplete ID manifest is rejected before database creation',
    async () => {
      const file = path.join(idBackup, 'manifest.json'),
        original = await readFile(file);
      try {
        const manifest = JSON.parse(
          original.toString('utf8').replace(/^\uFEFF/, ''),
        );
        manifest.files = manifest.files.filter(
          (entry) => entry.path !== 'database.dump',
        );
        await writeFile(file, JSON.stringify(manifest));
        await run(
          'id-incomplete-refused',
          powershell,
          [...restoreArgs.slice(0, -1), 'duoyu_restore_invalid'],
          { expectFailure: true },
        );
        assert.equal(
          (
            await sql(
              'id-no-invalid-db',
              'id_source',
              "SELECT count(*) FROM pg_database WHERE datname='duoyu_restore_invalid';",
            )
          ).trim(),
          '0',
        );
      } finally {
        await writeFile(file, original);
      }
    },
  );

  await docker('sync-createdb', [
    'exec',
    pg,
    'createdb',
    '-U',
    'duoyu',
    'sync_source',
  ]);
  for (const service of ['sync', 'backend'])
    await sql(
      service + '-schema',
      'sync_source',
      await readFile(path.join(backend, service, 'schema.sql'), 'utf8'),
    );
  const owner = '11111111-1111-4111-8111-111111111111';
  const assets = path.join(root, 'assets'),
    bytes = randomBytes(4 * 1024 * 1024 + 1024),
    hash = sha(bytes);
  await mkdir(path.join(assets, owner), { recursive: true });
  await mkdir(path.join(assets, 'catalog'));
  await writeFile(path.join(assets, owner, hash), bytes);
  const catalogBytes = Buffer.from('synthetic catalog image'),
    catalogHash = sha(catalogBytes);
  await writeFile(path.join(assets, 'catalog', catalogHash), catalogBytes);
  await sql(
    'sync-fixture',
    'sync_source',
    `
    INSERT INTO sync_accounts(id,issuer,subject,head_revision) VALUES('${owner}','https://restore.invalid','restore-user',1);
    INSERT INTO sync_assets(account_id,sha256,media_type,body,byte_size,file_path) VALUES('${owner}','${hash}','image/png',null,${bytes.length},'${owner}/${hash}');
    INSERT INTO sync_entities(account_id,entity_type,entity_id,payload,revision) VALUES('${owner}','links','restored-link','{"title":"恢复书签","image":"duoyu-asset:${hash}"}',1);
    INSERT INTO sync_changes(account_id,revision,operation_id,changes) VALUES('${owner}',1,'22222222-2222-4222-8222-222222222222','[]');
    INSERT INTO backend_users(account_id,name,initialized) VALUES('${owner}','恢复演练',true);
    INSERT INTO backend_catalog_files(sha256,media_type,byte_size) VALUES('${catalogHash}','image/png',${catalogBytes.length});
    INSERT INTO backend_catalog(kind,name,payload) VALUES('wallpapers','恢复壁纸','{"image":"duoyu-asset:${catalogHash}"}');
    INSERT INTO backend_audit(actor,action) VALUES('restore-user','fixture');
  `,
  );
  const key = randomBytes(32),
    backup = path.join(root, 'snapshots'),
    dumpPath = path.join(root, 'database.dump');
  const points = [];
  for (const mode of ['full', 'incremental']) {
    if (mode === 'incremental')
      await sql(
        'sync-change',
        'sync_source',
        `
      UPDATE sync_accounts SET head_revision=2;
      UPDATE sync_entities SET payload=payload || '{"title":"增量恢复书签"}', revision=2;
      INSERT INTO sync_changes(account_id,revision,operation_id,changes) VALUES('${owner}',2,'33333333-3333-4333-8333-333333333333','[]');
    `,
      );
    const expected = await contents('sync_source', mode + '-source');
    const begin = Date.now();
    await dump('sync_source', dumpPath, mode + '-dump');
    const record = await createSnapshot(backup, key, {
      dumpPath,
      assetRoot: assets,
      mode,
      keep: 7,
    });
    assert.equal(record.kind, mode);
    if (mode === 'incremental') assert.ok(record.added_bytes < record.bytes);
    const dest = path.join(root, mode + '-restored'),
      db = 'duoyu_restore_' + mode;
    await check(
      mode + ' encrypted snapshot restores real database, RLS and all files',
      async () => {
        await restoreSnapshot(backup, key, record.id, dest);
        assert.equal(
          sha(await readFile(path.join(dest, 'database.dump'))),
          sha(await readFile(dumpPath)),
        );
        assert.deepEqual(
          await tree(path.join(dest, 'users')),
          await tree(assets),
        );
        await docker(mode + '-createdb', [
          'exec',
          pg,
          'createdb',
          '-U',
          'duoyu',
          db,
        ]);
        await docker(mode + '-copy-dump', [
          'cp',
          path.join(dest, 'database.dump'),
          pg + ':/tmp/restore.dump',
        ]);
        await docker(mode + '-pg-restore', [
          'exec',
          pg,
          'pg_restore',
          '-U',
          'duoyu',
          '-d',
          db,
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
          '--single-transaction',
          '/tmp/restore.dump',
        ]);
        assert.deepEqual(await contents(db, mode + '-restored'), expected);
      },
    );
    measurements.push({
      name: mode + '-backup-and-restore',
      elapsedMs: Date.now() - begin,
      tables: Object.keys(expected.data).length,
      bytes: record.bytes,
      addedBytes: record.added_bytes,
    });
    points.push({ record, dest });
  }
  await check(
    'wrong key, corrupted encrypted object and existing target are refused',
    async () => {
      const { record, dest } = points[1];
      const wrong = path.join(root, 'wrong-key');
      await assert.rejects(
        restoreSnapshot(backup, randomBytes(32), record.id, wrong),
      );
      await assert.rejects(stat(wrong), { code: 'ENOENT' });
      const before = await tree(dest);
      await assert.rejects(restoreSnapshot(backup, key, record.id, dest), {
        code: 'EEXIST',
      });
      assert.deepEqual(await tree(dest), before);
      const object = path.join(
        backup,
        'objects',
        record.files[0].parts[0].object,
      );
      const original = await readFile(object),
        damaged = Buffer.from(original);
      damaged[20] ^= 1;
      await writeFile(object, damaged);
      const corrupt = path.join(root, 'corrupt');
      try {
        await assert.rejects(restoreSnapshot(backup, key, record.id, corrupt));
        await assert.rejects(stat(corrupt), { code: 'ENOENT' });
      } finally {
        await writeFile(object, original);
      }
    },
  );
  passed = true;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try {
    if (appRunning) {
      await stopOwned(app);
      appRunning = false;
    }
    if (pgRunning) {
      await stopOwned(pg);
      pgRunning = false;
    }
    const leftovers = await docker('cleanup-check', [
      'ps',
      '-aq',
      '--filter',
      'label=duoyu.restore=' + label,
    ]);
    assert.equal(leftovers.trim(), '');
    cleaned = true;
  } catch (error) {
    console.error('Cleanup failed:', error.message);
    process.exitCode = 1;
  }
  await writeFile(
    path.join(root, 'results.json'),
    JSON.stringify(
      {
        passed: passed && cleaned,
        cleaned,
        elapsedMs: Date.now() - started,
        scope:
          'synthetic local databases only; no production dump, SMTP, or production restore',
        postgresImage: pgImage,
        nodeImage,
        checks,
        measurements,
        stages,
      },
      null,
      2,
    ),
  );
  console.log('Evidence:', root);
}
