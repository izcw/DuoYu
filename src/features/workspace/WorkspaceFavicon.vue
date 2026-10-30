<script setup lang="ts">
import { tintImage } from '../../shared/image-tint';
import { limitIconText } from '../../shared/icon-text';
import { iconForeground } from '../../shared/icon-material';
import TextIcon from '../../shared/components/base/TextIcon.vue';
import { computed, ref, watch, watchEffect, onMounted, onUnmounted } from 'vue';
import { assetObjectUrl } from '../sync/assets';
import { browser } from 'wxt/browser';
const props = defineProps<{
  src?: string;
  title: string;
  pageUrl?: string;
  refreshKey?: number;
  pictureFilter?: string;
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
  limitIconText(appearance.value?.text || props.title || '↗'),
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
    '--icon-padding',
    `${Math.max(0, Math.min(8, Number(appearance.value.padding ?? 4) || 0))}px`,
  );
  surface.style.setProperty(
    '--icon-foreground',
    iconForeground(appearance.value.material, appearance.value.color),
  );
  cleanup(() => {
    surface.style.removeProperty('--icon-foreground');
    surface.style.removeProperty('--icon-padding');
    delete surface.dataset.transparent;
    delete surface.dataset.material;
  });
});
const customFailed = ref(false);
const failed = ref(false);
const hdFailed = ref(false);
const assetReference = computed(() =>
  appearance.value?.mode === 'upload' ? appearance.value.image : props.src,
);
const assetUrl = ref('');
let assetRequest = 0,
  lastAsset = '';
async function loadAsset() {
  const reference = assetReference.value;
  const request = ++assetRequest;
  if (reference !== lastAsset) {
    assetUrl.value = '';
    lastAsset = reference || '';
  }
  if (typeof reference !== 'string' || !reference.startsWith('duoyu-asset:'))
    return;
  try {
    const url = await assetObjectUrl(reference);
    if (request === assetRequest) assetUrl.value = url;
  } catch {
    /* Keep the normal fallback; metadata sync must not depend on this image. */
  }
}
watch(assetReference, loadAsset, { immediate: true });
onMounted(() => window.addEventListener('duoyu-assets-retry', loadAsset));
onUnmounted(() => {
  assetRequest++;
  window.removeEventListener('duoyu-assets-retry', loadAsset);
});
const source = computed(() => {
  if (assetUrl.value) return assetUrl.value;
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
const pictureTint = computed(
  () => props.pictureFilter ?? appearance.value?.pictureFilter ?? '',
);
const filteredSource = ref('');
let filterRequest = 0;
watch(
  [source, pictureTint],
  async ([url, color]) => {
    const request = ++filterRequest;
    filteredSource.value = '';
    if (!url || !color) return;
    try {
      const result = await tintImage(url, color);
      if (request === filterRequest) filteredSource.value = result;
    } catch {
      // Unreadable or cross-origin images retain their original appearance.
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  filterRequest++;
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
      :src="filteredSource || source"
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
/* Transparent fill must also clear the favicon's default placeholder tint. */
.cell-icon[data-material='fill'][data-transparent='true'] > .workspace-favicon,
.icon-options[data-material='fill'][data-transparent='true']
  .cell-icon
  > .workspace-favicon {
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
}
.workspace-favicon img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
</style>
