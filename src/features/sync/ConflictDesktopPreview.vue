<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import WorkspaceCardMain from '../workspace/WorkspaceCardMain.vue';
import '../workspace/workspace.css';
import { collectionColor,collectionColors } from '../../shared/collection-colors';
import LibraryGrid from '../library/LibraryGrid.vue';
import WallpaperSurface from '../wallpaper/WallpaperSurface.vue';
import { getDailyWallpaperUrl } from '../wallpaper/wallpaper';
import { assetObjectUrl } from './assets';
import { previewItems, previewPreference } from './conflict-preview';
import type { Entity } from './model';
import { HOME_GRID_ROWS, LIBRARY_GRID_ROWS } from '../library/grid-config';
const props = defineProps<{
  entities: Entity[];
  view: string;
  highlightIds?: string[];
  highlightRegion?: boolean;
}>();
const workspace = computed(()=>/^(space|tabs):/.test(props.view));
const groups = computed(()=>{
  const tabs = props.view.startsWith('tabs:'), id = props.view.slice(props.view.indexOf(':')+1);
  const entities = props.entities.filter(e=>!e.deleted);
  const ordered = (a:Entity,b:Entity)=>Number(a.payload.position || 0)-Number(b.payload.position || 0) || a.id.localeCompare(b.id);
  return entities.filter(e=>e.table==='tabCollections' && (tabs ? e.id===id : (e.payload.spaceId || '')===id)).sort(ordered).map(group=>({
    ...group, tabs:entities.filter(e=>e.table==='savedTabs' && e.payload.collectionId===group.id).sort(ordered)
  }));
});
const content = computed(() => previewItems(props.entities, props.view));
const viewport = ref<HTMLElement>();
const desktopWidth = ref(window.innerWidth);
const desktopHeight = ref(window.innerHeight);
const scale = ref(0);
let observer: ResizeObserver;
function measure() {
  desktopWidth.value = Math.max(1, window.innerWidth);
  desktopHeight.value = Math.max(1, window.innerHeight);
  scale.value = (viewport.value?.clientWidth || 0) / desktopWidth.value;
}
onMounted(() => {
  observer = new ResizeObserver(measure);
  observer.observe(viewport.value!);
  window.addEventListener('resize', measure);
  measure();
});
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
  observer?.disconnect();
  window.removeEventListener('resize', measure);
  request++;
  if (ownedUrl) URL.revokeObjectURL(ownedUrl);
});
</script>
<template>
  <div ref="viewport" class="preview-viewport" :style="{ aspectRatio: desktopWidth + ' / ' + desktopHeight }">
    <div
      class="preview-desktop glass-material-scope"
      :class="{ 'conflict-region': highlightRegion }"
      :data-glass-mode="material"
      :style="{
        width: desktopWidth + 'px',
        height: desktopHeight + 'px',
        transform: 'scale(' + scale + ')',
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
      <section v-if="workspace" class="workspace-board workspace-preview">
        <article v-for="group in groups" :key="group.id" class="workspace-collection">
          <header class="workspace-collection-heading"><strong class="workspace-collection-name" :style="{color:collectionColors[collectionColor(group.payload.color)][1]}">{{ group.payload.name }}</strong></header>
          <div class="workspace-saved-tabs"><div v-for="tab in group.tabs" :key="tab.id" class="workspace-saved-tab glass-surface" :class="{'conflict-region':highlightIds?.includes(tab.id)}">
            <WorkspaceCardMain readonly :title="tab.payload.title || tab.payload.url || '标签页'" :url="tab.payload.url || ''" :icon="tab.payload.icon"><span v-if="tab.payload.starred" aria-label="已标记">★</span></WorkspaceCardMain>
          </div></div>
        </article>
      </section>
      <div v-else
        class="preview-grid"
        :class="{ 'preview-folder glass-surface': view.startsWith('folder:') }"
      >
        <LibraryGrid
          :key="view"
          preview
          :highlight-ids="highlightIds"
          :items="content.items"
          :all="content.all"
          :rows="home ? HOME_GRID_ROWS : LIBRARY_GRID_ROWS"
          :alignment="home ? 'end' : 'center'"
          :managing="false"
          disabled
        />
      </div>
      <span v-if="workspace ? !groups.length : !content.items.length" class="preview-empty"
        >此版本在这里没有项目</span
      >
    </div>
  </div>
  <p v-if="error" class="preview-warning" role="status">{{ error }}</p>
</template>
<style scoped>
.preview-viewport {
  position: relative;
  width: 100%;
  overflow: hidden;
  overscroll-behavior: contain;
  background: var(--wallpaper-fallback, #dedfe1);
}
.preview-desktop {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  isolation: isolate;
  color: white;
  overflow: hidden;
}
.conflict-region {
  outline: 3px solid #ffad32;
  outline-offset: -3px;
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
.preview-desktop .workspace-preview { position:absolute; inset:0; z-index:2; display:block; width:auto; height:auto; padding:32px; overflow:auto; background:transparent; }
.preview-folder {
  border: 1px solid #ffffff70;
  border-radius: 24px;
  background: #ffffff20;
  padding: 12px;
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
