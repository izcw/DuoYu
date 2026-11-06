<script setup lang="ts">
import EditorDialog from './EditorDialog.vue';
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
  <EditorDialog
    :open="open"
    :title="title"
    :submit-label="adding ? '添加' : '保存'"
    :disabled="busy || !name.trim()"
    @close="emit('close')"
    @submit="emit('submit')"
  >
    <label class="editor-field"
      >{{ space ? '空间名称' : '页面名称' }}
      <input
        autofocus
        v-model="name"
        :maxlength="space ? 40 : 30"
        :aria-label="space ? '空间名称' : '收藏页名称'"
        :placeholder="space ? '输入空间名称' : '输入页面名称'"
        required
      />
    </label>
    <div class="editor-field">
      <span>{{ space ? '空间图标' : '页面图标' }}</span>
      <PageIconPicker v-model="icon" />
    </div>
    <template #feedback
      ><p v-if="error" role="alert">{{ error }}</p></template
    >
  </EditorDialog>
</template>
<style scoped>
.editor-field {
  display: grid;
  gap: 8px;
  color: #444;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}
.editor-field input {
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  border: 0;
  border-radius: 6px;
  background: #f5f5f7;
  padding: 7px 12px;
  font-size: 14px;
}
</style>
