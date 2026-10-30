<script setup lang="ts">
import { iconForeground } from '../../shared/icon-material';
import TextIcon from '../../shared/components/base/TextIcon.vue';
import { computed, ref, watch, watchEffect } from 'vue';
import { browser } from 'wxt/browser';
const props = defineProps<{
  src?: string;
  title: string;
  pageUrl?: string;
  refreshKey?: number;
}>();
const appearance = computed(() => {
  try {
    return props.src?.startsWith('duoyu-icon:')
      ? JSON.parse(props.src.slice(11))
      : null;
  } catch {
    return null;
  }
});
const iconText = computed(() =>
  Array.from(appearance.value?.text || props.title || '↗')
    .slice(0, 6)
    .join(''),
);
const root = ref<HTMLElement>();
watchEffect((cleanup) => {
  const surface = root.value?.closest<HTMLElement>('.cell-icon');
  const color = appearance.value?.color;
  if (surface && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
    surface.style.setProperty('--icon-hover-fill', color);
    cleanup(() => surface.style.removeProperty('--icon-hover-fill'));
  }
});
watchEffect((cleanup) => {
  const surface = root.value?.closest<HTMLElement>('.cell-icon');
  if (!surface || !appearance.value) return;
  surface.dataset.material =
    appearance.value.material === 'fill' ? 'fill' : 'glass';
  surface.dataset.transparent = String(!appearance.value.color);
  surface.style.setProperty(
    '--icon-foreground',
    iconForeground(appearance.value.material, appearance.value.color),
  );
  cleanup(() => {
    surface.style.removeProperty('--icon-foreground');
    delete surface.dataset.transparent;
    delete surface.dataset.material;
  });
});
const customFailed = ref(false);
const failed = ref(false);
const hdFailed = ref(false);
const source = computed(() => {
  const value = appearance.value
    ? appearance.value.mode === 'upload'
      ? appearance.value.image
      : ''
    : props.src || '';
  if (
    !customFailed.value &&
    /^(https?:\/\/|data:image\/|\/images\/)/i.test(value) &&
    value.length < 200000
  )
    return value;
  if (props.pageUrl && /^https?:\/\//i.test(props.pageUrl)) {
    const host = new URL(props.pageUrl).hostname;
    if (
      !hdFailed.value &&
      (host === 'douyin.com' || host.endsWith('.douyin.com'))
    )
      return '/images/douyin-hd.png';
    const url = new URL('/_favicon/', browser.runtime.getURL('/'));
    url.searchParams.set('pageUrl', props.pageUrl);
    url.searchParams.set('size', '128');
    if (props.refreshKey)
      url.searchParams.set('refresh', String(props.refreshKey));
    return url.href;
  }
  return '';
});
watch(
  () => [props.src, props.pageUrl],
  () => {
    hdFailed.value = false;
    customFailed.value = false;
    failed.value = false;
  },
);
watch(source, () => {
  failed.value = false;
});
function onError() {
  if (source.value === '/images/douyin-hd.png') {
    hdFailed.value = true;
    return;
  }
  if (props.pageUrl && !customFailed.value && source.value === props.src)
    customFailed.value = true;
  else failed.value = true;
}
</script>
<template>
  <span class="workspace-favicon" aria-hidden="true" ref="root">
    <TextIcon v-if="appearance?.mode === 'text'" :text="iconText" />
    <img
      v-else-if="source && !failed"
      :src="source"
      alt=""
      draggable="false"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="onError"
    />
    <span v-else>{{ title.trim().slice(0, 1).toUpperCase() || '↗' }}</span>
  </span>
</template>
<style scoped>
.workspace-favicon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: 9px;
  background: rgb(239 239 237 / 12%);
  font-size: 13px;
  font-weight: 600;
}
.workspace-favicon img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
</style>
