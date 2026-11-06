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
let decodeCount = 0,
  stallDecode = false;
const storage = new Map();
const preferences = new Map();
let record,
  transaction = false,
  fetches = 0,
  queue = Promise.resolve();
const cache = compile(
  await readFile('src/features/wallpaper/wallpaper-cache.ts', 'utf8'),
  {
    setTimeout: (fn, delay) => setTimeout(fn, delay === 3000 ? 25 : delay),
    getAsset: async () => new Blob(['saved'], { type: 'image/png' }),
    activeDesktop: { value: 'default' },
    saveDesktopChoice: async (id, selection, asset) =>
      preferences.set('wallpaperDesktop:' + id, { id, selection, asset }),
    rememberWallpaperChoice: () => {},
    cacheAsset: async () => 'duoyu-asset:' + 'a'.repeat(64),
    accountStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    },
    database: {
      wallpapers: {
        get: async () => record,
        put: async (value) => {
          assert(transaction);
          record = value;
        },
        delete: async () => {
          record = undefined;
        },
      },
      preferences: {
        get: async (id) => ({ value: preferences.get(id) }),
        delete: async (id) => preferences.delete(id),
        put: async (value) => {
          assert(transaction);
          preferences.set(value.id, value.value);
        },
      },
      transaction: async (...args) => {
        transaction = true;
        try {
          return await args.at(-1)();
        } finally {
          transaction = false;
        }
      },
    },
    navigator: {
      locks: {
        request: (_key, ...args) => {
          const result = queue.then(args.at(-1));
          queue = result.catch(() => {});
          return result;
        },
      },
    },
    Image: class {
      naturalWidth = 10;
      naturalHeight = 10;
      decode() {
        decodeCount++;
        return stallDecode ? new Promise(() => {}) : Promise.resolve();
      }
    },
    saveWallpaperPreview: () => {},
    window: { dispatchEvent: () => {} },
    fetch: async () => {
      fetches++;
      throw Error('Unexpected daily download');
    },
  },
  'importWallpaper, refreshWallpaper, selectDailyWallpaper, readWallpaperForDisplay, removeUploadedWallpaper',
);
await cache.importWallpaper(
  new Blob(['chosen'], { type: 'image/png' }),
  'bing:test',
);
assert.equal(decodeCount, 1, 'saving must reuse the already decoded original');
assert.equal(preferences.get('wallpaperMode'), 'custom');
assert.equal(preferences.get('wallpaperSelection'), 'bing:test');
assert.equal(record.selection, 'bing:test');
const savedStore = preferences.get('savedWallpaper:store');
await cache.importWallpaper(new Blob(['upload'], { type: 'image/png' }));
assert.equal(preferences.get('savedWallpaper:store'), savedStore);
assert.equal(preferences.get('savedWallpaper:upload').selection, 'upload');
assert.equal(record.selection, 'upload');
const chosen = record;
assert.equal(
  await cache.refreshWallpaper('old-daily', new AbortController().signal),
  chosen,
);
assert.equal(fetches, 0);
await cache.selectDailyWallpaper();
assert.equal(preferences.get('wallpaperMode'), null);
assert.equal(preferences.get('wallpaperSelection'), 'daily');
assert.equal(storage.has('duoyu-wallpaper-mode'), false);
console.log(
  'PASS atomic wallpaper/selection save, queued daily refresh cannot overwrite custom choice',
);
stallDecode = true;
await cache.readWallpaperForDisplay();
stallDecode = false;
await cache.importWallpaper(
  new Blob(['after-timeout'], { type: 'image/png' }),
  'cloud:after-timeout',
);
assert.equal(record.selection, 'cloud:after-timeout');
preferences.set('wallpaperMode', null);
storage.delete('duoyu-wallpaper-mode');
record = { ...record, selection: undefined, sourceUrl: 'old-daily' };
await cache.readWallpaperForDisplay();
assert.equal(record.selection, 'cloud:after-timeout');
assert.equal(storage.get('duoyu-wallpaper-mode'), 'custom');
console.log(
  'PASS persisted selection restores the selected original before daily refresh',
);
// A synced selection can arrive before its local preview blob.
record = { ...record, selection: 'upload', sourceUrl: 'local:old-upload' };
preferences.set('wallpaperDesktop:default', {
  id: 'default',
  selection: 'cloud:new',
});
preferences.set('wallpaperSelection', 'cloud:new');
await cache.removeUploadedWallpaper();
assert.equal(preferences.get('wallpaperSelection'), 'cloud:new');
assert.equal(
  preferences.get('wallpaperDesktop:default').selection,
  'cloud:new',
);
assert.ok(!preferences.has('savedWallpaper:upload'));
preferences.set('wallpaperDesktop:default', {
  id: 'default',
  selection: 'upload',
});
record = { ...record, selection: 'cloud:cached', sourceUrl: 'local:other' };
await cache.removeUploadedWallpaper();
assert.equal(preferences.get('wallpaperSelection'), 'daily');
assert.equal(record.selection, 'cloud:cached');
assert.equal(storage.has('duoyu-wallpaper-mode'), false);
console.log(
  'PASS stalled startup preview releases the wallpaper lock and subsequent saving completes',
);

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
let resolveOld;
const oldUrl = new Promise((resolve) => {
  resolveOld = resolve;
});
const vue = await readFile(
  'src/features/wallpaper/WallpaperBackground.vue',
  'utf8',
);
const background = compile(
  vue.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1],
  {
    ref: (value) => ({ value }),
    onMounted: () => {},
    onUnmounted: () => {},
    accountStorage: { getItem: () => 'custom' },
    readWallpaperForDisplay: async () => ({ blob: 'new', sourceUrl: 'new' }),
    decodeWallpaper: (blob) =>
      blob === 'old' ? oldUrl : Promise.resolve('blob:new'),
    refreshWallpaper: async () => {
      throw Error('Unexpected refresh');
    },
    getDailyWallpaperUrl: () => 'daily',
    document: { documentElement: { style: { setProperty() {} }, dataset: {} } },
  },
  'source, display, wallpaperChanged',
);
const oldDisplay = background.display({ blob: 'old', sourceUrl: 'old' }, 0);
await background.wallpaperChanged();
resolveOld('blob:old');
await oldDisplay;
assert.equal(background.source.value, 'blob:new');
console.log(
  'PASS delayed old image decoding cannot replace the newest selection',
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
