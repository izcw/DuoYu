<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import { database } from '../../shared/storage/database';
import type { SyncConflict } from './capture';
import type { Entity } from './model';
import {
  conflictChanges,
  conflictReasons,
  discardConflict,
  retryConflict,
  fieldLabels,
  conflictValue,
} from './conflicts';
import { formatSyncTime, syncNow } from './client';
import ConflictDesktopPreview from './ConflictDesktopPreview.vue';
import {
  previewVersion,
  previewPages,
  previewDefaultPage,
  prepareLocalPreview,
  previewResolutionChanges,
} from './conflict-preview';
const open = defineModel<boolean>({ default: false });
const records = ref<SyncConflict[]>([]),
  shadow = ref<Entity[]>([]),
  selected = ref(''),
  busy = ref(false),
  error = ref(''),
  message = ref(''),
  view = ref('page:home'),
  zoom = ref(1);
let subscription: ReturnType<ReturnType<typeof liveQuery>['subscribe']>;
onMounted(() => {
  subscription = liveQuery(async () => ({
    records: await database.syncConflicts
      .orderBy('createdAt')
      .reverse()
      .toArray(),
    shadow: await database.syncShadow.toArray(),
  })).subscribe((value) => {
    records.value = value.records.filter((r) => !r.resolvedAt);
    shadow.value = value.shadow.map((e) => ({
      table: e.table,
      id: e.entityId,
      payload: e.payload as Record<string, any>,
      revision: e.revision,
      deleted: e.deleted,
    }));
    if (!records.value.some((r) => r.id === selected.value))
      selected.value = records.value[0]?.id || '';
  });
});
onUnmounted(() => subscription?.unsubscribe());
const current = computed(() =>
  records.value.find((r) => r.id === selected.value),
);
const changes = computed(() =>
  current.value ? conflictChanges(current.value) : [],
);
const localLayout = computed(() =>
  prepareLocalPreview(shadow.value, changes.value),
);
const local = computed(() => localLayout.value.entities),
  cloud = computed(() => previewVersion(shadow.value, changes.value, false));
