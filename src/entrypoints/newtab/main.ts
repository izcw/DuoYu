import { createApp } from 'vue';
import { accountKey, initializeCloud } from '../../features/sync/client';
import { browser } from 'wxt/browser';
import { AUTH_SESSION_KEY, type Account } from '../../features/auth/config';
import {
  ACCOUNT_STORAGE_KEY,
  guestMode,
  pageAccountKey,
} from '../../shared/storage/account';
import { loadGuestTemplate } from '../../features/sync/guest-template';
import App from './App.vue';
import '../../styles/main.css';
import { printConsoleBanner } from '../../shared/console-banner';
import {
  initialGlassModeKey,
  loadGlassMode,
} from '../../features/desktop/glass/preferences';

async function bootstrap() {
  if (pageAccountKey) {
    // A persisted database name alone is not a signed-in session.
    const session = (await browser.storage.session.get(AUTH_SESSION_KEY))[
      AUTH_SESSION_KEY
    ] as { account?: Account } | undefined;
    const account =
      session?.account ??
      (
        await browser.runtime
          .sendMessage({ type: 'duoyu-auth', action: 'status' })
          .catch(() => null)
      )?.view?.account;
    const owner = account ? await accountKey(account) : '';
    if (owner !== pageAccountKey) {
      localStorage.setItem(ACCOUNT_STORAGE_KEY, owner);
      location.reload();
      return;
    }
  } else {
    void loadGuestTemplate();
    window.addEventListener('online', loadGuestTemplate);
  }
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
