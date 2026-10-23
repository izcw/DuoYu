<script setup lang="ts">
import { computed } from 'vue';
import IconTile from '../../../shared/components/base/IconTile.vue';
import ReorderTransition from '../../../shared/components/base/ReorderTransition.vue';
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
const slots = computed(() =>
  Array.from({ length: 8 }, (_, index) => props.links[index]),
);
</script>
<template>
  <div class="widget-links">
    <h2>{{ title }}</h2>
    <ReorderTransition
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
        <IconTile
          v-if="link"
          :key="link.id"
          :name="link.name"
          :icon="link.icon"
          :href="link.url"
          :dragging="dragId === link.id"
          :data-link-id="link.id"
          @pointerdown.stop="emit('drag-start', $event, groupId, link)"
        />
      </div>
    </ReorderTransition>
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
</style>
