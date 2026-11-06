import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
function compile(source, bindings, exports) {
  const code = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/\bexport /g, '');
  return new Function(
    ...Object.keys(bindings),
    code + '\nreturn {' + exports + '};',
  )(...Object.values(bindings));
}
// Network image decoding and stale daily downloads are exercised in wallpaper-cache.mjs.
const cloudSource = (
  await readFile('src/features/desktop/CloudCatalog.vue', 'utf8')
)
  .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  .replaceAll(
    'import.meta.env.VITE_SYNC_URL',
    JSON.stringify('https://sync.duoyu.link'),
  );
let finishSave;
const cloud = compile(
  cloudSource,
  {
    ref: (value) => ({ value }),
    watch: () => {},
    onUnmounted: () => {},
    defineProps: () => ({ kind: 'wallpapers' }),
    defineEmits: () => () => {},
    useWallpaperSelection: () => ({ value: '' }),
    downloadWallpaper: async (_url, progress) => {
      progress({ loaded: 10, total: 10, complete: true });
      return new Blob(['image'], { type: 'image/png' });
    },
    importWallpaper: () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  },
  'apply,busy,applying,progress,error',
);
const saving = cloud.apply({
  id: 'test',
  payload: { url: 'https://sync.duoyu.link/catalog-assets/' + 'a'.repeat(64) },
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(cloud.busy.value, true);
assert.equal(cloud.progress.value.complete, true);
finishSave();
await saving;
assert.equal(cloud.busy.value, false);
assert.equal(cloud.applying.value, undefined);
assert.equal(cloud.progress.value, undefined);
console.log(
  'PASS featured wallpaper saving clears its progress state after local persistence',
);
const previewSource = (
  await readFile('src/features/wallpaper/MyWallpapers.vue', 'utf8')
).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
let publish, dispose, resolveAsset;
const pendingAsset = new Promise((resolve) => {
  resolveAsset = resolve;
});
const liveUrls = new Set();
const previewState = compile(
  previewSource,
  {
    ref: (value) => ({ value }),
    useWallpaperSelection: () => ({ value: 'daily' }),
    liveQuery: () => ({
      subscribe(fn) {
        publish = fn;
        return { unsubscribe() {} };
      },
    }),
    onUnmounted: (fn) => {
      dispose = fn;
    },
    getAsset: (key) =>
      key === 'slow' ? pendingAsset : Promise.reject(new Error('unavailable')),
    URL: {
      createObjectURL() {
        liveUrls.add('blob:slow');
        return 'blob:slow';
      },
      revokeObjectURL(url) {
        liveUrls.delete(url);
      },
    },
  },
  'previews',
);
const previewUpdate = publish({
  store: { selection: 'cloud:store', blob: 'missing' },
  upload: { selection: 'upload', blob: 'slow' },
});
await new Promise((resolve) => setTimeout(resolve, 0));
resolveAsset(new Blob(['preview']));
await previewUpdate;
assert.equal(previewState.previews.value.upload, 'blob:slow');
dispose();
assert.equal(liveUrls.size, 0);
console.log(
  'PASS one preview failure preserves its sibling and all object URLs are released',
);
