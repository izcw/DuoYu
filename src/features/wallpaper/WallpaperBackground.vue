<script setup lang="ts">
import { accountStorage } from '../../shared/storage/account';
import WallpaperSurface from './WallpaperSurface.vue';
import { onMounted, onUnmounted, ref } from 'vue';
import { getDailyWallpaperUrl } from './wallpaper';
import {
  decodeWallpaper,
  readWallpaperForDisplay,
  refreshWallpaper,
} from './wallpaper-cache';
import type { WallpaperRecord } from '../../shared/storage/database';

const source = ref('');
const loaded = ref(false);
const failed = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const controller = new AbortController();
let displayedSource = '';
const cachedWallpaper = readWallpaperForDisplay();
let pending = false;
let retryAfter = 0;
let revision = 0;

async function display(record: WallpaperRecord, request: number) {
  const next = await decodeWallpaper(record.blob);
  if (controller.signal.aborted || request !== revision) {
    URL.revokeObjectURL(next);
    return;
  }
  const previous = source.value;
  source.value = next;
  // Keep the original image available for wallpaper-store previews only.
  document.documentElement.style.setProperty(
    '--desktop-wallpaper-image',
    `url("${next}")`,
  );
  document.documentElement.dataset.desktopWallpaper = 'ready';
  loaded.value = true;
  displayedSource = record.sourceUrl;
  failed.value = false;
  if (previous) URL.revokeObjectURL(previous);
}
async function update() {
  if (accountStorage.getItem('duoyu-wallpaper-mode') === 'custom') return;
  const next = getDailyWallpaperUrl();
  if (
    pending ||
    controller.signal.aborted ||
    displayedSource === next ||
    Date.now() < retryAfter
  )
    return;
  pending = true;
  const request = revision;
  try {
    const record = await refreshWallpaper(next, controller.signal);
    if (
      request !== revision ||
      accountStorage.getItem('duoyu-wallpaper-mode') === 'custom'
    )
      return;
    await display(record, request);
    retryAfter = 0;
  } catch {
    if (!controller.signal.aborted) {
      failed.value = !source.value;
      retryAfter = Date.now() + 5 * 60_000;
    }
  } finally {
    pending = false;
    if (request !== revision && !controller.signal.aborted) void update();
  }
}
async function wallpaperChanged() {
  const request = ++revision;
  if (accountStorage.getItem('duoyu-wallpaper-mode') === 'custom') {
    const cached = await readWallpaperForDisplay();
    // Missing cloud assets are temporary; never reset the user's chosen mode.
    if (cached && request === revision) await display(cached, request);
  } else {
    displayedSource = '';
    retryAfter = 0;
    await update();
  }
}
function online() {
  retryAfter = 0;
  void update();
}
onMounted(async () => {
  window.addEventListener('online', online);
  window.addEventListener('duoyu-wallpaper-change', wallpaperChanged);
  const request = revision;
  const cached = await cachedWallpaper;
  if (controller.signal.aborted) return;
  if (cached) {
    try {
      await display(cached, request);
    } catch {
      // Fall through to the network if the stored image cannot be decoded.
    }
  }
  if (controller.signal.aborted) return;
  void update();
  timer = setInterval(() => void update(), 60_000);
});
onUnmounted(() => {
  controller.abort();
  clearInterval(timer);
  window.removeEventListener('online', online);
  window.removeEventListener('duoyu-wallpaper-change', wallpaperChanged);
  document.documentElement.style.removeProperty('--desktop-wallpaper-image');
  delete document.documentElement.dataset.desktopWallpaper;
  if (source.value) URL.revokeObjectURL(source.value);
});
</script>

<template>
  <WallpaperSurface :source="source" :loaded="loaded" @error="failed = true" />
  <p v-if="failed" class="wallpaper-status" role="status">
    壁纸暂未加载，已使用默认背景
  </p>
</template>
