<script setup lang="ts">
import { computed } from 'vue';
import type { WallpaperProgress } from './download-wallpaper';
const props = defineProps<{ progress?: WallpaperProgress }>();
const percent = computed(() =>
  props.progress?.complete
    ? 100
    : props.progress?.total
      ? Math.min(
          99,
          Math.floor((props.progress.loaded / props.progress.total) * 100),
        )
      : undefined,
);
</script>
<template>
  <span class="wallpaper-download">
    <progress max="100" :value="percent" aria-label="壁纸下载进度" />
    <small>{{
      progress?.complete
        ? '正在保存…'
        : percent !== undefined
          ? `下载 ${percent}%`
          : `下载中${progress?.loaded ? ' · ' + (progress.loaded / 1048576).toFixed(1) + ' MB' : '…'}`
    }}</small>
  </span>
</template>
<style scoped>
.wallpaper-download {
  display: grid;
  gap: 4px;
  margin-top: 5px;
}
progress {
  width: 100%;
  height: 4px;
  border: 0;
  border-radius: 4px;
  overflow: hidden;
  appearance: none;
  background: #ffffff40;
}
progress::-webkit-progress-bar {
  background: #ffffff40;
  border-radius: 4px;
}
progress::-webkit-progress-value {
  background: white;
  border-radius: 4px;
  transition: width 120ms linear;
}
progress:indeterminate {
  background: linear-gradient(90deg, transparent, white, transparent) 0 / 40%
    100% no-repeat #ffffff40;
  animation: downloading 1s ease-in-out infinite alternate;
}
small {
  font-size: 10px;
  color: white;
}
@keyframes downloading {
  to {
    background-position: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  progress:indeterminate {
    animation: none;
  }
}
</style>
