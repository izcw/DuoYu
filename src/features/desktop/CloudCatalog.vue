<script setup lang="ts">
import { ref, watch } from 'vue';
import { rpc, syncNow } from '../sync/client';
import { planJsonImport, commitJsonImport } from '../sync/import-json';
import { importWallpaper } from '../wallpaper/wallpaper-cache';
const props = defineProps<{ kind: 'templates' | 'widgets' | 'wallpapers' }>();
const emit = defineEmits<{ add: [kind: 'calendar' | 'weather' | 'note'] }>();
const rows = ref<any[]>([]),
  busy = ref(false),
  error = ref(''),
  message = ref(''),
  chosen = ref<any>();
async function load() {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    rows.value = (await rpc('/v1/catalog/' + props.kind)).items;
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
  busy.value = true;
  error.value = '';
  try {
    if (props.kind === 'widgets') {
      const kind = row.payload?.type;
      if (!['calendar', 'weather', 'note'].includes(kind))
        throw Error('当前扩展暂不支持这个组件类型');
      emit('add', kind);
    } else if (props.kind === 'templates') {
      if (row.payload?.format === 'duoyu-template') {
        row.requestId ??= crypto.randomUUID();
        await rpc('/v1/templates/' + row.id + '/apply', 'POST', {
          request_id: row.requestId,
        });
        await syncNow();
      } else {
        const plan = await planJsonImport(JSON.stringify(row.payload));
        await commitJsonImport(plan);
      }
      message.value = '模板已添加为新页面';
    } else {
      const url = new URL(row.payload?.url);
      if (
        url.origin !== new URL(import.meta.env.VITE_SYNC_URL).origin ||
        !/^\/catalog-assets\/[0-9a-f]{64}$/.test(url.pathname)
      )
        throw Error('壁纸地址无效');
      const r = await fetch(url, { credentials: 'omit', redirect: 'error' });
      if (!r.ok) throw Error('壁纸下载失败');
      if (Number(r.headers.get('content-length') || 0) > 20 * 1048576)
        throw Error('壁纸超过20MB');
      const blob = await r.blob();
      if (blob.size > 20 * 1048576) throw Error('壁纸超过20MB');
      await importWallpaper(blob);
      message.value = '壁纸已应用';
    }
    chosen.value = undefined;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="cloud-catalog">
    <p v-if="error" role="alert">
      {{ error }} <button @click="load">重新加载</button>
    </p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="busy">正在处理…</p>
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
        @click="chosen = row"
      >
        <img
          v-if="kind === 'wallpapers'"
          :src="row.payload.url"
          :alt="row.name"
          loading="lazy"
        /><span v-else class="tool-symbol">{{
          kind === 'templates' ? '▤' : '▦'
        }}</span
        ><strong>{{ row.name }}</strong>
      </button>
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