const pages = computed(() => previewPages([local.value, cloud.value]));
watch(selected, () => {
  view.value = previewDefaultPage(changes.value);
  zoom.value = 1;
  error.value = '';
  message.value = '';
});
watch(pages, () => {
  if (!pages.value.some((p) => p.id === view.value))
    view.value = pages.value[0]?.id || 'page:home';
});
function name(record: SyncConflict) {
  const first = conflictChanges(record)[0];
  return (
    first?.value?.name ||
    first?.base?.name ||
    first?.value?.title ||
    first?.base?.title ||
    (first?.table === 'wallpapers'
      ? '壁纸更改'
      : first?.table === 'preferences'
        ? '桌面设置'
        : '一组更改')
  );
}
function versionLabel(entities: Entity[]) {
  return (
    previewPages([entities]).find((p) => p.id === view.value)?.name ||
    '此版本没有该区域'
  );
}
const settings = computed(() =>
  changes.value
    .filter((c) => c.table === 'preferences')
    .map((c) => ({
      id: c.id,
      label:
        (
          {
            glassMode: '玻璃材质',
            wallpaperMode: '壁纸模式',
            searchEngine: '搜索引擎',
            dockOrder: 'Dock 顺序',
          } as Record<string, string>
        )[c.id] ||
        fieldLabels[c.id] ||
        '布局设置',
      local: conflictValue(c.value?.value),
      cloud: conflictValue(
        cloud.value.find((e) => e.table === 'preferences' && e.id === c.id)
          ?.payload.value,
      ),
    })),
);
async function run(action: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await action();
    message.value = '处理结果已保存，将继续自动同步。';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '处理失败';
  } finally {
    busy.value = false;
  }
}
async function apply(side: 'local' | 'cloud') {
  if (side === 'local' && localLayout.value.overflow) return;
  const record = current.value;
  if (!record) return;
  const map = new Map(
    shadow.value.map((e) => [e.table + ':' + e.id, e.revision]),
  );
  const resolved =
    side === 'local'
      ? previewResolutionChanges(shadow.value, changes.value, local.value)
      : changes.value;
  const expected = Object.fromEntries(
    resolved.map((c) => [
      c.table + ':' + c.id,
      map.get(c.table + ':' + c.id) ?? '0',
    ]),
  );
  await run(() =>
    side === 'local'
      ? retryConflict(record.id, {}, expected, true, resolved)
      : discardConflict(record.id, expected),
  );
}
</script>
<template>
  <BaseDialog
    v-model:open="open"
    title="处理同步更改"
    :width="1480"
    solid
    close-button
    ><div class="conflict-content">
      <div class="conflict-heading">
        <p>左右预览这组更改，选择要应用的版本。</p>
        <button class="secondary" :disabled="busy" @click="run(syncNow)">
          刷新预览
        </button>
      </div>
      <div v-if="records.length" class="conflict-layout">
        <aside class="conflict-list" aria-label="待处理更改">
          <button
            v-for="record in records"
            :key="record.id"
            :class="{ selected: selected === record.id }"
            :aria-pressed="selected === record.id"
            :disabled="busy"
            @click="selected = record.id"
          >
            <strong>{{ name(record) }}</strong
            ><span>{{ formatSyncTime(record.createdAt) }}</span
            ><small>{{ conflictChanges(record).length }} 项更改</small>
          </button>
        </aside>
        <section v-if="current" class="comparison">
          <div class="comparison-info">
            <p>
              {{
                conflictReasons[current.reason] ||
                '这组更改暂未被云端接受，请预览后选择版本。'
              }}
            </p>
            <div class="preview-controls">
              <label
                >预览页面<select v-model="view" aria-label="预览页面">
                  <option v-for="page in pages" :key="page.id" :value="page.id">
                    {{ page.name }}
                  </option>
                </select></label
              ><label
                >缩放<select v-model.number="zoom" aria-label="缩放">
                  <option :value="1">适应窗口</option>
                  <option :value="2">放大 2 倍</option>
                  <option :value="3">放大 3 倍</option>
                </select></label
              >
            </div>
          </div>
          <div class="version-panels">
            <article
              v-for="side in ['local', 'cloud'] as const"
              :key="side"
              class="version-panel"
              :data-version="side"
            >
              <header>
                <span
                  class="version-dot"
                  :class="{ 'cloud-dot': side === 'cloud' }"
                />
                <h3>{{ side === 'local' ? '本机版本' : '云端版本' }}</h3>
                <small>{{
                  side === 'local'
                    ? changes.length + ' 项更改'
                    : '当前已同步数据'
                }}</small>
              </header>
              <div class="version-location">
                {{ versionLabel(side === 'local' ? local : cloud) }}
              </div>
              <ConflictDesktopPreview
                :entities="side === 'local' ? local : cloud"
                :view="view"
                :zoom="zoom"
              />
              <div v-if="settings.length" class="version-settings">
                <p v-for="setting in settings" :key="setting.id">
                  <span>{{ setting.label }}</span
                  >{{ setting[side] }}
                </p>
              </div>
              <footer>
                <span v-if="current.state === 'resolving'"
                  >正在同步处理结果</span
                ><button
                  class="apply-version"
                  :disabled="
                    busy ||
                    current.state === 'resolving' ||
                    (side === 'local' && localLayout.overflow > 0)
                  "
                  @click="apply(side)"
                >
                  {{ side === 'local' ? '应用本机版本' : '应用云端版本' }}
                </button>
              </footer>
            </article>
          </div>
          <p class="preview-note">
            <template v-if="localLayout.overflow"
              >本机版本布局空间不足，暂时无法应用。</template
            >
            预览使用桌面原有网格与材质。未涉及的更改继续保留，预览不会改动数据。
          </p>
        </section>
      </div>
      <div v-else class="empty">
        <span>✓</span><strong>更改已处理</strong>
        <p>没有需要处理的更改。</p>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="message" class="success" role="status">{{ message }}</p>
    </div></BaseDialog
  >
