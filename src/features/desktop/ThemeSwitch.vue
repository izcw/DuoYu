<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import Sun from '@icon-park/vue-next/es/icons/Sun';
import Moon from '@icon-park/vue-next/es/icons/Moon';

const root = document.documentElement;
const preference = ref(root.dataset.themePreference || 'auto');
const dark = ref(root.dataset.fallbackTheme === 'dark');

function refresh() {
  preference.value = root.dataset.themePreference || 'auto';
  dark.value = root.dataset.fallbackTheme === 'dark';
}
function change(event: Event) {
  localStorage.setItem('duoyu-theme', (event.target as HTMLSelectElement).value);
  window.dispatchEvent(new Event('duoyu-theme-change'));
}
onMounted(() => window.addEventListener('duoyu-theme-applied', refresh));
onUnmounted(() => window.removeEventListener('duoyu-theme-applied', refresh));
</script>

<template>
  <label class="theme-switch glass-interactive" :title="'主题 · ' + (preference === 'auto' ? '自动' : dark ? '黑色' : '白色')">
    <component :is="dark ? Moon : Sun" :size="21" fill="currentColor" aria-hidden="true" />
    <small v-if="preference === 'auto'" aria-hidden="true">A</small>
    <select aria-label="主题" :value="preference" @change="change">
      <option value="light">☀ 白色</option>
      <option value="dark">☾ 黑色</option>
      <option value="auto">自动（跟随系统）</option>
    </select>
  </label>
</template>

<style scoped>
.theme-switch {
  width: 36px;
  height: 36px;
  position: relative;
  display: grid;
  place-items: center;
  border-radius: 50%;
}
.theme-switch :deep(svg) {
  display: block;
}
.theme-switch small {
  position: absolute;
  right: 0;
  bottom: 1px;
  font: bold 9px/12px sans-serif;
  width: 12px;
  text-align: center;
  border-radius: 50%;
  color: var(--theme-panel);
  background: var(--theme-text);
}
.theme-switch > select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color-scheme: inherit;
  opacity: 0;
  cursor: pointer;
}
.theme-switch:has(select:focus-visible) {
  background: var(--glass-interaction-fill);
}
</style>
