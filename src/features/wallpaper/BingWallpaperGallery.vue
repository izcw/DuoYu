<script setup lang="ts">
import WallpaperDownloadProgress from './WallpaperDownloadProgress.vue';
import {
  downloadWallpaper,
  type WallpaperProgress,
} from './download-wallpaper';
import WallpaperSelectionMark from './WallpaperSelectionMark.vue';
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useWallpaperSelection } from './useWallpaperSelection';
const selectedWallpaper = useWallpaperSelection();
const progress = ref<WallpaperProgress>();
import { importWallpaper } from './wallpaper-cache';
import { getBingOriginalUrl } from './wallpaper';
interface Wallpaper {
  id: number;
  title: string;
  url: string;
  datetime: string;
  copyright: string;
}
const entries = ref<Wallpaper[]>([]);
const loading = ref(false);
const error = ref('');
const message = ref('');
const applying = ref<number>();
const more = ref(true);
const sentinel = ref<HTMLElement>();
const controller = new AbortController();
let page = 1;
let observer: IntersectionObserver | undefined;
let disposed = false;
async function load() {
  if (loading.value || !more.value || disposed) return;
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch(
      `https://api.bimg.cc/all?page=${page}&order=desc&limit=18&w=1920&h=1080&mkt=zh-CN`,
      {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      },
    );
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.code !== 200 || !Array.isArray(data.data)) throw new Error();
    const known = new Set(entries.value.map((item) => item.id));
    const incoming = (data.data as Wallpaper[]).filter(
      (item) =>
        !known.has(item.id) &&
        /^https:\/\/(?:www\.)?bing\.com\//.test(item.url),
    );
    entries.value.push(...incoming);
    entries.value.sort((a, b) => b.datetime.localeCompare(a.datetime));
    more.value =
      incoming.length > 0 && entries.value.length < Number(data.total);
    page++;
  } catch {
    if (!disposed) error.value = '壁纸加载失败，请重试';
  } finally {
    loading.value = false;
    await nextTick();
    if (!disposed && !error.value && more.value && sentinel.value) {
      observer?.unobserve(sentinel.value);
      observer?.observe(sentinel.value);
    }
  }
}
function isSelected(item: Wallpaper) {
  if (selectedWallpaper.value === 'bing:' + item.id) return true;
  // Preserve selections saved before gallery IDs replaced download URLs.
  if (!selectedWallpaper.value.startsWith('bing:https://')) return false;
  try {
    const saved = new URL(selectedWallpaper.value.slice(5));
    const current = new URL(item.url);
    const identity = (url: URL) =>
      (url.searchParams.get('id') || url.pathname).replace(
        /_(?:\d+x\d+|UHD)(?=\.)/i,
        '',
      );
    return identity(saved) === identity(current);
  } catch {
    return false;
  }
}
async function apply(item: Wallpaper) {
  if (applying.value !== undefined) return;
  applying.value = item.id;
  progress.value = undefined;
  message.value = '';
  try {
    const blob = await downloadWallpaper(
      getBingOriginalUrl(item.url),
      (value) => (progress.value = value),
      {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20000),
        ]),
        referrerPolicy: 'no-referrer',
      },
    );
    await importWallpaper(blob, 'bing:' + item.id);
    message.value = '';
  } catch {
    if (!disposed) message.value = '壁纸应用失败，请重试';
  } finally {
    applying.value = undefined;
  }
}
onMounted(() => {
  observer = new IntersectionObserver(
    (records) => {
      if (records.some((r) => r.isIntersecting) && !error.value) void load();
    },
    { root: sentinel.value?.closest('.store-content'), rootMargin: '180px' },
  );
  if (sentinel.value) observer.observe(sentinel.value);
});
onUnmounted(() => {
  disposed = true;
  controller.abort();
  observer?.disconnect();
});
</script>
<template>
  <div class="store-card-grid wallpaper-card-grid">
    <button
      v-for="item in entries"
      :key="item.id"
      class="store-card wallpaper-card glass-surface"
      :disabled="applying !== undefined"
      :aria-label="`应用壁纸 ${item.title}`"
      :title="item.copyright"
      :aria-pressed="isSelected(item)"
      @click="apply(item)"
    >
      <img
        :src="item.url.replace('_1920x1080', '_800x480')"
        :alt="item.title"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
      />
      <WallpaperSelectionMark :selected="isSelected(item)" />
      <span class="wallpaper-caption"
        ><strong>{{ item.title }}</strong
        ><WallpaperDownloadProgress
          v-if="applying === item.id"
          :progress="progress"
        /><small v-else>{{ item.datetime }}</small></span
      >
    </button>
  </div>
  <p v-if="message" role="status">{{ message }}</p>
  <div ref="sentinel" class="wallpaper-load-status" aria-live="polite">
    <span v-if="loading">正在加载壁纸…</span>
    <button
      v-else-if="error"
      class="glass-control glass-interactive"
      @click="load"
    >
      {{ error }}
    </button>
    <span v-else-if="!more">已显示全部壁纸</span>
  </div>
</template>
