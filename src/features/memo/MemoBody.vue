<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import Bold from '@icon-park/vue-next/es/icons/TextBold';
import Underline from '@icon-park/vue-next/es/icons/TextUnderline';
import Strike from '@icon-park/vue-next/es/icons/Strikethrough';
import Tag from '@icon-park/vue-next/es/icons/Tag';
import Bullets from '@icon-park/vue-next/es/icons/UnorderedList';
import Numbers from '@icon-park/vue-next/es/icons/OrderedList';
import { cleanMemoHtml } from './markup';

const props = defineProps<{ body: string; html?: string; readonly: boolean }>();
const emit = defineEmits<{ save: [text: string, html: string] }>();
const field = ref<HTMLElement>();
const tagInput = ref<HTMLInputElement>();
const tagging = ref(false);
const tag = ref('');
let selection: Range | undefined;
const tools = [
  { title: '加粗', icon: Bold, command: 'bold' },
  { title: '标签', icon: Tag, command: 'tag' },
  { title: '无序列表', icon: Bullets, command: 'insertUnorderedList' },
  { title: '有序列表', icon: Numbers, command: 'insertOrderedList' },
  { title: '下划线', icon: Underline, command: 'underline' },
  { title: '删除线', icon: Strike, command: 'strikeThrough' },
];
const safeHtml = computed(() =>
  props.html === undefined ? undefined : cleanMemoHtml(props.html),
);
function render() {
  const el = field.value;
  if (!el || document.activeElement === el || tagging.value) return;
  if (safeHtml.value === undefined) el.textContent = props.body;
  else if (el.innerHTML !== safeHtml.value) el.innerHTML = safeHtml.value;
}
onMounted(render);
watch([safeHtml, () => props.body, () => props.readonly], render, {
  flush: 'post',
});
function save() {
  if (field.value && !props.readonly)
    emit('save', field.value.innerText, cleanMemoHtml(field.value.innerHTML));
}
function remember() {
  const sel = window.getSelection();
  if (
    sel?.rangeCount &&
    field.value?.contains(sel.getRangeAt(0).commonAncestorContainer)
  )
    selection = sel.getRangeAt(0).cloneRange();
}
function focus() {
  field.value?.focus({ preventScroll: true });
}
function restore() {
  focus();
  if (selection && field.value?.contains(selection.commonAncestorContainer)) {
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(selection);
  }
}
function format(command: string) {
  if (props.readonly) return;
  restore();
  if (command === 'tag') {
    remember();
    tag.value = selection?.toString() || '';
    tagging.value = true;
    nextTick(() => tagInput.value?.select());
  } else {
    document.execCommand('styleWithCSS', false, 'false');
    if (['p', 'h1', 'h2', 'h3'].includes(command)) {
      const block = document.queryCommandValue('formatBlock').toLowerCase();
      document.execCommand(
        'formatBlock',
        false,
        block === command ? 'p' : command,
      );
    } else document.execCommand(command);
    remember();
  }
}
function closeTag(insert: boolean) {
  const value = tag.value.trim().replace(/^#+/, '');
  tagging.value = false;
  restore();
  if (insert && value) {
    const chip = document.createElement('mark');
    chip.textContent = '#' + value;
    document.execCommand('insertHTML', false, chip.outerHTML + '&nbsp;');
  }
  remember();
}
function leave(event: FocusEvent) {
  if (
    tagging.value &&
    !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)
  )
    tagging.value = false;
}
function paste(event: ClipboardEvent) {
  event.preventDefault();
  if (props.readonly || !event.clipboardData) return;
  const html = event.clipboardData.getData('text/html');
  if (html) document.execCommand('insertHTML', false, cleanMemoHtml(html));
  else
    document.execCommand(
      'insertText',
      false,
      event.clipboardData.getData('text/plain'),
    );
}
defineExpose({ focus });
</script>
<template>
  <div class="memo-body" @focusout="leave">
    <div
      ref="field"
      class="memo-text"
      :contenteditable="!readonly"
      :role="readonly ? undefined : 'textbox'"
      :aria-label="readonly ? undefined : '便签正文'"
      :aria-multiline="readonly ? undefined : true"
      @input="save"
      @mouseup="remember"
      @keyup="remember"
      @blur="remember"
      @paste="paste"
      @drop.prevent
    />
    <div
      v-if="!readonly"
      class="memo-format-bar"
      role="toolbar"
      aria-label="便签格式"
    >
      <template v-if="tagging">
        <input
          ref="tagInput"
          v-model="tag"
          maxlength="80"
          aria-label="标签名称"
          placeholder="标签名称"
          @keydown.enter.prevent="closeTag(true)"
          @keydown.esc.stop.prevent="closeTag(false)"
        />
        <button
          type="button"
          aria-label="插入标签"
          @mousedown.prevent
          @click="closeTag(true)"
        >
          ✓
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          title="普通文字"
          @mousedown.prevent="remember"
          @click="format('p')"
        >
          普通文字
        </button>
        <button
          v-for="level in 3"
          :key="level"
          type="button"
          :aria-label="level + '级标题'"
          :title="level + '级标题'"
          @mousedown.prevent="remember"
          @click="format('h' + level)"
        >
          H{{ level }}
        </button>
        <button
          v-for="tool in tools"
          :key="tool.command"
          type="button"
          :aria-label="tool.title"
          :title="tool.title"
          @mousedown.prevent="remember"
          @click="format(tool.command)"
        >
          <component :is="tool.icon" :size="15" fill="currentColor" />
        </button>
      </template>
    </div>
  </div>
</template>
