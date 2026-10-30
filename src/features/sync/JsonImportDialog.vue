<script setup lang="ts">
import { ref, watch, shallowRef } from 'vue';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import {
  planJsonImport,
  commitJsonImport,
  type ImportPlan,
} from './import-json';
import { syncNow } from './client';
const open = defineModel<boolean>({ default: false });
const input = ref<HTMLInputElement>();
const file = ref<File>();
const includeSettings = ref(false),
  busy = ref(false),
  error = ref(''),
  done = ref(false);
const plan = shallowRef<ImportPlan>();
let request = 0;
async function preview() {
  const current = ++request;
  plan.value = undefined;
  error.value = '';
  done.value = false;
  if (!file.value) return;
  busy.value = true;
  try {
    if (file.value.size > 50 * 1024 * 1024) throw Error('JSON文件不能超过50MB');
    const value = await planJsonImport(
      await file.value.text(),
      includeSettings.value,
    );
    if (current === request) plan.value = value;
  } catch (e) {
    if (current === request)
      error.value = e instanceof Error ? e.message : '文件读取失败';
  } finally {
    if (current === request) busy.value = false;
  }
}
function choose(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0];
  void preview();
}
watch(includeSettings, preview);
watch(open, (value) => {
  if (value) {
    file.value = undefined;
    plan.value = undefined;
    error.value = '';
    done.value = false;
    includeSettings.value = false;
  }
});
async function submit() {
  if (!plan.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await commitJsonImport(plan.value);
    done.value = true;
    plan.value = undefined;
    await syncNow();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '导入失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <BaseDialog
    v-model:open="open"
    title="导入JSON文件"
    :width="620"
    solid
    close-button
  >
    <div class="import-content">
      <p class="intro">
        选择多鱼导出的JSON备份。收藏会添加到新的页面，保留当前数据。
      </p>
      <input
        ref="input"
        type="file"
        accept=".json,application/json"
        hidden
        @change="choose"
      />
      <button
        class="file-picker"
        type="button"
        :disabled="busy"
        @click="input?.click()"
      >
        <span class="file-symbol" aria-hidden="true">↥</span
        ><strong>{{ file?.name || '选择JSON文件' }}</strong
        ><span>最大50MB · 支持图片完整备份</span>
      </button>
      <label class="settings-option"
        ><input
          v-model="includeSettings"
          type="checkbox"
          :disabled="busy"
        />同时导入设置和自定义壁纸</label
      >
      <div v-if="plan" class="import-summary">
        <div v-for="(count, label) in plan.counts" :key="label">
          <strong>{{ count }}</strong
          ><span>{{ label }}</span>
        </div>
      </div>
      <p v-if="done" class="success" role="status">
        导入已保存，后续修改会自动同步。同步进度可在账号面板查看。
      </p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="open = false">
          {{ done ? '完成' : '取消' }}</button
        ><button
          v-if="!done"
          class="primary"
          type="button"
          :disabled="!plan || busy"
          @click="submit"
        >
          {{ busy ? '正在处理…' : '导入数据' }}
        </button>
      </div>
    </div>
  </BaseDialog>
</template>
<style scoped>
.import-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  color: #222;
  padding-bottom: 12px;
}
.intro {
  margin: 0;
  color: #777;
  font-size: 13px;
  line-height: 1.7;
}
.file-picker {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 10px;
  padding: 28px 16px;
  background: #f5f5f7;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
}
.file-picker span:last-child {
  color: #888;
  font-size: 12px;
}
.file-symbol {
  font-size: 28px;
  color: #777;
}
.file-picker strong {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
}
.settings-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.settings-option input {
  width: 16px;
  height: 16px;
  min-height: 0;
}
.import-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.import-summary div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  background: #f5f5f7;
  border-radius: 8px;
}
.import-summary strong {
  font-size: 22px;
}
.import-summary span {
  color: #777;
  font-size: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.actions button {
  height: 36px;
  padding: 0 18px;
  border: 0;
  border-radius: 6px;
  background: #f5f5f7;
  cursor: pointer;
}
.actions .primary {
  background: #000;
  color: white;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.error {
  color: #a43d39;
  font-size: 13px;
}
.success {
  color: #387449;
  font-size: 13px;
}
button:not(:disabled):hover {
  opacity: 0.7;
}
</style>
