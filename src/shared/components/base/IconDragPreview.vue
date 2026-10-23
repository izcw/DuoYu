<script setup lang="ts">
defineProps<{ icon: string; x: number; y: number }>();
</script>
<template>
  <div
    class="widget-link-drag-preview glass-surface"
    :style="{ left: `${x}px`, top: `${y}px` }"
    aria-hidden="true"
  >
    <img :src="icon" alt="" />
  </div>
</template>
<style scoped>
.widget-link-drag-preview {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  width: 38px;
  height: 38px;
  padding: 6px;
  border-radius: 12px;
  transform: translate(-50%, -50%) scale(var(--icon-drag-lift-scale, 1.1));
}
img {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
</style>
