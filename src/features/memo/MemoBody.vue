<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Memo } from '../../shared/storage/database';
import { renderMemo } from './markdown';
import { memoNeedsRetry, readMemoDraft, writeMemoDraft } from './memo-draft';

const props = defineProps<{
  note: Memo;
  saveBody: (source: string) => Promise<boolean>;
  readonly: boolean;
}>();
const source = computed(() => readMemoDraft(props.note));
const html = computed(() => renderMemo(source.value));
const field = ref<HTMLElement>();
const preview = ref<HTMLElement>();
const editing = ref(false);
let toEditorHtml = renderMemo;
let editor: import('@tiptap/core').Editor | undefined;
let lastSaved = '';
let modified = false;
let composing = false;
let opening = 0;

function save() {
  if (!editor || composing || (!modified && !memoNeedsRetry(props.note.id)))
    return;
  const value = editor.getMarkdown();
  if (value === lastSaved && !memoNeedsRetry(props.note.id)) return;
  lastSaved = value;
  void writeMemoDraft(props.note, value, props.saveBody);
}
async function focus(point?: { left: number; top: number }) {
  if (props.readonly || editing.value) return;
  editing.value = true;
  const token = ++opening;
  const { createMemoEditor, editableMemoHtml } = await import('./rich-editor');
  toEditorHtml = editableMemoHtml;
  await nextTick();
  if (token !== opening || !field.value) return;
  modified = composing = false;
  lastSaved = source.value;
  editor = createMemoEditor(field.value, source.value, () => {
    modified = true;
    save();
  });
  const position = point && editor.view.posAtCoords(point)?.pos;
  if (position !== undefined) editor.commands.setTextSelection(position);
  editor.view.focus();
  window.addEventListener('pagehide', endComposition, true);
}
function openEditor(event: MouseEvent) {
  if (!(event.target as Element).closest('a'))
    void focus({ left: event.clientX, top: event.clientY });
}
function endComposition() {
  composing = false;
  // A page can close before ProseMirror's DOM observer receives the last input.
  if (editor)
    (
      editor.view as unknown as { domObserver: { flush(): void } }
    ).domObserver.flush();
  save();
}
function finish() {
  ++opening;
  endComposition();
  editor?.destroy();
  editor = undefined;
  editing.value = false;
  window.removeEventListener('pagehide', endComposition, true);
}
onBeforeUnmount(finish);
function escape(event: KeyboardEvent) {
  if (event.isComposing || composing || event.keyCode === 229) return;
  event.preventDefault();
  event.stopPropagation();
  finish();
  void nextTick(() => preview.value?.focus({ preventScroll: true }));
}
watch(source, (value) => {
  if (editor && !modified && !composing && value !== lastSaved) {
    lastSaved = value;
    editor.commands.setContent(toEditorHtml(value), { emitUpdate: false });
  }
});
defineExpose({ focus: () => focus() });
</script>

<template>
  <div class="memo-body">
    <div
      v-if="editing && !readonly"
      ref="field"
      class="memo-text memo-preview memo-writing"
      @compositionstart="composing = true"
      @compositionend="endComposition"
      @keydown.tab.capture.stop
      @keydown.esc.capture="escape"
      @focusout="!field?.contains($event.relatedTarget as Node) && finish()"
    ></div>
    <div
      v-else
      ref="preview"
      class="memo-text memo-preview"
      :tabindex="readonly ? undefined : 0"
      :aria-label="readonly ? undefined : '编辑便签正文'"
      :data-placeholder="readonly ? '' : '写点什么…'"
      @click="openEditor"
      @keydown.enter.self.stop.prevent="focus()"
      v-html="html"
    ></div>
  </div>
</template>

<style scoped>
.memo-writing :deep(.memo-document) {
  min-height: 100%;
  outline: none;
  white-space: pre-wrap;
}
.memo-preview {
  white-space: normal;
}
.memo-preview[tabindex] {
  cursor: text;
}
.memo-preview
  :deep(:is(p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table)) {
  margin-block: 0 0.4em;
}
.memo-preview :deep(:last-child) {
  margin-bottom: 0;
}
.memo-preview :deep(blockquote) {
  margin-inline: 0;
  border-inline-start: 2px solid currentColor;
  padding-inline-start: 0.65em;
}
.memo-preview :deep(code) {
  background: color-mix(in srgb, currentColor 9%, transparent);
  border-radius: 3px;
  padding-inline: 0.18em;
}
.memo-preview :deep(pre) {
  overflow-x: auto;
  white-space: pre;
}
.memo-preview :deep(a) {
  color: inherit;
  text-decoration: underline;
}
.memo-preview :deep(img) {
  max-width: 100%;
  height: auto;
}
.memo-preview :deep(input[type='checkbox']) {
  margin: 0 0.35em 0 0;
}
.memo-preview :deep(table) {
  border-collapse: collapse;
}
.memo-preview :deep(:is(th, td)) {
  padding: 0.12em 0.4em;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
}
</style>
