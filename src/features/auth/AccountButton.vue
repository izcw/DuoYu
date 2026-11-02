<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import { openSettings } from '../desktop/settings-state';
import { AUTH_SESSION_KEY, type AuthView } from './config';
const view = ref<AuthView>({ account: null });
const busy = ref(false),
  error = ref(''),
  imageFailed = ref(false);
let timer: ReturnType<typeof setInterval>;
async function action(action: 'status' | 'login' | 'logout') {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await browser.runtime.sendMessage({
      type: 'duoyu-auth',
      action,
    });
    if (result?.error) error.value = result.error;
    else if (result?.view) {
      view.value = result.view;
      imageFailed.value = false;
    } else error.value = '登录服务未响应，请重新加载扩展';
  } catch {
    error.value = '登录服务未响应，请重新加载扩展';
  } finally {
    busy.value = false;
  }
}
function sync(changes: Record<string, { newValue?: unknown }>) {
  if (!(AUTH_SESSION_KEY in changes)) return;
  // Only the public profile enters Vue state; credentials stay in the background.
  const session = changes[AUTH_SESSION_KEY]?.newValue as
    { account?: AuthView['account'] } | undefined;
  view.value = { account: session?.account ?? null };
  imageFailed.value = false;
}
function focus() {
  if (document.visibilityState === 'visible') void action('status');
}
onMounted(() => {
  void action('status');
  browser.storage.session.onChanged.addListener(sync);
  window.addEventListener('focus', focus);
  document.addEventListener('visibilitychange', focus);
  timer = setInterval(focus, 60000);
});
onUnmounted(() => {
  clearInterval(timer);
  browser.storage.session.onChanged.removeListener(sync);
  window.removeEventListener('focus', focus);
  document.removeEventListener('visibilitychange', focus);
});
</script>
<template>
  <Teleport to="body">
    <button
      class="account-entry"
      type="button"
      :aria-label="view.account ? '我的账号' : '登录多鱼账号'"
      :title="view.account?.name || '登录多鱼账号'"
      @click.stop="openSettings('account')"
      @pointerdown.stop
      @contextmenu.stop
    >
      <img
        :src="
          view.account?.picture && !imageFailed
            ? view.account.picture
            : '/images/user.png'
        "
        alt=""
        draggable="false"
        @error="imageFailed = true"
      />
    </button>
  </Teleport>
</template>
<style scoped>
.account-entry {
  position: fixed;
  top: 16px;
  right: 22px;
  z-index: 2147483001;
  width: 36px;
  height: 36px;
  padding: 2px;
  border: 0;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
}
.account-entry img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
  filter: drop-shadow(0 1px 2px #0003);
}
.account-entry:hover {
  opacity: 0.8;
}
.account-entry:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 4px;
}
</style>
