<script setup lang="ts">
import BaseDialog from './BaseDialog.vue';
defineProps<{
  open: boolean;
  title: string;
  formLabel?: string;
  submitLabel: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ close: []; submit: [] }>();
</script>
<template>
  <BaseDialog
    :open="open"
    :title="title"
    solid
    close-button
    :width="680"
    @update:open="emit('close')"
  >
    <form
      class="library-editor floating-editor"
      :aria-label="formLabel || title"
      @submit.prevent="emit('submit')"
    >
      <slot />
      <div class="library-form-actions">
        <button
          type="button"
          class="glass-control glass-interactive"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="submit"
          class="glass-control glass-interactive"
          :disabled="disabled"
        >
          {{ submitLabel }}
        </button>
      </div>
      <slot name="feedback" />
    </form>
  </BaseDialog>
</template>
<style scoped>
.floating-editor {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  margin: 0;
  background: none;
  box-shadow: none;
  --editor-section-gap: 18px;
  --editor-label-gap: 8px;
}
.floating-editor .library-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
  padding: 18px 0 16px;
  border-top: 1px solid #eee;
}
.floating-editor .library-form-actions button {
  min-width: 82px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 20px;
  border: 0;
  border-radius: 6px;
  background: #f5f5f7;
  color: #222;
  font-size: 14px;
  cursor: pointer;
}
.floating-editor .library-form-actions button:last-child {
  background: #000;
  color: white;
}
.floating-editor .library-form-actions button:hover:not(:disabled) {
  opacity: 0.7;
}
.floating-editor .library-form-actions button:disabled {
  opacity: 0.45;
  cursor: default;
}
.floating-editor :deep(label),
.floating-editor :deep(legend) {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: #444;
}
.floating-editor :deep(label) {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.floating-editor :deep(input),
.floating-editor :deep(select) {
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  padding: 7px 10px;
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
  color: inherit;
  background: #fafafa;
  border-radius: 9px;
}
.floating-editor :deep(input),
.floating-editor :deep(textarea),
.floating-editor :deep(button:not(.color-row button)) {
  border: 0 !important;
}
.floating-editor :deep(input:not(.inline-icon-editor)),
.floating-editor :deep(textarea) {
  background: #f5f5f7;
  border-radius: 6px;
}
.floating-editor :deep(input::placeholder) {
  color: #aaa;
}
</style>
