<script setup lang="ts">
defineProps<{ selected: boolean }>();
</script>
<template>
  <span
    v-if="selected"
    class="wallpaper-selected-overlay"
    role="img"
    aria-label="已选中"
    ><span
  /></span>
</template>
<style scoped>
.wallpaper-selected-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  pointer-events: none;
}
.wallpaper-selected-overlay > span {
  display: block;
  width: 42px;
  height: 42px;
  background: url('/images/wallpaper-selected.png') center / contain no-repeat;
}
</style>
