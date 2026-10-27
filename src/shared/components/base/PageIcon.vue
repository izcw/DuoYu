<script setup lang="ts">
import { pageIcon, pageIcons } from '../../page-icons';
withDefaults(
  defineProps<{ name?: string; active?: boolean; size?: number }>(),
  { size: 28 },
);
</script>
<template>
  <span
    v-if="active"
    class="page-iconpark filled-icon"
    :data-icon="name || 'Bookmark'"
    data-theme="filled"
    aria-hidden="true"
    :style="{
      width: size + 'px',
      height: size + 'px',
      maskImage: `url(/images/iconpark-filled/${name === 'Add' || pageIcons.some((icon) => icon.id === name) ? name : 'Bookmark'}.svg)`,
    }"
  />
  <component
    v-else
    :is="pageIcon(name)"
    theme="outline"
    :size="size"
    fill="currentColor"
    :stroke-width="3"
    class="page-iconpark"
    :data-icon="name || 'Bookmark'"
    :data-theme="active ? 'filled' : 'outline'"
    aria-hidden="true"
  />
</template>
<style scoped>
.page-iconpark {
  display: inline-flex;
  flex-shrink: 0;
  vertical-align: middle;
}
.filled-icon {
  background: currentColor;
  mask-size: contain;
  mask-position: center;
  mask-repeat: no-repeat;
}
</style>
