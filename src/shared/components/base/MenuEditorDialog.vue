<script setup lang="ts">
import BaseDialog from './BaseDialog.vue';
import PageIconPicker from './PageIconPicker.vue';
defineProps<{
  open: boolean;
  title: string;
  adding: boolean;
  space?: boolean;
  busy: boolean;
  error?: string;
}>();
const name = defineModel<string>('name', { required: true });
const icon = defineModel<string>('icon', { required: true });
const emit = defineEmits<{ close: []; submit: [] }>();
</script>
<template>
  <BaseDialog
    :open="open"
    :title="title"
    :width="460"
    @update:open="emit('close')"
  >
    <form class="page-editor-form" @submit.prevent="emit('submit')">
      <label
        >{{ space ? '空间名称' : '页面名称'
        }}<input
          autofocus
          v-model="name"
          :maxlength="space ? 40 : 30"
          :aria-label="space ? '空间名称' : '收藏页名称'"
          :placeholder="space ? '输入空间名称' : '输入页面名称'"
          required
      /></label>
      <span>{{ space ? '空间图标' : '页面图标' }}</span>
      <PageIconPicker v-model="icon" />
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="page-editor-actions">
        <button
          type="button"
          class="glass-control glass-interactive"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          class="glass-control glass-interactive"
          :disabled="busy || !name.trim()"
          type="submit"
        >
          {{ adding ? '添加' : '保存' }}
        </button>
      </div>
    </form>
  </BaseDialog>
</template>
<style scoped>
.page-editor-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.page-editor-form label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.page-editor-form input {
  padding: 10px 12px;
  border: 1px solid #ffffff30;
  background: #ffffff12;
  color: inherit;
  border-radius: 10px;
}
.page-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}
.page-editor-actions button {
  padding: 10px 18px;
  color: inherit;
  border-radius: 10px;
}
input {
  width: 100%;
  box-sizing: border-box;
}
p {
  font-size: 11px;
}
</style>

<style scoped>
.library-home {
  margin-bottom: 6px;
}
</style>
