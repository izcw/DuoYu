<script setup lang="ts">
import { browser } from 'wxt/browser';

const version = browser.runtime.getManifest().version;
</script>

<template>
  <main class="popup-panel" aria-label="多鱼">
    <header class="popup-header">
      <img src="/icons/48.png" width="28" height="28" alt="多鱼" />
      <span class="popup-version" aria-label="版本">{{ version }}</span>
    </header>
  </main>
</template>
