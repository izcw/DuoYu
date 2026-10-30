<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue';
import LibraryGrid from '../library/LibraryGrid.vue';
import WallpaperSurface from '../wallpaper/WallpaperSurface.vue';
import { getDailyWallpaperUrl } from '../wallpaper/wallpaper';
import { assetObjectUrl } from './assets';
import { previewItems, previewPreference } from './conflict-preview';
import type { Entity } from './model';
import { HOME_GRID_ROWS, LIBRARY_GRID_ROWS } from '../library/grid-config';
const props = defineProps<{ entities: Entity[]; view: string; zoom: number }>();
const content = computed(() => previewItems(props.entities, props.view));
const viewport = ref<HTMLElement>();
let scrollFrame = 0;
watch(
  () => [props.zoom, props.view],
  async () => {
    await nextTick();
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (viewport.value) {
        viewport.value.scrollLeft = 0;
        viewport.value.scrollTop =
          props.view === 'page:home'
            ? viewport.value.scrollHeight - viewport.value.clientHeight
            : 0;
      }
    });
  },
  { immediate: true },
);
const home = computed(() => props.view === 'page:home');
const source = ref(''),
  loaded = ref(false),
  error = ref('');
let request = 0,
  ownedUrl = '';
const material = computed(
  () =>
    previewPreference(props.entities, 'glassMode') ||
    document.documentElement.dataset.glassMode ||
    'real',
);
watch(
  () => [props.entities, previewPreference(props.entities, 'wallpaperMode')],
  async () => {
    const id = ++request;
    error.value = '';
    let next = '',
      own = '';
    try {
      const wallpaper = props.entities.find(
        (e) => e.table === 'wallpapers' && e.id === 'daily',
      )?.payload;
      const mode = previewPreference(props.entities, 'wallpaperMode');
      if (wallpaper && mode !== 'daily') {
        const asset = wallpaper.asset ?? wallpaper.blob;
        if (asset instanceof Blob) {
          own = URL.createObjectURL(asset);
          next = own;
        } else if (
          typeof asset === 'string' &&
          asset.startsWith('duoyu-asset:')
        )
          next = await assetObjectUrl(asset);
        else if (typeof asset === 'string' && asset.startsWith('data:image/'))
          next = asset;
        else throw Error('壁纸资源暂不可用');
      } else if (mode === 'daily') next = getDailyWallpaperUrl();
      else
        next =
          document.querySelector<HTMLImageElement>(
            '.wallpaper:not(.wallpaper-contained) > img.loaded',
          )?.src || getDailyWallpaperUrl();
      if (id !== request) {
        if (own) URL.revokeObjectURL(own);
        return;
      }
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      ownedUrl = own;
      if (source.value !== next) loaded.value = false;
      source.value = next;
    } catch (e) {
      if (id === request) {
        source.value = '';
        error.value = e instanceof Error ? e.message : '壁纸加载失败';
      }
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  cancelAnimationFrame(scrollFrame);
  request++;
  if (ownedUrl) URL.revokeObjectURL(ownedUrl);
});
</script>
<template>
  <div ref="viewport" class="preview-viewport">
    <div
      class="preview-desktop glass-material-scope"
      :data-glass-mode="material"
      :style="{
        width: zoom * 100 + '%',
        height: Math.round(420 * zoom) + 'px',
      }"
    >
      <WallpaperSurface
        contained
        :source="source"
        :loaded="loaded"
        @load="loaded = true"
        @error="error = '壁纸预览加载失败'"
      />
      <div v-if="!home" class="preview-focus glass-focus-layer" />
      <div class="preview-grid">
        <LibraryGrid
          :key="view"
          preview
          :items="content.items"
          :all="content.all"
          :rows="home ? HOME_GRID_ROWS : LIBRARY_GRID_ROWS"
          :alignment="home ? 'end' : 'center'"
          :managing="false"
          disabled
        />
      </div>
      <span v-if="!content.items.length" class="preview-empty"
        >此版本在这里没有项目</span
      >
    </div>
  </div>
  <p v-if="error" class="preview-warning" role="status">{{ error }}</p>
</template>
<style scoped>
.preview-viewport {
  height: 420px;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--wallpaper-fallback, #dedfe1);
}
.preview-desktop {
  position: relative;
  isolation: isolate;
  color: white;
  min-width: 100%;
  min-height: 100%;
  overflow: hidden;
}
.preview-focus {
  position: absolute;
  inset: 0;
  z-index: 1;
}
.preview-grid {
  position: absolute;
  inset: 22px 18px 26px;
  z-index: 2;
}
.preview-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 3;
  color: white;
  text-shadow: 0 1px 4px #0008;
  font-size: 13px;
  pointer-events: none;
}
.preview-warning {
  font-size: 12px;
  margin: 0;
  padding: 8px 12px;
  color: #986b36;
  background: #fff8ed;
}
.preview-grid :deep(.ui-resizable-handle) {
  display: none !important;
}
</style>
