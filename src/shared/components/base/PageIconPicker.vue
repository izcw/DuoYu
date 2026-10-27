<script setup lang="ts">
import { pageIcons } from '../../page-icons';
import PageIcon from './PageIcon.vue';
const selected = defineModel<string>({ required: true });
</script>
<template>
  <div class="page-icon-picker" role="group" aria-label="选择页面图标">
    <button
      v-for="icon in pageIcons"
      :key="icon.id"
      type="button"
      :title="icon.label"
      :aria-label="icon.label"
      :aria-pressed="selected === icon.id"
      @click="selected = icon.id"
    >
      <PageIcon :name="icon.id" :active="selected === icon.id" :size="26" />
    </button>
  </div>
</template>
<style scoped>
.page-icon-picker {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 8px;
}
button {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  color: inherit;
  background: rgb(255 255 255 / 6%);
  cursor: pointer;
}
button:hover {
  background: rgb(255 255 255 / 15%);
}
button[aria-pressed='true'] {
  background: rgb(70 155 255 / 30%);
}
button:focus-visible {
  outline: 2px solid white;
  outline-offset: 2px;
}
@media (max-width: 420px) {
  .page-icon-picker {
    gap: 4px;
  }
  button {
    padding: 3px;
  }
}
</style>
