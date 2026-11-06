<script setup lang="ts">
defineProps<{ axis: 'vertical' | 'horizontal' }>();
const keys = [
  {
    name: 'W',
    x: 11,
    y: 1,
    axis: 'vertical',
    glyph: 'M2 3l1.2 4 1.3-2.7L6 7l1-4',
  },
  {
    name: 'A',
    x: 1,
    y: 11,
    axis: 'horizontal',
    glyph: 'M2.5 7l2-4 2 4m-3.3-1h2.6',
  },
  {
    name: 'S',
    x: 11,
    y: 11,
    axis: 'vertical',
    glyph: 'M6.2 3H4a1 1 0 0 0 0 2h1a1 1 0 0 1 0 2H2.8',
  },
  {
    name: 'D',
    x: 21,
    y: 11,
    axis: 'horizontal',
    glyph: 'M3 3v4h1.2a2 2 0 0 0 0-4z',
  },
] as const;
</script>
<template>
  <svg
    class="nav-keys"
    viewBox="0 0 31 21"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-linejoin="round"
  >
    <g
      v-for="key in keys"
      :key="key.name"
      :transform="`translate(${key.x} ${key.y})`"
      :data-key="key.name"
    >
      <rect width="9" height="9" rx="1.5" stroke-width="0.8" opacity="0.55" />
      <path
        :d="key.glyph"
        :stroke-width="axis === key.axis ? 1.5 : 1"
        :opacity="axis === key.axis ? 1 : 0.32"
        stroke-linecap="round"
      />
    </g>
  </svg>
</template>
<style scoped>
.nav-keys {
  width: 31px;
  height: 21px;
  flex: none;
}
</style>
