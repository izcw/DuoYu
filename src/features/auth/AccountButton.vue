<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import { authConfig, AUTH_SESSION_KEY, type AuthView } from './config';
import {
  syncState,
  syncNow,
  importGuest,
  exportConflicts,
} from '../sync/client';
async function cloudAction(task: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await task();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '同步操作失败';
  } finally {
    busy.value = false;
  }
}
const view = ref<AuthView>({ account: null });
const open = ref(false),
  busy = ref(false),
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
function accountCenter() {
  void browser.tabs.create({ url: `${authConfig.issuer}/#/account/profile` });
}
</script>
<template>
  <Teleport to="body">
    <button
      class="account-entry"
      type="button"
      :aria-label="view.account ? '我的账号' : '登录多鱼账号'"
      :title="view.account?.name || '登录多鱼账号'"
      @click.stop="open = true"
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
  <BaseDialog
    v-model:open="open"
    :title="view.account ? '我的账号' : '登录多鱼账号'"
    :width="360"
  >
    <div class="account-panel">
      <template v-if="view.account">
        <strong>{{ view.account.name || '多鱼用户' }}</strong>
        <p>{{ view.account.email }}</p>
        <button type="button" @click="accountCenter">账号与安全</button>
        <p class="account-message" role="status">
          云同步：{{ syncState.status
          }}<template v-if="syncState.pending">
            · {{ syncState.pending }} 项待上传</template
          >
        </p>
        <p v-if="syncState.error" class="account-message">
          {{ syncState.error }}
        </p>
        <button type="button" :disabled="busy" @click="cloudAction(syncNow)">
          立即同步
        </button>
        <button
          type="button"
          :disabled="busy"
          @click="cloudAction(importGuest)"
        >
          导入本机数据到空账号
        </button>
        <button
          v-if="syncState.conflicts"
          type="button"
          @click="cloudAction(exportConflicts)"
        >
          导出冲突副本（{{ syncState.conflicts }}）
        </button>
        <button type="button" :disabled="busy" @click="action('logout')">
          退出登录
        </button>
      </template>
      <template v-else>
        <p>使用多鱼账号登录</p>
        <button type="button" :disabled="busy" @click="action('login')">
          {{ busy ? '正在连接…' : '前往登录' }}
        </button>
      </template>
      <p v-if="error || view.warning" class="account-message" role="status">
        {{ error || view.warning }}
      </p>
    </div>
  </BaseDialog>
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
.account-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.account-panel p {
  margin: 0;
  overflow-wrap: anywhere;
}
.account-panel button {
  padding: 12px 16px;
  border: 0;
  border-radius: 12px;
  color: #fff;
  background: #ffffff20;
  cursor: pointer;
}
.account-panel button:hover {
  background: #ffffff30;
}
.account-panel button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.account-message {
  font-size: 13px;
  line-height: 1.6;
}
</style>
