<script setup lang="ts">
defineProps<{ source?: string; loaded?: boolean; contained?: boolean }>();
defineEmits<{ error: []; load: [] }>();
</script>
<template>
  <div
    class="wallpaper"
    :class="{ 'wallpaper-contained': contained }"
    aria-hidden="true"
  >
    <img
      v-if="source"
      :src="source"
      :class="{ loaded }"
      alt=""
      referrerpolicy="no-referrer"
      @error="$emit('error')"
      @load="$emit('load')"
    />
    <div class="wallpaper-shade" />
  </div>
</template>
<style scoped>
.wallpaper-contained {
  position: absolute;
  z-index: 0;
  pointer-events: none;
}
</style>
