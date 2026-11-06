<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { liveQuery } from 'dexie';
import PageIcon from '../../shared/components/base/PageIcon.vue';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import { database } from '../../shared/storage/database';
import type { SyncConflict } from './capture';
import type { Entity } from './model';
import { conflictChanges, discardConflicts, retryConflict } from './conflicts';
import { formatSyncTime, syncNow, refreshConflictPreview } from './client';
import ConflictDesktopPreview from './ConflictDesktopPreview.vue';
import {
  groupPreviewMenus,
  previewVersion,
  previewPages,
  previewConflictViews,
  prepareLocalPreview,
  previewResolutionChanges,
} from './conflict-preview';
const open = defineModel<boolean>('open', { default: false });
const records = ref<SyncConflict[]>([]),
  shadow = ref<Entity[]>([]),
  selected = ref(''),
  busy = ref(false),
  latestReady = ref(false),
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
const chosenView = ref('');
watch(selected, () => {
  chosenView.value = '';
});
const view = computed(() =>
  views.value.includes(chosenView.value)
    ? chosenView.value
    : (views.value[0] ?? ''),
);
const highlightedIds = computed(() =>
  changes.value.flatMap((c) => [
    c.id,
    ...(c.table === 'tabCollections' ? ['preview-group-' + c.id] : []),
    ...(c.table === 'savedTabs'
      ? [c.value?.collectionId, c.base?.collectionId]
          .filter(Boolean)
          .map((id) => 'preview-group-' + id)
      : []),
  ]),
);
watch(selected, () => {
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
watch(
  open,
  async (value) => {
    latestReady.value = false;
    if (value) await refreshLatest();
  },
  { immediate: true },
);
async function readLatest(remote = true) {
  if (remote) {
    latestReady.value = false;
    await refreshConflictPreview();
  }
  // Read both together: liveQuery notifications can arrive after the refresh promise.
  const [entries, conflicts] = await Promise.all([
    database.syncShadow.toArray(),
    database.syncConflicts.orderBy('createdAt').reverse().toArray(),
  ]);
  shadow.value = entries.map((e) => ({
    table: e.table,
    id: e.entityId,
    payload: e.payload as Record<string, any>,
    revision: e.revision,
    deleted: e.deleted,
  }));
  records.value = conflicts.filter((record) => !record.resolvedAt);
  await nextTick();
  latestReady.value = true;
}
async function refreshLatest() {
  if (busy.value) return;
  await run(() => readLatest(), '预览已更新，请选择要应用的版本。');
}
async function run(
  action: () => Promise<unknown>,
  success = '所选版本已应用。',
) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await action();
    message.value = success;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '处理失败';
  } finally {
    busy.value = false;
  }
}
async function apply(side: 'local' | 'cloud') {
  if (side === 'local' && localLayout.value.overflow) return;
  const group = current.value;
  if (!group || busy.value) return;
  const chosenIds = new Set(group.records.map((record) => record.id));
  await run(async () => {
    if (!latestReady.value) await readLatest();
    const remaining = records.value.filter((record) =>
      chosenIds.has(record.id),
    );
    if (!remaining.length) {
      // Already resolved by another device or an administrator during refresh.
      return;
    }
    const refreshed = groups.value.find((candidate) =>
      candidate.records.some((record) => chosenIds.has(record.id)),
    );
    if (
      !refreshed ||
      refreshed.id !== group.id ||
      refreshed.records.length !== remaining.length ||
      refreshed.records.some((record) => !chosenIds.has(record.id))
    )
      throw Error('刷新后冲突分组已变化，请查看更新后的预览并重新选择');
    if (
      refreshed.records.some((record) => record.state === 'resolving') &&
      side === 'local'
    ) {
      await syncNow();
      await refreshConflictPreview();
      const pending = await database.syncOutbox.toArray();
      if (
        pending.some((op) =>
          group.records.some((record) => record.id === op.resolutionOf),
        )
      )
        throw Error('上次选择仍在待上传队列，请检查云同步状态后重试');
      return;
    }
    const members = [...remaining].reverse();
    const map = new Map(
      shadow.value.map((e) => [e.table + ':' + e.id, e.revision]),
    );
    let resolved = refreshed.changes;
    if (side === 'local') {
      const layout = prepareLocalPreview(shadow.value, resolved);
      if (layout.overflow) throw Error('刷新后的桌面空间不足，请重新查看预览');
      resolved = previewResolutionChanges(
        shadow.value,
        resolved,
        layout.entities,
      );
    }
    const expected = Object.fromEntries(
      resolved.map((c) => [
        c.table + ':' + c.id,
        map.get(c.table + ':' + c.id) ?? '0',
      ]),
    );
    if (side === 'local') {
      // Stage the complete menu version durably before acknowledging redundant records.
      // A failed upload remains in the outbox (or a new conflict), never only in this UI.
      await retryConflict(members[0]!.id, {}, expected, true, resolved);
      if (
        (await database.syncOutbox.toArray()).some(
          (op) => op.resolutionOf === members[0]!.id,
        )
      )
        throw Error('本机版本已保存，仍在等待上传。可重试上次处理。');
      const failure = (await database.syncConflicts.toArray()).find(
        (record) =>
          !record.resolvedAt &&
          (record.operation as { resolutionOf?: string })?.resolutionOf ===
            members[0]!.id,
      );
      if (failure) throw Error('云端未接受这次处理：' + failure.reason);
      if (members.length > 1)
        await discardConflicts(members.slice(1).map((record) => record.id));
    } else {
      await discardConflicts(
        members.map((record) => record.id),
        expected,
      );
    }
    await readLatest(false);
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
        <button class="secondary" :disabled="busy" @click="refreshLatest">
          刷新预览
        </button>
      </div>
      <p v-if="error" class="error" role="alert">
        {{ error }}。请点击「刷新预览」重试。
      </p>
      <p v-else-if="busy && !latestReady" role="status">
        正在读取最新云端版本，完成后即可选择。
      </p>
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
          <nav
            v-if="views.length > 1"
            class="preview-views"
            aria-label="预览区域"
          >
            <button
              v-for="region in views"
              :key="region"
              :aria-pressed="region === view"
              @click="chosenView = region"
            >
              {{
                previewPages([local, cloud]).find((page) => page.id === region)
                  ?.name || region
              }}
            </button>
          </nav>
          <div class="version-panels">
            <article
              v-for="side in ['local', 'cloud'] as const"
              :key="side"
              class="version-panel"
              :data-version="side"
            >
              <template v-if="view">
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
              <footer>
                <span
                  class="version-dot"
                  :class="{ 'cloud-dot': side === 'cloud' }"
                  aria-hidden="true"
                />
                <h3>{{ side === 'local' ? '本机版本' : '云端版本' }}</h3>
                <span
                  class="version-location"
                  :title="versionLabel(side === 'local' ? local : cloud, view)"
                  >{{
                    versionLabel(side === 'local' ? local : cloud, view)
                  }}</span
                >
                <small>{{
                  resolving
                    ? '正在同步处理结果'
                    : side === 'local'
                      ? changes.length + ' 项更改'
                      : '当前已同步数据'
                }}</small>
                <button
                  class="apply-version"
                  :disabled="
                    busy || (side === 'local' && localLayout.overflow > 0)
                  "
                  @click="apply(side)"
                >
                  {{
                    resolving && side === 'local'
                      ? '重试上次处理'
                      : side === 'local'
                        ? '应用本机版本'
                        : '应用云端版本'
                  }}
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
.preview-views {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 12px;
}
.preview-views button {
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  background: #f5f5f7;
  cursor: pointer;
}
.preview-views button[aria-pressed='true'] {
  background: #222;
  color: white;
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
.version-panel > footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  margin-top: auto;
  border-top: 1px solid #eeeef1;
}
.version-panel h3 {
  margin: 0;
  flex: none;
  font-size: 14px;
  font-weight: 600;
}
.version-dot {
  flex: 0 0 7px;
  height: 7px;
  border-radius: 50%;
  background: #222;
}
.cloud-dot {
  background: #939aa5;
}
.version-location {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #747782;
  font-size: 12px;
}
.version-panel footer small {
  flex: none;
  font-size: 11px;
  color: #747782;
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
