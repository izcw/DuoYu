<script setup lang="ts">
import { ref } from 'vue';
import WorkspaceOverlay from '../../features/workspace/WorkspaceOverlay.vue';
import WallpaperBackground from '../../features/wallpaper/WallpaperBackground.vue';
import ClockWidget from '../../features/clock/ClockWidget.vue';
import SearchBox from '../../features/search/SearchBox.vue';
import DesktopGrid from '../../features/desktop/DesktopGrid.vue';
import BottomWidgets from '../../features/desktop/BottomWidgets.vue';
import WallpaperWheel from '../../features/shortcuts/WallpaperWheel.vue';
import LibraryBoard from '../../features/library/LibraryBoard.vue';
const workspaceOpen = ref(false);
const libraryOpen = ref(false);
</script>

<template>
  <WallpaperBackground />
  <WallpaperWheel
    @workspace="workspaceOpen = true"
    @library="libraryOpen = true"
  />
  <WorkspaceOverlay v-model="workspaceOpen" />
  <WorkspaceOverlay v-model="libraryOpen" label="收藏库" :blank-entry="false">
    <LibraryBoard @close="libraryOpen = false" />
  </WorkspaceOverlay>
  <main class="newtab" :inert="workspaceOpen || libraryOpen">
    <section class="start-panel" aria-label="时间与搜索">
      <ClockWidget />
      <SearchBox />
    </section>
    <DesktopGrid />
    <BottomWidgets />
  </main>
</template>
