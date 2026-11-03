<script setup lang="ts">
import type {WidgetSize} from "../../shared/storage/database";
import WallpaperDownloadProgress from '../wallpaper/WallpaperDownloadProgress.vue';
import {
  downloadWallpaper,
  type WallpaperProgress,
} from '../wallpaper/download-wallpaper';
import WallpaperSelectionMark from '../wallpaper/WallpaperSelectionMark.vue';
import { ref, watch } from 'vue';
import { rpc, syncNow } from '../sync/client';
import { planJsonImport, commitJsonImport } from '../sync/import-json';
import { useWallpaperSelection } from '../wallpaper/useWallpaperSelection';
const selectedWallpaper = useWallpaperSelection();
const progress = ref<WallpaperProgress>();
import { importWallpaper } from '../wallpaper/wallpaper-cache';
const props = defineProps<{ kind: 'templates' | 'widgets' | 'wallpapers' }>();
const emit = defineEmits<{ add: [kind: 'calendar' | 'weather' | 'note', size?: WidgetSize] }>();
const rows = ref<any[]>([]),
  busy = ref(false),
  applying = ref<string>(),
  error = ref(''),
  message = ref(''),
  chosen = ref<any>();
function wallpaperURLs(payload: any) {
  const original = new URL(payload?.url);
  if (
    original.origin !== new URL(import.meta.env.VITE_SYNC_URL).origin ||
    !/^\/catalog-assets\/[0-9a-f]{64}$/.test(original.pathname)
  )
    throw Error('壁纸地址无效');
  original.search = '';
  original.hash = '';
  const preview = new URL(payload?.preview_url || original.href);
  if (
    preview.origin !== original.origin ||
    preview.pathname !== original.pathname
  )
    throw Error('壁纸预览地址无效');
  preview.search = '?preview=1';
  preview.hash = '';
  return { original, preview };
}
async function load() {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const items = (await rpc('/api/v1/catalog/' + props.kind)).items;
    rows.value =
      props.kind === 'wallpapers'
        ? items.map((row: any) => {
            const { original, preview } = wallpaperURLs(row.payload);
            return {
              ...row,
              payload: {
                ...row.payload,
                url: original.href,
                preview_url: preview.href,
              },
            };
          })
        : items;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  } finally {
    busy.value = false;
  }
}
watch(
  () => props.kind,
  () => {
    chosen.value = undefined;
    void load();
  },
  { immediate: true },
);
async function apply(row: any) {
  if (busy.value) return;
  busy.value = true;
  applying.value = String(row.id);
  progress.value = undefined;
  error.value = '';
  try {
    if (props.kind === 'widgets') {
      const kind = row.payload?.type;
      if (!['calendar', 'weather', 'note'].includes(kind))
        throw Error('当前扩展暂不支持这个组件类型');
      const {minWidth=1,minHeight=1,maxWidth=9,maxHeight=8,width=3,height=2}=row.payload;
      emit('add', kind,{minWidth,minHeight,maxWidth,maxHeight,width,height});
    } else if (props.kind === 'templates') {
      if (row.payload?.format === 'duoyu-template') {
        row.requestId ??= crypto.randomUUID();
        await rpc('/api/v1/templates/' + row.id + '/apply', 'POST', {
          request_id: row.requestId,
        });
        await syncNow();
      } else {
        const plan = await planJsonImport(JSON.stringify(row.payload));
        await commitJsonImport(plan);
      }
      message.value = '模板已添加为新页面';
    } else {
      const { original: url } = wallpaperURLs(row.payload);
      const blob = await downloadWallpaper(
        url,
        (value) => (progress.value = value),
        { credentials: 'omit', redirect: 'error' },
      );
      await importWallpaper(blob, 'cloud:' + row.id);
      message.value = '';
    }
    chosen.value = undefined;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
    applying.value = undefined;
    progress.value = undefined;
  }
}
</script>
<template>
  <div class="cloud-catalog">
    <p v-if="error" role="alert">
      {{ error }} <button @click="load">重新加载</button>
    </p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="busy && kind !== 'wallpapers'">正在处理…</p>
    <div v-if="chosen" class="catalog-confirm">
      <strong>{{ chosen.name }}</strong>
      <p>{{ chosen.description }}</p>
      <p v-if="kind === 'templates'">模板会添加到新页面，保留现有收藏。</p>
      <button :disabled="busy" @click="apply(chosen)">
        {{ kind === 'templates' ? '确认导入' : '使用' }}</button
      ><button @click="chosen = undefined">取消</button>
    </div>
    <div
      class="store-card-grid"
      :class="
        kind === 'wallpapers' ? 'wallpaper-card-grid' : 'widget-card-grid'
      "
    >
      <button
        v-for="row in rows"
        :key="row.id"
        class="store-card glass-surface"
        :class="kind === 'wallpapers' ? 'wallpaper-card' : 'store-widget-card'"
        :disabled="busy"
        :aria-pressed="
          kind === 'wallpapers'
            ? selectedWallpaper === 'cloud:' + row.id
            : undefined
        "
        @click="kind === 'wallpapers' ? apply(row) : (chosen = row)"
      >
        <img
          v-if="kind === 'wallpapers'"
          :src="row.payload.preview_url"
          :alt="row.name"
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
        /><span v-else class="tool-symbol">{{
          kind === 'templates' ? '▤' : '▦'
        }}</span>
        <span v-if="kind === 'wallpapers'" class="wallpaper-caption"
          ><strong>{{ row.name }}</strong
          ><WallpaperDownloadProgress
            v-if="busy && applying === String(row.id)"
            :progress="progress"
          /><small v-else>{{ row.description }}</small></span
        >
        <strong v-else>{{ row.name }}</strong>
        <WallpaperSelectionMark
          :selected="
            kind === 'wallpapers' && selectedWallpaper === 'cloud:' + row.id
          "
        />
      </button>
    </div>
    <div
      v-if="kind === 'wallpapers'"
      class="wallpaper-load-status"
      aria-live="polite"
    >
      <span v-if="busy && applying === undefined">正在加载壁纸…</span>
    </div>
    <p v-if="!busy && !error && !rows.length">暂无已发布资源</p>
  </div>
</template>
<style scoped>
.catalog-confirm {
  padding: 18px;
  margin-bottom: 20px;
  border-radius: 12px;
  background: #ffffff24;
}
.catalog-confirm button {
  margin-right: 12px;
  padding: 8px 16px;
}
.cloud-catalog p {
  line-height: 1.7;
}
</style>
