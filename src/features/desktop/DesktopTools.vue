<script setup lang="ts">
import { getSyncPreference, setSyncPreference } from '../sync/client';
import { accountStorage } from '../../shared/storage/account';
import { computed, ref, watch, onUnmounted } from 'vue';
import { liveQuery } from 'dexie';
import { browser } from 'wxt/browser';
import StoreLayout from '../../shared/components/base/StoreLayout.vue';
import CloudCatalog from './CloudCatalog.vue';
import BingWallpaperGallery from '../wallpaper/BingWallpaperGallery.vue';
import './store-cards.css';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
import { database, type LibraryItem } from '../../shared/storage/database';
import { getDailyWallpaperUrl } from '../wallpaper/wallpaper';
import {
  importWallpaper,
  removeUploadedWallpaper,
} from '../wallpaper/wallpaper-cache';
import { backupDesktop } from './desktop-backup';
const props = defineProps<{
  tool: '' | 'widgets' | 'wallpaper' | 'search' | 'settings';
  automatic: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  close: [];
  add: [kind: 'calendar' | 'weather' | 'note'];
  folder: [];
  layout: [value: boolean];
}>();
const title = computed(
  () =>
    ({
      widgets: '组件商店',
      wallpaper: '壁纸商店',
      search: '图标搜索',
      settings: '设置',
    })[props.tool || 'settings'],
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
const message = ref('');
const query = ref('');
const items = ref<LibraryItem[]>([]);
const glass = ref('real');
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
    glass.value = String((await getSyncPreference('glassMode')) || 'real');
  },
);
async function run(action: () => Promise<unknown>) {
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
      message.value = '壁纸已应用';
    });
  (event.target as HTMLInputElement).value = '';
}
async function daily() {
  accountStorage.removeItem('duoyu-wallpaper-mode');
  window.dispatchEvent(new Event('duoyu-wallpaper-change'));
  message.value = '已切换为每日壁纸';
}
function saveGlass() {
  void run(() => setSyncPreference('glassMode', glass.value));
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
    await run(() => browser.tabs.create({ url: item.url }));
  else selected.value = item;
}
</script>
<template>
  <BaseDialog
    :open="!!tool"
    :title="title"
    :width="store ? 1160 : undefined"
    :aspect-ratio="store ? 4 / 3 : undefined"
    @update:open="emit('close')"
  >
    <div class="desktop-tools" :class="{ 'store-tools': store }">
      <StoreLayout
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
          @add="(kind) => emit('add', kind)"
        />
        <div v-else class="store-card-grid widget-card-grid">
          <button
            v-for="widget in filteredWidgets"
            :key="widget.kind"
            class="store-card store-widget-card glass-surface glass-interactive"
            :title="widget.description"
            @click="emit('add', widget.kind)"
          >
            <span class="tool-symbol">{{ widget.icon }}</span
            ><strong>{{ widget.name }}</strong>
          </button>
          <button
            v-if="widgetCategory !== 'daily'"
            class="store-card store-widget-card glass-surface glass-interactive"
            @click="emit('folder')"
          >
            <span class="tool-symbol">▣</span><strong>新建文件夹</strong>
          </button>
        </div>
      </StoreLayout>
      <StoreLayout
        v-if="tool === 'wallpaper'"
        v-model="wallpaperCategory"
        :menus="[
          { id: 'daily', name: '每日壁纸' },
          { id: 'bing', name: '必应壁纸' },
          { id: 'local', name: '本地壁纸' },
          { id: 'cloud', name: '精选壁纸' },
        ]"
      >
        <CloudCatalog v-if="wallpaperCategory === 'cloud'" kind="wallpapers" />
        <BingWallpaperGallery v-else-if="wallpaperCategory === 'bing'" />
        <div v-else class="store-card-grid wallpaper-card-grid">
          <button
            v-if="wallpaperCategory === 'daily'"
            class="store-card wallpaper-card glass-surface"
            @click="daily"
          >
            <img
              v-if="!todayFailed"
              :src="todayWallpaper"
              alt="今日必应壁纸"
              referrerpolicy="no-referrer"
              @error="todayFailed = true"
            />
            <span v-else class="daily-preview-error">今日预览加载失败</span>
            <span class="wallpaper-caption"
              ><strong>每日壁纸</strong><small>每天自动更新</small></span
            >
          </button>
          <template v-else>
            <div
              class="store-card wallpaper-card wallpaper-preview glass-surface"
            >
              <span class="wallpaper-caption"><strong>当前壁纸</strong></span>
              <button
                v-if="hasUploadedWallpaper"
                type="button"
                class="wallpaper-remove-upload glass-control glass-interactive"
                :disabled="busy"
                @click.stop="
                  run(async () => {
                    await removeUploadedWallpaper();
                    message = '本地壁纸已删除，云端将在同步后释放未使用的图片';
                  })
                "
              >
                删除上传图片
              </button>
            </div>
            <button
              class="store-card wallpaper-card wallpaper-upload glass-surface glass-interactive"
              :disabled="busy"
              @click="uploadInput?.click()"
            >
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path d="M16 21V5m-6 6 6-6 6 6M6 21v6h20v-6" />
              </svg>
              <strong>{{ busy ? '正在导入…' : '导入本地壁纸' }}</strong>
              <small>选择图片 · 最大 20 MB</small>
            </button>
            <input
              ref="uploadInput"
              class="wallpaper-file-input"
              aria-label="导入壁纸"
              type="file"
              accept="image/*"
              :disabled="busy"
              @change="upload"
            />
          </template>
        </div>
      </StoreLayout>
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
      <template v-if="tool === 'settings'">
        <label
          >当前页面布局<select
            :value="automatic ? 'auto' : 'free'"
            @change="
              emit(
                'layout',
                ($event.target as HTMLSelectElement).value === 'auto',
              )
            "
          >
            <option value="free">自由布局</option>
            <option value="auto">自动布局</option>
          </select></label
        >
        <label
          >玻璃效果<select v-model="glass" @change="saveGlass">
            <option value="real">真实</option>
            <option value="natural">自然</option>
            <option value="soft">柔和</option>
          </select></label
        >
        <button
          class="tool-entry glass-control glass-interactive"
          :disabled="busy"
          @click="run(backupDesktop)"
        >
          立即备份
        </button>
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
