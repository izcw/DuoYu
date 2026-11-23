<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { createLayer } from './renderer';

const props = defineProps<{ width: number; height: number }>();
const host = ref<HTMLElement>();
const layer = createLayer();
const canvas = layer.getNativeCanvasElement();
defineExpose({ layer, canvas });
watchEffect(() => {
  layer.getCanvas().setSizeIfChanged(props.width, props.height);
  // The pixel buffer and its on-screen size differ on high-DPI displays.
  // Let the paper or the thumbnail tray size and position the element.
  canvas.removeAttribute('style');
});
onMounted(() => host.value!.appendChild(canvas));
onBeforeUnmount(() => layer.destroy());
</script>
<template>
  <span ref="host" class="canvas-layer" aria-hidden="true"></span>
</template>
