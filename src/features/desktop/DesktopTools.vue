<script setup lang="ts">
import type {WidgetSize} from "../../shared/storage/database";
import WallpaperDownloadProgress from '../wallpaper/WallpaperDownloadProgress.vue';
import type { WallpaperProgress } from '../wallpaper/download-wallpaper';
import WallpaperSelectionMark from '../wallpaper/WallpaperSelectionMark.vue';
import { useWallpaperSelection } from '../wallpaper/useWallpaperSelection';
const selectedWallpaper = useWallpaperSelection();
import { computed, ref, watch, onUnmounted } from 'vue';
import { liveQuery } from 'dexie';
import { openWebTab } from '../../shared/open-web-tab';
import DialogLayout from '../../shared/components/base/DialogLayout.vue';
import CloudCatalog from './CloudCatalog.vue';
import MyWallpapers from '../wallpaper/MyWallpapers.vue';
import BingWallpaperGallery from '../wallpaper/BingWallpaperGallery.vue';
import './store-cards.css';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
import { database, type LibraryItem } from '../../shared/storage/database';
import { getDailyWallpaperUrl } from '../wallpaper/wallpaper';
import {
  importWallpaper,
  selectDailyWallpaper,
  removeUploadedWallpaper,
} from '../wallpaper/wallpaper-cache';
const props = defineProps<{
  tool: '' | 'widgets' | 'wallpaper' | 'search';
  automatic: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  close: [];
  add: [kind: 'calendar' | 'weather' | 'note', size?: WidgetSize];
  folder: [];
  layout: [value: boolean];
}>();
const title = computed(
  () =>
    ({
      widgets: '组件商店',
      wallpaper: '壁纸商店',
      search: '图标搜索',
    })[props.tool || 'search'],
);
const widgets = [
  { kind: 'calendar', icon: '▦', name: '日历', description: '查看本月日期' },
  {
    kind: 'weather',
    icon: '☀',
    name: '天气',
    description: '示例天气，暂未接入实时数据',
  },
  { kind: 'note', icon: '✎', name: '便签', description: '随手记下想法' },
] as const;
const widgetCategory = ref('all');
const wallpaperCategory = ref('daily');
const todayWallpaper = ref(getDailyWallpaperUrl());
const todayFailed = ref(false);
const uploadInput = ref<HTMLInputElement>();
const hasUploadedWallpaper = ref(false);
const wallpaperSubscription = liveQuery(() =>
  database.wallpapers.get('daily'),
).subscribe((row) => {
  hasUploadedWallpaper.value = !!row?.sourceUrl.startsWith('local:');
});
onUnmounted(() => wallpaperSubscription.unsubscribe());
const store = computed(
  () => props.tool === 'widgets' || props.tool === 'wallpaper',
);
const filteredWidgets = computed(() =>
  widgets.filter(
    (widget) =>
      widgetCategory.value === 'all' ||
      (widgetCategory.value === 'daily'
        ? widget.kind !== 'note'
        : widget.kind === 'note'),
  ),
);
const busy = ref(false);
const progress = ref<WallpaperProgress>();
const message = ref('');
const query = ref('');
const items = ref<LibraryItem[]>([]);
const subscription = liveQuery(() => database.libraryItems.toArray()).subscribe(
  (value) => (items.value = value),
);
onUnmounted(() => subscription.unsubscribe());
const results = computed(() =>
  items.value.filter((item) =>
    (item.name + ' ' + item.url)
      .toLowerCase()
      .includes(query.value.trim().toLowerCase()),
  ),
);
watch(
  () => props.tool,
  async () => {
    message.value = '';
    query.value = '';
    widgetCategory.value = 'all';
    wallpaperCategory.value = 'daily';
    todayWallpaper.value = getDailyWallpaperUrl();
    todayFailed.value = false;
  },
);
async function run(action: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  message.value = '';
  try {
    await action();
  } catch (error) {
    message.value = error instanceof Error ? error.message : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file)
    await run(async () => {
      await importWallpaper(file);
      message.value = '';
    });
  (event.target as HTMLInputElement).value = '';
}
async function daily() {
  progress.value = undefined;
  await selectDailyWallpaper((value) => (progress.value = value));
  message.value = '';
}
const selected = ref<LibraryItem>();
watch(
  () => props.tool,
  () => {
    selected.value = undefined;
  },
);
async function open(item: LibraryItem) {
  if (item.kind === 'link')
    await run(() => openWebTab(item.url));
  else selected.value = item;
}
</script>
<template>
  <BaseDialog
    :open="!!tool"
    :title="title"
    :width="store ? 1160 : undefined"
    :height="store ? 760 : undefined"
    solid
    close-button
    @update:open="emit('close')"
  >
    <div class="desktop-tools" :class="{ 'store-tools': store }">
      <DialogLayout
        v-if="tool === 'widgets'"
        v-model="widgetCategory"
        :menus="[
          { id: 'all', name: '全部组件' },
          { id: 'daily', name: '日常生活' },
          { id: 'tools', name: '效率工具' },
          { id: 'cloud', name: '已发布组件' },
          { id: 'templates', name: '页面模板' },
        ]"
      >
        <CloudCatalog
          v-if="widgetCategory === 'cloud' || widgetCategory === 'templates'"
          :kind="widgetCategory === 'cloud' ? 'widgets' : 'templates'"
          @add="(kind,size) => emit('add', kind,size)"
        />
        <div v-else class="store-card-grid widget-card-grid">
          <button
            v-for="widget in filteredWidgets"
            :key="widget.kind"
            class="store-card store-widget-card"
            :title="widget.description"
            @click="emit('add', widget.kind)"
          >
            <span class="tool-symbol">{{ widget.icon }}</span
            ><strong>{{ widget.name }}</strong>
          </button>
          <button
            v-if="widgetCategory !== 'daily'"
            class="store-card store-widget-card"
            @click="emit('folder')"
          >
            <span class="tool-symbol">▣</span><strong>新建文件夹</strong>
          </button>
        </div>
      </DialogLayout>
      <DialogLayout
        v-if="tool === 'wallpaper'"
        v-model="wallpaperCategory"
        :menus="[
          { id: 'daily', name: '每日壁纸', icon: 'Sun' },
          { id: 'bing', name: '必应', icon: 'Picture' },
          { id: 'cloud', name: '精选', icon: 'Star' },
          { id: 'local', name: '我的壁纸', icon: 'Folder' },
        ]"
      >
        <CloudCatalog v-if="wallpaperCategory === 'cloud'" kind="wallpapers" />
        <KeepAlive>
          <BingWallpaperGallery v-if="wallpaperCategory === 'bing'" />
        </KeepAlive>
        <div
          v-if="wallpaperCategory === 'daily'"
          class="store-card-grid wallpaper-card-grid"
        >
          <button
            v-if="wallpaperCategory === 'daily'"
            class="store-card wallpaper-card glass-surface"
            :aria-pressed="selectedWallpaper === 'daily'"
            :disabled="busy"
            @click="run(daily)"
          >
            <img
              v-if="!todayFailed"
              :src="todayWallpaper"
              alt="今日必应壁纸"
              referrerpolicy="no-referrer"
              @error="todayFailed = true"
            />
            <span v-else class="daily-preview-error">今日预览加载失败</span>
            <WallpaperSelectionMark :selected="selectedWallpaper === 'daily'" />
            <span class="wallpaper-caption"
              ><strong>每日壁纸</strong
              ><WallpaperDownloadProgress
                v-if="busy"
                :progress="progress"
              /><small v-else>每天自动更新</small></span
            >
          </button>
        </div>
        <MyWallpapers v-if="wallpaperCategory === 'local'" />
      </DialogLayout>
      <template v-if="tool === 'search'">
        <input
          v-model="query"
          aria-label="搜索图标和组件"
          placeholder="搜索网址、文件夹、组件"
          type="search"
        />
        <div class="tool-results">
          <button
            v-for="item in results"
            :key="item.id"
            class="tool-entry glass-control glass-interactive"
            @click="open(item)"
          >
            <WorkspaceFavicon
              :src="item.icon"
              :page-url="item.url"
              :title="item.name"
            /><span
              >{{ item.name
              }}<small>{{
                item.kind === 'folder'
                  ? '文件夹'
                  : item.kind === 'widget'
                    ? '组件'
                    : item.url
              }}</small></span
            >
          </button>
          <p v-if="!results.length">没有找到匹配项目</p>
        </div>
        <div v-if="selected" class="tool-detail">
          <strong>{{ selected.name }}</strong>
          <template v-if="selected.kind === 'folder'"
            ><button
              v-for="child in items.filter((i) => i.parent === selected?.id)"
              :key="child.id"
              class="tool-entry glass-control glass-interactive"
              @click="open(child)"
            >
              {{ child.name }}
            </button></template
          >
          <p v-else>
            {{
              selected.widget === 'note'
                ? selected.text || '这张便签还没有内容'
                : selected.widget === 'calendar'
                  ? new Date().toLocaleDateString()
                  : '天气示例 · 24° 晴'
            }}
          </p>
        </div>
      </template>
      <p v-if="message" role="status">{{ message }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
    </div>
  </BaseDialog>
</template>
<style scoped>
.desktop-tools {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.store-tools {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.wallpaper-file-input {
  display: none;
}
.wallpaper-upload {
  gap: 8px;
  background: rgb(255 255 255 / 10%);
  transition: background 160ms ease;
}
.wallpaper-upload:hover {
  background: rgb(255 255 255 / 19%);
}
.wallpaper-upload svg {
  width: 32px;
  height: 32px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.85;
}
.wallpaper-upload strong {
  font-size: 13px;
  font-weight: 500;
}
.wallpaper-upload small,
.daily-preview-error {
  font-size: 11px;
  opacity: 0.65;
}
.tool-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 0;
  border-radius: 12px;
  color: inherit;
  text-align: left;
  width: 100%;
  cursor: pointer;
}
.tool-entry > span:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.tool-entry small {
  display: block;
  font-size: 11px;
  opacity: 0.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 5px;
}
.store-widget-card {
  background: #f5f5f7;
  color: #222;
}
.store-widget-card:hover {
  background: #ededf1;
}
.tool-symbol {
  font-size: 26px;
  width: 32px;
  text-align: center;
}
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
input,
select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid rgb(239 239 237 / 20%);
  border-radius: 10px;
  background: rgb(239 239 237 / 10%);
  color: inherit;
}
select option {
  color: #222;
}
.tool-results {
  max-height: 40vh;
  overflow: auto;
}
.wallpaper-preview {
  flex-shrink: 0;
  background-image: var(--desktop-wallpaper-image);
  background-size: cover;
  background-position: center;
  border-radius: 14px;
}
</style>

<style scoped>
.wallpaper-remove-upload {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  color: #fff;
  background: rgba(0, 0, 0, 0.35);
  font-size: 12px;
  z-index: 2;
}
.wallpaper-remove-upload:hover {
  background: rgba(0, 0, 0, 0.5);
}
</style>
