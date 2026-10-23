<script setup lang="ts">
import { ref, watch } from 'vue';
const props = defineProps<{
  name: string;
  icon: string;
  href?: string;
  dragging?: boolean;
}>();
const failed = ref(false);
watch(
  () => props.icon,
  () => {
    failed.value = false;
  },
);
</script>
<template>
  <component
    :is="href ? 'a' : 'button'"
    :href="href || undefined"
    :type="href ? undefined : 'button'"
    :target="href ? '_blank' : undefined"
    :rel="href ? 'noopener noreferrer' : undefined"
    class="widget-link glass-control glass-interaction-owner"
    :class="{ 'is-link-dragging': dragging }"
    :aria-label="name"
    :title="name"
    draggable="false"
    @mousedown.stop
    @touchstart.stop
    @dragstart.prevent
  >
    <span class="widget-link-icon glass-surface glass-interaction-target"
      ><img
        v-if="!failed"
        :src="icon"
        alt=""
        draggable="false"
        @error="failed = true"
      /><span v-else>{{ name.slice(0, 1) }}</span></span
    >
    <span class="widget-link-name">{{ name }}</span>
  </component>
</template>
<style scoped>
.widget-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  border-radius: 8px;
  outline-offset: 1px;
  touch-action: none;
}
.widget-link-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: inherit;
  transition:
    transform 160ms ease,
    background 160ms ease;
}
.widget-link-icon img {
  display: block;
  width: 26px;
  height: 26px;
  object-fit: contain;
  pointer-events: none;
}
.widget-link:hover .widget-link-icon,
.widget-link:focus-visible .widget-link-icon {
  transform: translateY(-1px) scale(1.04);
}
.widget-link.is-link-dragging {
  opacity: 0;
}
.widget-link-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 14px;
  text-shadow: 0 1px 5px #0006;
}
@media (prefers-reduced-motion: reduce) {
  .widget-link,
  .widget-link-icon,
  .widget-link-slot {
    transition: none;
    animation: none;
  }
}

.widget-link {
  font: inherit;
  padding: 0;
}
</style>
