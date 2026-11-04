import { createApp } from 'vue';
import { initializeCloud } from '../../features/sync/client';
import App from './App.vue';
import '../../styles/main.css';
import { printConsoleBanner } from '../../shared/console-banner';
import {
  initialGlassModeKey,
  loadGlassMode,
} from '../../features/desktop/glass/preferences';

async function bootstrap() {
  const mode = await loadGlassMode();
  document.documentElement.dataset.glassMode = mode;
  createApp(App).provide(initialGlassModeKey, mode).mount('#app');
  printConsoleBanner();
  // Rendering the account-scoped local database must never wait for network
  // authentication, queued uploads, or remote wallpaper downloads. Account
  // changes still go through initializeCloud's checked reload boundary.
  requestAnimationFrame(() => {
    setTimeout(() => void initializeCloud().catch(() => {}), 0);
  });
}

void bootstrap();
