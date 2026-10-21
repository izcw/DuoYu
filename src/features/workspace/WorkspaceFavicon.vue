<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { browser } from 'wxt/browser';
const props = defineProps<{ src?: string; title: string; pageUrl?: string }>();
const customFailed = ref(false);
const failed = ref(false);
const source = computed(() => {
  const value = props.src || '';
  if (
    !customFailed.value &&
    /^(https?:\/\/|data:image\/)/i.test(value) &&
    value.length < 65536
  )
    return value;
  if (props.pageUrl && /^https?:\/\//i.test(props.pageUrl)) {
    const url = new URL('/_favicon/', browser.runtime.getURL('/'));
    url.searchParams.set('pageUrl', props.pageUrl);
    url.searchParams.set('size', '64');
    return url.href;
  }
  return '';
});
watch(
  () => [props.src, props.pageUrl],
  () => {
    customFailed.value = false;
    failed.value = false;
  },
);
watch(source, () => {
  failed.value = false;
});
function onError() {
  if (props.pageUrl && !customFailed.value && source.value === props.src)
    customFailed.value = true;
  else failed.value = true;
}
</script>
<template>
  <span class="workspace-favicon" aria-hidden="true">
    <img
      v-if="source && !failed"
      :src="source"
      alt=""
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
