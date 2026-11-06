<script setup lang="ts">
import { vAccountEdit } from '../auth/edit-access';
import WallpaperDownloadProgress from './WallpaperDownloadProgress.vue';
import type { WallpaperProgress } from './download-wallpaper';
import WallpaperSelectionMark from './WallpaperSelectionMark.vue';
import { ref, onUnmounted } from 'vue';
import { liveQuery } from 'dexie';
import { database } from '../../shared/storage/database';
import { getAsset } from '../sync/assets';
import { getDailyWallpaperUrl } from './wallpaper';
import {
  importWallpaper,
  selectDailyWallpaper,
  removeUploadedWallpaper,
} from './wallpaper-cache';
import { useWallpaperSelection } from './useWallpaperSelection';
const selected = useWallpaperSelection();
const input = ref<HTMLInputElement>();
const busy = ref(false);
const progress = ref<WallpaperProgress>();
const applying = ref<string>();
const error = ref('');
const previewError = ref('');
type Choice = { selection: string; blob?: Blob | string; contentHash?: string };
const store = ref<Choice>({ selection: 'daily' });
const upload = ref<Choice>();
const previews = ref({ store: '', upload: '' });
let generation = 0;
let urls: string[] = [];
const subscription = liveQuery(async () => ({
  store: (await database.preferences.get('savedWallpaper:store'))?.value as
    Choice | undefined,
  upload: (await database.preferences.get('savedWallpaper:upload'))?.value as
    Choice | undefined,
  current: await database.wallpapers.get('daily'),
  selection: (await database.preferences.get('wallpaperSelection'))?.value as
    string | undefined,
})).subscribe(async (value) => {
  const request = ++generation;
  const selection = value.current?.selection || value.selection || 'upload';
  const legacy = value.current?.sourceUrl.startsWith('local:')
    ? { selection, blob: value.current.blob }
    : undefined;
  store.value = value.store ||
    (legacy?.selection !== 'upload' ? legacy : undefined) || {
      selection: 'daily',
    };
  upload.value =
    value.upload || (legacy?.selection === 'upload' ? legacy : undefined);
  const owned: string[] = [];
  async function preview(choice?: Choice) {
    if (!choice) return '';
    if (choice.selection === 'daily') return getDailyWallpaperUrl();
    if (!choice.blob) return '';
    const blob =
      choice.blob instanceof Blob ? choice.blob : await getAsset(choice.blob);
    const url = URL.createObjectURL(blob);
    owned.push(url);
    return url;
  }
  const [a, b] = await Promise.allSettled([preview(store.value), preview(upload.value)]);
  if (request !== generation) {
    owned.forEach(URL.revokeObjectURL);
    return;
  }
  urls.forEach(URL.revokeObjectURL);
  urls = owned;
  previews.value = { store: a.status === 'fulfilled' ? a.value : '', upload: b.status === 'fulfilled' ? b.value : '' };
  previewError.value = a.status === 'rejected' || b.status === 'rejected' ? '壁纸预览暂未加载完成' : '';
});
onUnmounted(() => {
  generation++;
  subscription.unsubscribe();
  urls.forEach(URL.revokeObjectURL);
});
async function run(task: () => Promise<unknown>, selection?: string) {
  if (busy.value) return;
  busy.value = true;
  applying.value = selection;
  progress.value = undefined;
  error.value = '';
  try {
    await task();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '壁纸应用失败';
  } finally {
    busy.value = false;
    applying.value = undefined;
  }
}
async function apply(choice?: Choice) {
  if (!choice) {
    input.value?.click();
    return;
  }
  await run(async () => {
    if (choice.selection === 'daily')
      return selectDailyWallpaper((value) => (progress.value = value));
    if (!choice.blob) throw Error('壁纸图片尚未下载完成');
    const blob =
      choice.blob instanceof Blob ? choice.blob : await getAsset(choice.blob);
    progress.value = { loaded: blob.size, total: blob.size, complete: true };
    await importWallpaper(blob, choice.selection);
  }, choice.selection);
}
async function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file)
    await run(() => {
      progress.value = { loaded: file.size, total: file.size, complete: true };
      return importWallpaper(file);
    }, 'upload');
  (event.target as HTMLInputElement).value = '';
}
</script>
<template>
  <div class="my-wallpapers">
    <button
      class="store-card wallpaper-card"
      :disabled="busy"
      :aria-pressed="selected === store.selection"
      v-account-edit @click="apply(store)"
    >
      <img v-if="previews.store" :src="previews.store" alt="商店壁纸" />
      <WallpaperSelectionMark :selected="selected === store.selection" />
      <span class="wallpaper-caption"
        ><strong>商店壁纸</strong
        ><WallpaperDownloadProgress
          v-if="applying === store.selection"
          :progress="progress"
        />
        <small v-else>{{
          store.selection === 'daily'
            ? '每日壁纸'
            : store.selection.startsWith('bing:')
              ? '必应壁纸'
              : '精选壁纸'
        }}</small></span
      >
    </button>
    <div class="upload-card">
      <button
        class="store-card wallpaper-card"
        :disabled="busy"
        :aria-pressed="selected === 'upload'"
        v-account-edit @click="apply(upload)"
      >
        <img
          v-if="previews.upload"
          :src="previews.upload"
          alt="自定义上传壁纸"
        />
        <span v-else class="upload-empty"
          ><span>＋</span>上传壁纸<small>选择图片 · 最大 20 MB</small></span
        >
        <WallpaperSelectionMark :selected="!!upload && selected === 'upload'" />
        <span v-if="upload" class="wallpaper-caption"
          ><strong>自定义上传</strong></span
        >
      </button>
      <button
        v-if="upload"
        class="replace-upload"
        :disabled="busy"
        v-account-edit @click="input?.click()"
      >
        更换图片
      </button>
      <button
        v-if="upload"
        class="delete-upload"
        :disabled="busy"
        aria-label="删除上传图片"
        title="删除上传图片"
        v-account-edit @click="run(removeUploadedWallpaper)"
      >
        ×
      </button>
    </div>
  </div>
  <input ref="input" hidden type="file" accept="image/*" @change="choose" />
  <p v-if="error || previewError" role="alert">{{ error || previewError }}</p>
</template>
<style scoped>
.my-wallpapers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.wallpaper-card {
  width: 100%;
  background: #f5f5f7;
}
.upload-card {
  position: relative;
  min-width: 0;
}
.upload-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #555;
  font-size: 13px;
}
.upload-empty > span {
  font-size: 30px;
}
.upload-empty small {
  color: #999;
  font-size: 11px;
}
.replace-upload {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  color: white;
  background: #0006;
  cursor: pointer;
}
</style>

<style scoped>
.delete-upload {
  position: absolute;
  top: 10px;
  left: 10px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: #0006;
  color: white;
  cursor: pointer;
  font-size: 20px;
}
</style>
