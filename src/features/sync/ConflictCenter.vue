<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import PageIcon from '../../shared/components/base/PageIcon.vue';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import { database } from '../../shared/storage/database';
import type { SyncConflict } from './capture';
import type { Entity } from './model';
import {
  conflictChanges,
  discardConflict,
  retryConflict,
  fieldLabels,
  conflictValue,
} from './conflicts';
import { formatSyncTime, syncNow } from './client';
import ConflictDesktopPreview from './ConflictDesktopPreview.vue';
import {
  groupPreviewMenus,
  previewVersion,
  previewPages,
  previewConflictViews,
  prepareLocalPreview,
  previewResolutionChanges,
} from './conflict-preview';
const open = defineModel<boolean>({ default: false });
const records = ref<SyncConflict[]>([]),
  shadow = ref<Entity[]>([]),
  selected = ref(''),
  busy = ref(false),
  error = ref(''),
  message = ref('');
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
  });
});
onUnmounted(() => subscription?.unsubscribe());
const groups = computed(() =>
  groupPreviewMenus(records.value, conflictChanges, shadow.value),
);
watch(
  groups,
  (value) => {
    if (!value.some((group) => group.id === selected.value))
      selected.value = value[0]?.id || '';
  },
  { immediate: true },
);
const current = computed(() =>
  groups.value.find((group) => group.id === selected.value),
);
const changes = computed(() => current.value?.changes ?? []);
const resolving = computed(() =>
  current.value?.records.some((record) => record.state === 'resolving'),
);
const localLayout = computed(() =>
  prepareLocalPreview(shadow.value, changes.value),
);
const local = computed(() => localLayout.value.entities),
  cloud = computed(() => previewVersion(shadow.value, changes.value, false));
const views = computed(() =>
  previewConflictViews(changes.value, [local.value, cloud.value]),
);
const highlightedIds = computed(() => changes.value.map((change) => change.id));
watch(selected, () => {
  error.value = '';
  message.value = '';
});
function menuIcon(menu: string) {
  if (menu === 'page:home') return 'Home';
  if (menu === 'page:__dock') return 'Computer';
  const id = menu.slice(menu.indexOf(':') + 1);
  const changed = records.value
    .flatMap(conflictChanges)
    .find((c) => c.table === 'libraryPages' && c.id === id);
  return (
    changed?.value?.icon ||
    shadow.value.find((e) => e.table === 'libraryPages' && e.id === id)?.payload
      .icon ||
    'Bookmark'
  );
}
function versionLabel(entities: Entity[], view: string) {
  return (
    previewPages([entities]).find((p) => p.id === view)?.name ||
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
  if (busy.value) return;
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
  const group = current.value;
  if (!group || busy.value || resolving.value) return;
  const members = [...group.records].reverse();
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
  await run(async () => {
    if (side === 'local') {
      // Stage the complete menu version durably before acknowledging redundant records.
      // A failed upload remains in the outbox (or a new conflict), never only in this UI.
      await retryConflict(members[0]!.id, {}, expected, true, resolved);
      for (const record of members.slice(1)) await discardConflict(record.id);
    } else {
      for (const record of members) await discardConflict(record.id, expected);
    }
  });
}
</script>
<template>
  <BaseDialog
    v-model:open="open"
    title="处理同步更改"
    :width="1680"
    :height="940"
    solid
    close-button
    ><div class="conflict-content">
      <div class="conflict-heading">
        <span class="menu-summary">{{ groups.length }} 个待处理菜单</span>
        <button class="secondary" :disabled="busy" @click="run(syncNow)">
          刷新预览
        </button>
      </div>
      <div v-if="records.length" class="conflict-layout">
        <aside class="conflict-list" aria-label="冲突菜单">
          <button
            v-for="group in groups"
            :key="group.id"
            :class="{ selected: selected === group.id }"
            :aria-pressed="selected === group.id"
            :disabled="busy"
            @click="selected = group.id"
          >
            <div class="menu-title">
              <PageIcon
                v-for="menu in group.menus"
                :key="menu"
                :name="menuIcon(menu)"
                :size="22"
                :active="selected === group.id"
              />
              <strong>{{ group.name }}</strong>
            </div>
            <span>{{ group.changes.length }} 个冲突项</span>
            <small>{{ formatSyncTime(group.records.at(-1)!.createdAt) }}</small>
          </button>
        </aside>
        <section v-if="current" class="comparison">
          <div class="comparison-info">
            <strong>{{ current.name }}</strong>
            <span class="frame-legend"><i />{{ changes.length }} 个冲突项</span>
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
              <template v-for="view in views" :key="view">
                <div class="version-location">
                  {{ versionLabel(side === 'local' ? local : cloud, view) }}
                </div>
                <ConflictDesktopPreview
                  :entities="side === 'local' ? local : cloud"
                  :view="view"
                  :highlight-ids="highlightedIds"
                  :highlight-region="
                    changes.some(
                      (c) =>
                        c.table === 'wallpapers' ||
                        c.table === 'preferences' ||
                        (c.table === 'libraryPages' && view === 'page:' + c.id),
                    )
                  "
                />
              </template>
              <div v-if="settings.length" class="version-settings">
                <p v-for="setting in settings" :key="setting.id">
                  <span>{{ setting.label }}</span
                  >{{ setting[side] }}
                </p>
              </div>
              <footer>
                <span v-if="resolving">正在同步处理结果</span
                ><button
                  class="apply-version"
                  :disabled="
                    busy ||
                    resolving ||
                    (side === 'local' && localLayout.overflow > 0)
                  "
                  @click="apply(side)"
                >
                  {{ side === 'local' ? '应用本机版本' : '应用云端版本' }}
                </button>
              </footer>
            </article>
          </div>
          <p v-if="localLayout.overflow" class="preview-note">
            本机版本布局空间不足，暂时无法应用。
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
  border-color: #e4e7ed;
}
.menu-title {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}
.menu-title strong {
  flex: 1;
}
.menu-summary {
  font-size: 13px;
  color: #82858e;
}
.frame-legend {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #82858e;
}
.frame-legend i {
  width: 12px;
  height: 12px;
  border: 2px solid #feb43f;
  border-radius: 3px;
}
.conflict-list button {
  border: 1px solid transparent;
  border-radius: 12px;
  transition: background 0.15s;
}
.conflict-list button:hover {
  background: #fafafa;
}
.conflict-list button.selected span {
  color: #a56412;
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
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  font-size: 14px;
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
}
</style>
