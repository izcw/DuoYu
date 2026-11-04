<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseSelect from '../../shared/components/base/BaseSelect.vue';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import DialogLayout from '../../shared/components/base/DialogLayout.vue';
import AccountPanel from '../auth/AccountPanel.vue';
import JsonImportDialog from '../sync/JsonImportDialog.vue';
import { getSyncPreference, setSyncPreference } from '../sync/client';
import { accountStorage } from '../../shared/storage/account';
import { backupDesktop } from './desktop-backup';
import { settingsOpen, settingsSection, settingsPage } from './settings-state';
const menus = [
  { id: 'account', name: '账号与同步', icon: 'User' },
  { id: 'general', name: '常规设置', icon: 'Setting' },
  { id: 'backup', name: '备份与恢复', icon: 'Folder' },
] as const;
const glass = ref('real');
const automatic = ref(false);
const busy = ref(false);
const message = ref('');
const error = ref('');
const importOpen = ref(false);
watch(settingsOpen, async (open) => {
  if (!open) return;
  error.value = '';
  message.value = '';
  automatic.value =
    accountStorage.getItem('duoyu-layout-' + settingsPage.value) === 'auto';
  try {
    glass.value = String((await getSyncPreference('glassMode')) || 'real');
  } catch {
    error.value = '读取设置失败，请重新打开设置';
  }
}, { immediate: true });
async function run(task: () => Promise<unknown>, success = '') {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    await task();
    message.value = success;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}
function saveLayout(layout: string) {
  const value = layout === 'auto';
  void run(async () => {
    accountStorage.setItem(
      'duoyu-layout-' + settingsPage.value,
      value ? 'auto' : 'free',
    );
    automatic.value = value;
    window.dispatchEvent(new Event('duoyu-sync-preferences'));
  });
}
</script>
<template>
  <BaseDialog
    v-model:open="settingsOpen"
    title="设置"
    :width="920"
    :height="650"
    solid
    close-button
  >
    <DialogLayout
      v-model="settingsSection"
      :menus="menus"
      label="设置分类"
      @update:model-value="
        message = '';
        error = '';
      "
    >
      <h3>{{ menus.find((menu) => menu.id === settingsSection)?.name }}</h3>
      <AccountPanel v-if="settingsSection === 'account'" />
      <template v-else-if="settingsSection === 'general'">
        <div class="setting-row">
          <div>
            <strong>当前页面布局</strong>
            <p>选择图标和组件的排列方式</p>
          </div>
          <BaseSelect
            label="当前页面布局"
            :model-value="automatic ? 'auto' : 'free'"
            :disabled="busy"
            :options="[
              { value: 'free', label: '自由布局' },
              { value: 'auto', label: '自动布局' },
            ]"
            @update:model-value="saveLayout"
          />
        </div>
        <div class="setting-row">
          <div>
            <strong>玻璃效果</strong>
            <p>调整桌面图标和组件的材质</p>
          </div>
          <BaseSelect
            label="玻璃效果"
            :model-value="glass"
            :disabled="busy"
            :options="[
              { value: 'real', label: '真实' },
              { value: 'natural', label: '自然' },
              { value: 'soft', label: '柔和' },
            ]"
            @update:model-value="
              (value) =>
                run(async () => {
                  await setSyncPreference('glassMode', value);
                  glass = value;
                })
            "
          />
        </div>
      </template>
      <template v-else>
        <div class="setting-row">
          <div>
            <strong>备份桌面</strong>
            <p>导出网址、文件夹、组件、壁纸及设置</p>
          </div>
          <button
            class="primary"
            :disabled="busy"
            @click="run(backupDesktop, '备份文件已生成')"
          >
            {{ busy ? '正在备份…' : '导出备份' }}
          </button>
        </div>
        <div class="setting-row">
          <div>
            <strong>恢复备份</strong>
            <p>选择 JSON 文件，预览后确认导入</p>
          </div>
          <button :disabled="busy" @click="importOpen = true">导入备份</button>
        </div>
      </template>
      <p v-if="message" class="status" role="status">{{ message }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </DialogLayout>
  </BaseDialog>
  <JsonImportDialog v-model:open="importOpen" />
</template>
<style scoped>
h3 {
  font-size: 18px;
  margin: 0 0 24px;
  letter-spacing: -0.3px;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 22px;
  border: 1px solid #eaeaec;
  border-radius: 14px;
  margin-bottom: 16px;
}
button:focus-visible {
  outline: 2px solid #777;
  outline-offset: 3px;
}
.setting-row button:hover {
  filter: brightness(0.96);
}
strong {
  font-size: 14px;
  font-weight: 500;
}
p {
  color: #888;
  font-size: 12px;
  line-height: 1.6;
  margin: 8px 0 0;
}
.setting-row button,
select {
  border: 0;
  border-radius: 10px;
  font-size: 13px;
  cursor: pointer;
  padding: 12px 16px;
  background: #f5f5f7;
  flex-shrink: 0;
}
.setting-row button.primary {
  background: #000;
  color: #fff;
}
button:disabled,
select:disabled {
  opacity: 0.5;
  cursor: wait;
}
.error {
  color: #b33b32;
}
.status {
  color: #52725a;
}
@media (max-width: 640px) {
  .setting-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
}
</style>
