<script setup lang="ts">
withDefaults(defineProps<{ tag?: string }>(), { tag: 'div' });
</script>
<template>
  <TransitionGroup name="shared-reorder" :tag="tag"><slot /></TransitionGroup>
</template>
<style>
.shared-reorder-move {
  transition: transform 180ms ease;
}
.shared-reorder-enter-active {
  transition: opacity 180ms ease;
}
.shared-reorder-enter-from {
  opacity: 0;
}
.drag-landing .shared-reorder-move,
.drag-landing .shared-reorder-enter-active {
  transform: none !important;
  transition: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .shared-reorder-move,
  .shared-reorder-enter-active {
    transition: none;
  }
}
</style>
