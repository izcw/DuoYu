<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { getDailyWallpaperUrl } from './wallpaper';
import { saveWallpaperPreview } from './wallpaper-preview';
import {
  decodeWallpaper,
  readWallpaper,
  refreshWallpaper,
} from './wallpaper-cache';
import type { WallpaperRecord } from '../../shared/storage/database';

const source = ref('');
const loaded = ref(false);
const failed = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const controller = new AbortController();
let displayedSource = '';
let displayedVersion = '';
const cachedWallpaper = readWallpaper();
let pending = false;
let retryAfter = 0;

async function display(record: WallpaperRecord) {
  const next = await decodeWallpaper(record.blob);
  if (controller.signal.aborted) {
    URL.revokeObjectURL(next);
    return;
  }
  const previous = source.value;
  displayedVersion = `${record.sourceUrl}:${record.savedAt}`;
  source.value = next;
  loaded.value = true;
  displayedSource = record.sourceUrl;
  failed.value = false;
  if (previous) URL.revokeObjectURL(previous);
}
function onImageLoad(event: Event) {
  loaded.value = true;
  saveWallpaperPreview(event.target as HTMLImageElement, displayedVersion);
}
async function update() {
  const next = getDailyWallpaperUrl();
  if (
    pending ||
    controller.signal.aborted ||
    displayedSource === next ||
    Date.now() < retryAfter
  )
    return;
  pending = true;
  try {
    await display(await refreshWallpaper(next, controller.signal));
    retryAfter = 0;
  } catch {
    if (!controller.signal.aborted) {
      failed.value = !source.value;
      retryAfter = Date.now() + 5 * 60_000;
    }
  } finally {
    pending = false;
  }
}
function online() {
  retryAfter = 0;
  void update();
}
onMounted(async () => {
  const cached = await cachedWallpaper;
  if (controller.signal.aborted) return;
  if (cached) {
    try {
      await display(cached);
    } catch {
      // Fall through to the network if the stored image cannot be decoded.
    }
  }
  if (controller.signal.aborted) return;
  void update();
  timer = setInterval(() => void update(), 60_000);
  window.addEventListener('online', online);
});
onUnmounted(() => {
  controller.abort();
  clearInterval(timer);
  window.removeEventListener('online', online);
  if (source.value) URL.revokeObjectURL(source.value);
});
</script>

<template>
  <div class="wallpaper" aria-hidden="true">
    <img
      v-if="source"
      :src="source"
      :class="{ loaded }"
      alt=""
      referrerpolicy="no-referrer"
      @load="onImageLoad"
      @error="failed = true"
    />
    <div class="wallpaper-shade"></div>
  </div>
  <p v-if="failed" class="wallpaper-status" role="status">
    壁纸暂未加载，已使用默认背景
  </p>
</template>
