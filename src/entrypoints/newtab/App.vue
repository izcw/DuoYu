<script setup lang="ts">
import { accountStorage } from '../../shared/storage/account';
import { nextTick, ref, watch } from 'vue';
import { useDesktopPages } from '../../features/desktop/useDesktopPages';
import WorkspaceOverlay from '../../features/workspace/WorkspaceOverlay.vue';
import WallpaperBackground from '../../features/wallpaper/WallpaperBackground.vue';
import ClockWidget from '../../features/clock/ClockWidget.vue';
import SearchBox from '../../features/search/SearchBox.vue';
import GlassModeSwitch from '../../features/desktop/GlassModeSwitch.vue';
import DesktopDock from '../../features/desktop/DesktopDock.vue';
import AccountButton from '../../features/auth/AccountButton.vue';
import BottomWidgets from '../../features/desktop/BottomWidgets.vue';
import WallpaperWheel from '../../features/shortcuts/WallpaperWheel.vue';
import LibraryBoard from '../../features/library/LibraryBoard.vue';
import LibraryPageMenu from '../../features/library/LibraryPageMenu.vue';
import { pageDragActive } from '../../features/library/page-drag';
import type { LibraryPage } from '../../shared/storage/database';
const workspaceOpen = ref(false);
const { page, root, go } = useDesktopPages(() => workspaceOpen.value, stepPage);
const libraryPage = ref(
  accountStorage.getItem('duoyu-library-page') || 'default',
);
watch(libraryPage, (value) =>
  accountStorage.setItem('duoyu-library-page', value),
);
const libraryPageTitle = ref('常用收藏');
const libraryPages = ref<LibraryPage[]>([]);
const homeQuiet = ref(false);
const slideDirection = ref(1);
async function clickClock() {
  if (page.value !== 0) {
    homeQuiet.value = false;
    await go(0);
  } else {
    homeQuiet.value = !homeQuiet.value;
    await nextTick();
    document.dispatchEvent(new Event('desktop-page-change'));
  }
}
watch(page, () => {
  homeQuiet.value = false;
});
watch(
  [page, libraryPage],
  async ([current, id], [previous, previousId], cleanup) => {
    let cancelled = false;
    let animation: Animation | undefined;
    cleanup(() => {
      cancelled = true;
      animation?.cancel();
    });
    if (current === previous && (current === 0 || id === previousId)) return;
    await nextTick();
    if (cancelled || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return;
    const content = root.value?.querySelector<HTMLElement>(
      current === 0 ? '.bottom-widgets' : '.desktop-library > .library-board',
    );
    // Forward scrolling brings the next page up from below.
    animation = content?.animate(
      [
        {
          opacity: 0,
          transform: `translateY(${slideDirection.value > 0 ? '40vh' : '-40vh'})`,
        },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 550, easing: 'cubic-bezier(.22,.8,.22,1)' },
    );
  },
);
function stepPage(direction: number) {
  slideDirection.value = direction;
  const ids = libraryPages.value.map((item) => item.id);
  if (!ids.length) return;
  const current =
    page.value === 0 ? 0 : Math.max(0, ids.indexOf(libraryPage.value)) + 1;
  const next = (current + direction + ids.length + 1) % (ids.length + 1);
  if (next === 0) void go(0);
  else {
    libraryPage.value = ids[next - 1]!;
    void go(1);
  }
}
</script>

<template>
  <WallpaperBackground />
  <AccountButton />
  <Teleport to="body">
    <div
      class="desktop-library-backdrop glass-focus-layer"
      :class="{ visible: page === 1 }"
      aria-hidden="true"
    />
  </Teleport>
  <WallpaperWheel @workspace="workspaceOpen = true" />
  <WorkspaceOverlay v-model="workspaceOpen" />
  <DesktopDock
    :hidden="page === 0 && homeQuiet && !workspaceOpen"
    :home-active="page === 0 && !workspaceOpen"
    :workspace-active="workspaceOpen"
    @home="
      workspaceOpen = false;
      go(0);
    "
    @workspace="workspaceOpen = true"
  />
  <main
    ref="root"
    class="newtab desktop-pages"
    :class="{
      'is-apps-page': page === 1,
      'is-desktop-dragging': pageDragActive,
      'is-home-quiet': page === 0 && homeQuiet,
    }"
    :data-desktop-page="page"
    :style="{ '--page-exit-y': slideDirection > 0 ? '-40vh' : '40vh' }"
    :inert="workspaceOpen"
  >
    <GlassModeSwitch />
    <LibraryPageMenu
      v-model="libraryPage"
      class="desktop-menu"
      :inert="page === 0 && !pageDragActive"
      :aria-hidden="page === 0 && !pageDragActive"
      @title="libraryPageTitle = $event"
      @home="go(0)"
      :home-active="page === 0"
      @pages="libraryPages = $event"
      @navigate="go(1)"
    />
    <section class="start-panel" aria-label="桌面">
      <div class="desktop-header">
        <div
          class="clock-action"
          role="button"
          tabindex="0"
          :aria-label="
            page === 1
              ? '返回首页'
              : homeQuiet
                ? '显示首页组件'
                : '隐藏首页组件'
          "
          @pointerdown.stop
          @click.stop="clickClock"
          @keydown.enter.prevent="clickClock"
          @keydown.space.prevent="clickClock"
        >
          <ClockWidget />
        </div>
        <SearchBox />
      </div>
      <div class="desktop-spacer" aria-hidden="true" />
      <div class="desktop-content">
        <BottomWidgets
          :active="page === 0"
          :inert="page === 1 || homeQuiet"
          :aria-hidden="page === 1 || homeQuiet"
        />
        <section
          class="desktop-library"
          :inert="page === 0"
          :aria-hidden="page === 0"
          aria-label="收藏页面内容"
        >
          <LibraryBoard
            v-if="page === 1"
            :key="libraryPage"
            :page-id="libraryPage"
            :title="libraryPageTitle"
            embedded
          />
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.desktop-pages {
  width: 100%;
  min-width: 0;
  height: 100svh;
  min-height: 0;
  overflow: clip;
  padding: clamp(48px, 6vh, 80px) 32px 100px;
}
.start-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  min-width: 0;
  grid-template-rows: auto clamp(24px, 4vh, 48px) minmax(0, 1fr);
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.desktop-header {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 40px;
  transition:
    padding 550ms ease,
    transform 550ms ease;
  z-index: 5;
}
.is-apps-page .desktop-header {
  padding-top: 0;
}
.desktop-header :deep(.clock-time) {
  transition: font-size 350ms ease;
}
.is-apps-page .desktop-header :deep(.clock-time) {
  font-size: 42px;
}
.desktop-content {
  min-width: 0;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  min-height: 0;
  width: 100%;
}
.desktop-content > * {
  grid-area: 1 / 1;
  min-width: 0;
  width: 100%;
  min-height: 0;
}
.desktop-content :deep(.library-board) {
  width: 100%;
  max-width: none;
}
.desktop-content :deep(.library-scroll) {
  padding: 0;
}
.desktop-content :deep(.library-search) {
  display: none;
}
.desktop-content :deep(.bottom-widgets),
.desktop-library {
  transition:
    transform 550ms cubic-bezier(0.22, 0.8, 0.22, 1),
    opacity 300ms ease;
}
.desktop-library {
  opacity: 0;
  pointer-events: none;
}
.is-apps-page .desktop-library {
  opacity: 1;
  pointer-events: auto;
}
.is-apps-page :deep(.bottom-widgets) {
  transform: translateY(var(--page-exit-y));
  opacity: 0;
  pointer-events: none;
}
.desktop-menu {
  position: fixed;
  z-index: 10;
  left: 12px;
  top: 50%;
  width: 90px;
  padding: 10px 5px;
  border-radius: 24px;
  opacity: 0;
  transform: translate(-100px, -50%);
  pointer-events: none;
  transition:
    opacity 300ms ease,
    transform 500ms cubic-bezier(0.22, 0.8, 0.22, 1);
}
.is-apps-page .desktop-menu,
.is-desktop-dragging .desktop-menu {
  opacity: 1;
  transform: translate(0, -50%);
  pointer-events: auto;
}
.clock-action {
  cursor: pointer;
  border-radius: 16px;
}
.clock-action:focus-visible {
  outline: 2px solid #b1eedc;
  outline-offset: 6px;
}
.is-home-quiet .desktop-header {
  transform: translateY(clamp(48px, 12vh, 120px));
}
.is-home-quiet :deep(.bottom-widgets) {
  opacity: 0;
  transform: translateY(60px);
  pointer-events: none;
}
.desktop-library-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--glass-focus-duration) ease,
    visibility 0s var(--glass-focus-duration);
}
.desktop-library-backdrop.visible,
:global(
  body:has(
      .bottom-widgets .ui-draggable-dragging,
      .bottom-widgets .grid-selection-dragging,
      .desktop-transfer-preview
    )
    .desktop-library-backdrop
) {
  opacity: 1;
  visibility: visible;
  transition: opacity var(--glass-focus-duration) ease;
}
@media (max-width: 699px) {
  .desktop-pages {
    padding-inline: 12px;
  }
  .desktop-menu {
    left: 4px;
    width: 48px;
    padding: 6px 2px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .desktop-header,
  .desktop-header :deep(.clock-time),
  .desktop-menu,
  .desktop-content :deep(.bottom-widgets),
  .desktop-library,
  .desktop-library-backdrop {
    transition: none;
  }
}
</style>
