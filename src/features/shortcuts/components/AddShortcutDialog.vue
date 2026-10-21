<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseDialog from '../../../shared/components/base/BaseDialog.vue';
import type { ShortcutItem } from '../../../shared/storage/database';
const props = defineProps<{ open: boolean; busy: boolean }>();
const emit = defineEmits<{
  'update:open': [value: boolean];
  submit: [item: ShortcutItem];
}>();
const name = ref('');
const url = ref('');
const error = ref('');
watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = '';
      url.value = '';
      error.value = '';
    }
  },
);
function submit() {
  if (props.busy) return;
  let address: URL;
  try {
    address = new URL(url.value.trim());
    if (!['http:', 'https:'].includes(address.protocol)) throw new Error();
  } catch {
    error.value = '请输入完整的 http:// 或 https:// 网址';
    return;
  }
  if (!name.value.trim()) {
    error.value = '请输入名称';
    return;
  }
  emit('submit', {
    id: crypto.randomUUID(),
    name: name.value.trim(),
    url: address.href,
    icon: new URL('/favicon.ico', address).href,
  });
}
</script>
<template>
  <BaseDialog
    :open="open"
    title="添加快捷网址"
    @update:open="emit('update:open', $event)"
  >
    <form class="shortcut-dialog" @submit.prevent="submit">
      <label for="shortcut-name">名称</label
      ><input
        id="shortcut-name"
        class="glass-surface glass-field"
        v-model="name"
        maxlength="40"
        required
        autocomplete="off"
      />
      <label for="shortcut-url">网址</label
      ><input
        id="shortcut-url"
        class="glass-surface glass-field"
        v-model="url"
        placeholder="https://example.com"
        required
        autocomplete="off"
      />
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="shortcut-dialog-actions">
        <button
          class="glass-surface glass-interactive"
          type="button"
          @click="emit('update:open', false)"
        >
          取消</button
        ><button
          class="glass-surface glass-interactive"
          type="submit"
          :disabled="busy"
        >
          添加
        </button>
      </div>
    </form>
  </BaseDialog>
</template>
<style scoped>
label {
  display: block;
  margin: 12px 0 6px;
  font-size: 14px;
}
input {
  width: 100%;
  height: 42px;
  border-radius: 12px;
  padding: 0 12px;
}
p {
  font-size: 13px;
  color: #ffd3ca;
}
.shortcut-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
button {
  border: 0;
  border-radius: 12px;
  padding: 9px 18px;
  cursor: pointer;
  transition: transform 140ms ease;
}
button:active {
  transform: scale(0.97);
}
</style>
