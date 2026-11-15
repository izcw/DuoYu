<script setup lang="ts">
import NavigationKeys from './NavigationKeys.vue';
import { ref } from 'vue';
import { useDockClearance } from './useDockClearance';

const hint = ref<HTMLElement>();
const aboveDock = useDockClearance(hint, 'right');
</script>
<template>
  <aside
    ref="hint"
    class="home-nav-hint"
    :class="{ stacked: aboveDock }"
    :style="aboveDock ? { bottom: aboveDock + 'px' } : undefined"
    aria-label="桌面导航快捷键"
  >
    <div aria-label="鼠标滚轮、W/S 或上下方向键翻页">
      <svg
        class="mouse"
        viewBox="0 0 16 22"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <rect x="1.5" y="1.5" width="13" height="19" rx="6.5" />
        <path d="M8 4v5" stroke-width="2.5" stroke-linecap="round" />
      </svg>
      <NavigationKeys axis="vertical" /><span class="arrows">↑ ↓</span
      ><span>翻页</span>
    </div>
    <div aria-label="A/D 或左右方向键切换页面，Esc 返回首页">
      <NavigationKeys axis="horizontal" /><span class="arrows">← →</span
      ><span>切换页面</span>
    </div>
  </aside>
</template>

<style scoped>
.home-nav-hint {
  position: absolute;
  inset-inline-end: max(16px, env(safe-area-inset-right));
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 1;
  display: grid;
  gap: 5px;
  justify-items: end;
  text-shadow:
    0 1px 3px #111,
    0 0 2px #222;
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  pointer-events: none;
  user-select: none;
}
.home-nav-hint div {
  display: flex;
  align-items: center;
  gap: 7px;
}
.home-nav-hint svg {
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / 78%));
}
.home-nav-hint .mouse {
  width: 13px;
  height: 18px;
}
.arrows {
  font-size: 14px;
  letter-spacing: 1px;
}
</style>
