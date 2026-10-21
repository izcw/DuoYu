<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue';
import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';

// GridStack owns geometry; Vue owns widget content. No demo widgets are added.
const element = useTemplateRef<HTMLDivElement>('grid');
let grid: GridStack | null | undefined;
onMounted(() => {
  if (!element.value) return;
  grid = GridStack.init(
    { column: 12, cellHeight: 88, margin: 10, minRow: 0, animate: true },
    element.value,
  );
});
onUnmounted(() => grid?.destroy(false));
</script>

<template>
  <div ref="grid" class="grid-stack desktop-grid" aria-label="桌面组件"></div>
</template>
