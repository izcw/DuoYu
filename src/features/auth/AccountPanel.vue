<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import { authConfig, AUTH_SESSION_KEY, type AuthView } from './config';
import {
  syncState,
  syncNow,
  formatSyncTime,
  reloadSyncExtension,
} from '../sync/client';
import ConflictCenter from '../sync/ConflictCenter.vue';
const conflictsOpen = ref(false);
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
function accountCenter() {
  void browser.tabs.create({ url: `${authConfig.issuer}/#/account/profile` });
}
</script>
<template>
  <div class="account-panel">
    <div class="profile-card">
      <img
        class="profile-avatar"
        :src="
          view.account?.picture && !imageFailed
            ? view.account.picture
            : '/images/user.png'
        "
        alt="账号头像"
        referrerpolicy="no-referrer"
        @error="imageFailed = true"
      />
      <div class="profile-info">
        <strong>{{
          view.account ? view.account.name || '多鱼用户' : '登录多鱼账号'
        }}</strong>
        <p>{{ view.account?.email || '登录后，在不同设备间同步你的桌面' }}</p>
      </div>
      <button v-if="view.account" type="button" @click="accountCenter">
        账号与安全
      </button>
      <button
        v-else
        class="primary"
        type="button"
        :disabled="busy"
        @click="action('login')"
      >
        {{ busy ? '正在连接…' : '前往登录' }}
      </button>
    </div>
    <template v-if="view.account">
      <section class="sync-card" aria-label="云同步">
        <div class="sync-heading">
          <strong>云同步</strong
          ><span class="sync-badge" role="status">{{ syncState.status }}</span>
        </div>
        <p v-if="syncState.pending" class="account-message">
          {{ syncState.pending }} 项更改待上传
        </p>
        <p v-if="syncState.lastSyncedAt" class="account-message sync-time">
          最近同步：{{ formatSyncTime(syncState.lastSyncedAt) }}
        </p>
        <p v-if="syncState.assetError" class="account-message warning">
          {{ syncState.assetError }}
        </p>
        <p v-if="syncState.error" class="account-message warning">
          {{ syncState.error }}
        </p>
        <div class="account-actions">
          <button
            class="primary"
            type="button"
            :disabled="busy"
            @click="cloudAction(syncNow)"
          >
            {{ busy ? '正在处理…' : '立即同步' }}
          </button>
          <button
            v-if="syncState.conflicts"
            type="button"
            @click="conflictsOpen = true"
          >
            处理同步更改（{{ syncState.conflicts }}）
          </button>
          <button
            v-if="syncState.needsReload"
            type="button"
            @click="reloadSyncExtension"
          >
            重新加载扩展并恢复同步
          </button>
        </div>
      </section>
      <div class="account-footer">
        <button
          class="logout"
          type="button"
          :disabled="busy"
          @click="action('logout')"
        >
          退出登录
        </button>
      </div>
    </template>
    <p
      v-if="error || view.warning"
      class="account-message warning"
      role="status"
    >
      {{ error || view.warning }}
    </p>
  </div>
  <ConflictCenter v-model:open="conflictsOpen" />
</template>
<style scoped>
.account-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.profile-card {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 22px;
  background: #f5f5f7;
  border-radius: 16px;
}
.profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: #fff;
  border: 3px solid #fff;
  box-sizing: border-box;
}
.profile-info {
  flex: 1;
  min-width: 120px;
}
.profile-info strong {
  display: block;
  font-size: 18px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.profile-info p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #85858c;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.account-panel button {
  padding: 11px 16px;
  border: 0;
  border-radius: 9px;
  color: #333;
  background: #f5f5f7;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.profile-card button {
  background: #fff;
}
.account-panel button:hover {
  background: #e9e9ed;
}
.account-panel button.primary {
  background: #111;
  color: #fff;
}
.account-panel button.primary:hover {
  background: #333;
}
.account-panel button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.account-panel button:focus-visible {
  outline: 2px solid #777;
  outline-offset: 3px;
}
.sync-card {
  padding: 22px;
  border: 1px solid #eaeaec;
  border-radius: 16px;
}
.sync-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
.sync-heading strong {
  font-size: 14px;
  font-weight: 600;
}
.sync-badge {
  background: #f5f5f7;
  color: #64646c;
  border-radius: 6px;
  padding: 5px 9px;
  font-size: 11px;
}
.account-message {
  margin: 6px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #85858c;
  overflow-wrap: anywhere;
}
.account-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}
.account-footer {
  display: flex;
  justify-content: flex-end;
}
.account-panel .logout {
  color: #ad4545;
  background: transparent;
}
.account-panel .logout:hover {
  background: #fff2f2;
}
.warning {
  color: #b44a3c;
}
</style>
