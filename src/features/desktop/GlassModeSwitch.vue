<script setup lang="ts">
import { inject, ref, onMounted, onUnmounted, watch } from 'vue';
import { browser } from 'wxt/browser';
import type { GlassMode } from './glass/renderer';
import { initialGlassModeKey } from './glass/preferences';
const notice = ref('');
const glassMode = ref<GlassMode>(inject(initialGlassModeKey, 'real'));
watch(
  glassMode,
  (mode) => {
    document.documentElement.dataset.glassMode = mode;
  },
  { immediate: true },
);
const glassModes = [
  { id: 'real', label: '真实' },
  { id: 'natural', label: '自然' },
  { id: 'soft', label: '柔和' },
] as const;
function syncMode(changes: Record<string, { newValue?: unknown }>) {
  const value = changes.glassMode?.newValue;
  if (value === 'real' || value === 'natural' || value === 'soft')
    glassMode.value = value;
}
onMounted(() => browser.storage.local.onChanged.addListener(syncMode));
onUnmounted(() => browser.storage.local.onChanged.removeListener(syncMode));
let modeQueue = Promise.resolve();
function setGlassMode(mode: GlassMode) {
  glassMode.value = mode;
  modeQueue = modeQueue
    .then(() => browser.storage.local.set({ glassMode: mode }))
    .catch(() => {
      notice.value = '玻璃效果保存失败，当前选择仅在本页生效';
    });
}
</script>
<template>
  <div
    class="glass-mode-switch glass-surface"
    role="group"
    aria-label="玻璃效果"
  >
    <button
      v-for="mode in glassModes"
      :key="mode.id"
      type="button"
      class="glass-control glass-interactive"
      :aria-pressed="glassMode === mode.id"
      @click="setGlassMode(mode.id)"
    >
      {{ mode.label }}
    </button>
  </div>
  <p v-if="notice" class="widget-layout-notice glass-surface" role="status">
    {{ notice }}
  </p>
</template>
<style scoped>
.glass-mode-switch {
  position: absolute;
  top: 18px;
  right: 24px;
  z-index: 20;
  display: flex;
  width: max-content;
  margin: 0;
  padding: 3px;
  gap: 2px;
  border-radius: 20px;
  border: 0;
}
.glass-mode-switch button {
  padding: 6px 15px;
  border: 0;
  border-radius: 16px;
  color: #fff;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  transition:
    background 160ms ease,
    box-shadow 160ms ease;
}

.widget-layout-notice {
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  border-radius: 8px;
  color: #fff;
  z-index: 2147483001;
}
</style>
