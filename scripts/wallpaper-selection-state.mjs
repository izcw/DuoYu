import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import 'fake-indexeddb/auto';
import Dexie, { liveQuery } from 'dexie';
import { createRenderer, ref, onUnmounted, onActivated } from 'vue';
import ts from 'typescript';

const code = ts
  .transpileModule(
    await readFile('src/features/wallpaper/useWallpaperSelection.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replace(/^import[\s\S]*?;\r?\n/gm, '')
  .replace(/\bexport /g, '');
const database = new Dexie('wallpaper-selection-test-' + Date.now());
database.version(1).stores({ wallpapers: 'id', preferences: 'id' });
const events = new EventTarget();
const activeDesktop = ref('default');
const useSelection = new Function(
  'ref',
  'onUnmounted',
  'onActivated',
  'liveQuery',
  'database',
  'accountStorage',
  'window',
  'prefix',
  'activeDesktop',
  code + '; return useWallpaperSelection;',
)(
  ref,
  onUnmounted,
  onActivated,
  liveQuery,
  database,
  { getItem: () => 'custom' },
  events,
  'wallpaperDesktop:',
  activeDesktop,
);
// Real Vue mount/unmount lifecycle and real Dexie transactions/notifications.
const renderer = createRenderer({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert() {},
  remove() {},
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
});
function mount() {
  let selected;
  const app = renderer.createApp({
    setup() {
      selected = useSelection();
      return () => null;
    },
  });
  app.mount({});
  return { selected, unmount: () => app.unmount() };
}
async function expectSelection(instance, expected) {
  const deadline = Date.now() + 2000;
  while (instance.selected.value !== expected && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(instance.selected.value, expected);
}
try {
  await database.wallpapers.put({ id: 'daily', selection: 'bing:old-cache' });
  await database.preferences.put({ id: 'wallpaperMode', value: null });
  for (const choice of ['daily', 'bing:123', 'cloud:uuid', 'upload']) {
    await database.preferences.put({ id: 'wallpaperSelection', value: choice });
    const first = mount();
    await expectSelection(first, choice);
    first.unmount();
    const reopened = mount();
    await expectSelection(reopened, choice);
    // Cache hydration must not change the user's selected card.
    await database.wallpapers.put({ id: 'daily', selection: 'cloud:older' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(reopened.selected.value, choice);
    // Another tab/sync commits a selection; no UI event needed.
    await database.preferences.put({
      id: 'wallpaperSelection',
      value: 'bing:new',
    });
    await expectSelection(reopened, 'bing:new');
    reopened.unmount();
  }
  await database.preferences.delete('wallpaperSelection');
  await database.preferences.put({ id: 'wallpaperMode', value: 'custom' });
  const legacy = mount();
  await expectSelection(legacy, 'cloud:older');
  await database.preferences.put({
    id: 'wallpaperDesktop:second',
    value: { selection: 'upload' },
  });
  activeDesktop.value = 'second';
  events.dispatchEvent(new Event('duoyu-wallpaper-change'));
  await expectSelection(legacy, 'upload');
  await database.preferences.put({
    id: 'wallpaperDesktop:second',
    value: { selection: 'cloud:second' },
  });
  await expectSelection(legacy, 'cloud:second');
  legacy.unmount();
  console.log(
    'PASS: real Vue remount + Dexie selection restoration, stale cache/mode, live updates, legacy fallback',
  );
} finally {
  await database.delete();
}