</template>
<style scoped>
.conflict-content {
  color: #222;
  padding-bottom: 10px;
}
.conflict-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.conflict-heading p,
.comparison-info > p {
  margin: 0;
  font-size: 13px;
  color: #727782;
  line-height: 1.7;
}
.conflict-layout {
  display: grid;
  grid-template-columns: 164px minmax(0, 1fr);
  gap: 22px;
}
.conflict-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 620px;
  overflow: auto;
}
.conflict-list button {
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  text-align: left;
  padding: 14px 12px;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}
.conflict-list button.selected {
  background: #f5f5f7;
}
.conflict-list strong {
  font-size: 13px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conflict-list span,
.conflict-list small {
  font-size: 11px;
  color: #82858e;
}
.comparison {
  min-width: 0;
}
.comparison-info {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}
.preview-controls {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
.preview-controls label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #727782;
}
.preview-controls select {
  background: #f5f5f7;
  border: 0;
  border-radius: 6px;
  height: 34px;
  padding: 0 10px;
  color: #222;
  max-width: 220px;
  font-size: 12px;
}
.version-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.version-panel {
  border: 1px solid #ececef;
  border-radius: 12px;
  overflow: hidden;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.version-panel > header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 16px;
}
.version-panel h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.version-location {
  padding: 0 16px 12px;
  color: #82858e;
  font-size: 12px;
}
.version-panel header small {
  font-size: 11px;
  color: #939aa5;
  margin-left: auto;
}
.version-dot {
  width: 7px;
  height: 7px;
  background: #222;
  border-radius: 50%;
}
.cloud-dot {
  background: #939aa5;
}
.version-panel > footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 16px;
  margin-top: auto;
  min-height: 68px;
}
.version-panel footer span {
  font-size: 11px;
  color: #82858e;
}
.apply-version,
.secondary {
  white-space: nowrap;
  flex-shrink: 0;
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.apply-version {
  background: #111;
  color: white;
}
.secondary {
  background: #f5f5f7;
  color: #444;
}
.version-settings {
  padding: 12px 16px;
  font-size: 12px;
  max-height: 100px;
  overflow: auto;
}
.version-settings p {
  display: flex;
  gap: 12px;
  margin: 4px 0;
  overflow-wrap: anywhere;
}
.version-settings span {
  color: #82858e;
  flex-shrink: 0;
}
.preview-note {
  font-size: 11px;
  color: #939aa5;
  line-height: 1.7;
  margin: 14px 0 0;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 50px 0;
  color: #727782;
}
.empty > span {
  font-size: 25px;
  background: #f5f5f7;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #222;
}
.empty strong {
  font-size: 15px;
  color: #222;
}
.empty p {
  font-size: 13px;
  margin: 0;
}
.error,
.success {
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
  margin: 14px 0 0;
}
.error {
  background: #fff3f1;
  color: #a13c30;
}
.success {
  background: #f5f5f7;
  color: #52725a;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button:not(:disabled):hover {
  opacity: 0.7;
}
@media (max-width: 980px) {
  .conflict-layout {
    grid-template-columns: 1fr;
  }
  .conflict-list {
    flex-direction: row;
    max-height: none;
    overflow: auto;
  }
  .conflict-list button {
    min-width: 160px;
  }
  .version-panels {
    gap: 12px;
  }
}
@media (max-width: 660px) {
  .version-panels {
    grid-template-columns: 1fr;
  }
  .conflict-heading {
    align-items: flex-start;
  }
  .preview-controls {
    gap: 10px;
  }
  .preview-controls select {
    max-width: 170px;
  }
}
</style>
