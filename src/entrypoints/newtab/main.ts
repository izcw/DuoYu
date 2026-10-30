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
  if (!(await initializeCloud())) return;
  const mode = await loadGlassMode();
  document.documentElement.dataset.glassMode = mode;
  createApp(App).provide(initialGlassModeKey, mode).mount('#app');
  printConsoleBanner();
}

void bootstrap();
