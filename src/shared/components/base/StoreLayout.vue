<script setup lang="ts">
defineProps<{ menus: { id: string; name: string }[] }>();
const active = defineModel<string>({ required: true });
</script>
<template>
  <div class="store-layout">
    <nav class="store-menu" aria-label="商店分类">
      <button
        v-for="item in menus"
        :key="item.id"
        class="glass-control glass-interactive"
        :aria-pressed="active === item.id"
        @click="active = item.id"
      >
        {{ item.name }}
      </button>
    </nav>
    <section class="store-content"><slot /></section>
  </div>
</template>
<style scoped>
.store-layout {
  display: grid;
  grid-template-columns: 136px minmax(0, 1fr);
  gap: 24px;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
.store-menu {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-right: 1px solid #ffffff20;
  padding-right: 16px;
}
.store-menu button {
  padding: 12px;
  text-align: left;
  border-radius: 12px;
  color: inherit;
}
.store-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow: auto;
}
@media (max-width: 560px) {
  .store-layout {
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 12px;
  }
  .store-menu {
    padding-right: 8px;
  }
  .store-menu button {
    padding: 10px 6px;
  }
}
</style>
