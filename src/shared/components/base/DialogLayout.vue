<script setup lang="ts" generic="T extends string">
import PageIcon from './PageIcon.vue';
defineProps<{
  menus: readonly { id: T; name: string; icon?: string }[];
  label?: string;
}>();
const active = defineModel<T>({ required: true });
</script>
<template>
  <div class="dialog-layout">
    <nav class="dialog-menu" :aria-label="label || '分类菜单'">
      <button
        v-for="item in menus"
        :key="item.id"
        type="button"
        :aria-pressed="active === item.id"
        @click="active = item.id"
      >
        <PageIcon
          v-if="item.icon"
          :name="item.icon"
          :size="22"
          :active="active === item.id"
        />
        <span>{{ item.name }}</span>
      </button>
    </nav>
    <section class="dialog-content store-content"><slot /></section>
  </div>
</template>
<style scoped>
.dialog-layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 28px;
  height: 100%;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  color: #222;
}
.dialog-menu {
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: #f8f8fa;
  border-radius: 16px;
}
.dialog-menu button {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 14px 12px;
  border: 0;
  border-radius: 10px;
  text-align: left;
  font-size: 13px;
  color: #777780;
  background: transparent;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
}
.dialog-menu button:hover {
  background: #ededf1;
}
.dialog-menu button[aria-pressed='true'] {
  color: #222;
  background: #fff;
  font-weight: 600;
  box-shadow: 0 2px 8px #00000005;
}
.dialog-menu button:focus-visible {
  outline: 2px solid #777;
  outline-offset: -2px;
}
.dialog-content {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 4px 6px 12px 0;
  box-sizing: border-box;
}
@media (max-width: 640px) {
  .dialog-layout {
    grid-template-columns: 130px minmax(0, 1fr);
    gap: 16px;
  }
  .dialog-menu {
    padding: 8px;
  }
  .dialog-menu button {
    gap: 6px;
    padding: 12px 6px;
  }
}
</style>
