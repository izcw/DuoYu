// Run from the extension root after a production build. This suite covers the
// reviewed fixes and current workspace flows; real OIDC remains separate.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
await access('.output/chrome-mv3/manifest.json');
const directory = path.resolve('work/review-regression-' + Date.now());
await mkdir(directory, { recursive: true });
const scripts =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        'admin-api-regression',
        'account-controls',
        'id-storage-upgrade',
        'website-icon',
        'auth-protocol',
        'auth-session',
        'data-integrity',
        'workspace-integrity',
        'import-dialog-race',
        'cloud-client',
        'asset-lifecycle',
        'conflict-preview',
        'conflict-apply-flow',
        'dock-reorder',
        'dock-transfer',
        'pending-wallpaper',
        'wallpaper-selection-race',
        'wallpaper-selection-state',
        'wallpaper-download',
        'wallpaper-cache',
        'upload-lifecycle-ui',
        'search-regression',
        'engine-wheel',
        'library-crud-ui',
        'desktop-interactions-ui',
        'folder-dialog-ui',
        'workspace-crud-current',
        'workspace-interactions-ui',
        'offline-contrast-ui',
        'workspace-collections',
        'cloud-ui',
        'startup-offline-ui',
        'startup-account-isolation-ui',
        'preference-account-ui',
        'library-page-icons',
        'desktop-icon-size',
        'library-grid',
        'folder-auto-sort',
        'workspace-space-menu',
        'desktop-boundaries',
        'delete-confirm',
        'desktop-menu',
        'desktop-selection',
        'desktop-layout',
        'desktop-dock',
        'desktop-centering',
        'drag-restore',
        'dock-links',
        'folder-entry-direction',
        'folder-drag-out',
        'resize-push',
        'home-drag-focus',
        'home-navigation-ui',
        'library-free-placement',
        'library-limits',
        'library-page-context',
        'library-page-drag',
        'library-page-reorder',
        'icon-stack-alignment',
        'store-cards',
        'store-layout',
        'catalog-race',
        'folder-pagination-ui',
        'local-backdrop',
        'library-entry',
        'shortcuts',
        'radial-wheel',
      ];
const results = [];
for (const name of scripts) {
  if (!/^[a-z0-9-]+$/.test(name))
    throw new Error('Invalid regression script name');
  await access(`scripts/${name}.mjs`);
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${name}.mjs`], {
      env: {
        ...process.env,
        TEST_BROWSER_CHANNEL: process.env.TEST_BROWSER_CHANNEL || 'msedge',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      output += '\nRegression script exceeded 120 seconds.\n';
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else child.kill('SIGTERM');
    }, 120000);
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.on('error', (error) => {
      output += error.stack;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({
        name,
        code: timedOut ? 124 : code,
        signal,
        output,
        elapsedMs: Date.now() - started,
      });
    });
  });
  await writeFile(path.join(directory, name + '.log'), result.output);
  results.push({ ...result, output: undefined });
  await writeFile(
    path.join(directory, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `${result.code === 0 ? 'PASS' : 'FAIL'} ${name} (${result.elapsedMs}ms)`,
  );
}
await writeFile(
  path.join(directory, 'results.json'),
  JSON.stringify(results, null, 2),
);
console.log('Evidence: ' + directory);
if (results.some((result) => result.code !== 0)) process.exitCode = 1;
