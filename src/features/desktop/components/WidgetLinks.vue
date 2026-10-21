<script setup lang="ts">
import { computed, ref } from 'vue';
import type { WidgetLink } from '../widget-links';
const props = defineProps<{
  groupId: string;
  title: string;
  links: WidgetLink[];
  dragId?: string;
}>();
const emit = defineEmits<{
  'drag-start': [event: PointerEvent, groupId: string, link: WidgetLink];
}>();
const failed = ref(new Set<string>());
const slots = computed(() =>
  Array.from({ length: 8 }, (_, index) => props.links[index]),
);
</script>
<template>
  <div class="widget-links">
    <h2>{{ title }}</h2>
    <TransitionGroup
      name="widget-reorder"
      tag="nav"
      class="widget-link-grid"
      :aria-label="title"
      :data-link-group="groupId"
    >
      <div
        v-for="(link, index) in slots"
        :key="link?.id ?? `empty-${index}`"
        class="widget-link-slot"
        :data-link-slot="index"
      >
        <a
          v-if="link"
          :key="link.id"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          class="widget-link glass-control glass-interaction-owner"
          :class="{ 'is-link-dragging': dragId === link.id }"
          :data-link-id="link.id"
          :title="link.name"
          draggable="false"
          @pointerdown.stop="emit('drag-start', $event, groupId, link)"
          @mousedown.stop
          @touchstart.stop
          @dragstart.prevent
        >
          <span class="widget-link-icon glass-surface glass-interaction-target"
            ><img
              v-if="!failed.has(link.id)"
              :src="link.icon"
              alt=""
              draggable="false"
              @error="failed.add(link.id)"
            /><span v-else>{{ link.name.slice(0, 1) }}</span></span
          >
          <span class="widget-link-name">{{ link.name }}</span>
        </a>
      </div>
    </TransitionGroup>
  </div>
</template>
<style scoped>
.widget-links {
  padding: 10px 14px;
  color: #fff;
}
h2 {
  margin: 0 0 7px;
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 6px #0005;
}
.widget-link-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-template-rows: repeat(2, 55px);
  gap: 3px 5px;
}
.widget-link-slot {
  min-width: 0;
  border-radius: 8px;
}
.widget-reorder-move {
  transition: transform 180ms ease;
}
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
</style>
