<script setup lang="ts">
import { onMounted, ref } from 'vue';
import LibraryBoard from '../library/LibraryBoard.vue';
import { ensureHomeGrid } from './home-grid';
import { HOME_GRID_ROWS } from '../library/grid-config';
defineProps<{ active: boolean }>();
const ready = ref(false);
const error = ref('');
onMounted(async () => {
  try {
    await ensureHomeGrid();
    ready.value = true;
  } catch {
    error.value = '首页布局读取失败，请刷新重试';
  }
});
</script>
<template>
  <section class="bottom-widgets" aria-label="首页网格">
    <LibraryBoard
      v-if="ready && active"
      page-id="home"
      :rows="HOME_GRID_ROWS"
      alignment="end"
      embedded
    />
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.bottom-widgets {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
