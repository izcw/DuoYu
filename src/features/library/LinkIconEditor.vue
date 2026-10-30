<script setup lang="ts">
import { iconForeground } from '../../shared/icon-material';
import { DESKTOP_GRID_CELL_WIDTH } from './grid-config';
import TextIcon from '../../shared/components/base/TextIcon.vue';
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
const previewRegion = ref<HTMLElement>();
const wallpaperPosition = ref({});
let frame = 0;
let previousBounds = '';
function alignWallpaper() {
  const rect = previewRegion.value?.getBoundingClientRect();
  if (rect) {
    const bounds = [
      rect.left,
      rect.top,
      window.innerWidth,
      window.innerHeight,
    ].join(',');
    if (bounds !== previousBounds) {
      previousBounds = bounds;
      wallpaperPosition.value = {
        width: `${window.innerWidth}px`,
        height: `${window.innerHeight}px`,
        left: `${-rect.left}px`,
        top: `${-rect.top}px`,
      };
    }
  }
  frame = requestAnimationFrame(alignWallpaper);
}
onMounted(alignWallpaper);
onUnmounted(() => cancelAnimationFrame(frame));
const model = defineModel<string>({ required: true });
const props = defineProps<{ url: string; title: string }>();
const textEdited = ref(false);
const mode = ref('auto'),
  text = ref(''),
  upload = ref(''),
  color = ref('');
const material = ref<'glass' | 'fill'>('glass');
const hoveredColor = ref<string | null>(null);
const previewColor = computed(() => hoveredColor.value ?? color.value);
const editingText = ref(false);
const textInput = ref<HTMLInputElement>();
const selectionStart = ref(0),
  selectionEnd = ref(0);
function syncTextSelection() {
  selectionStart.value = textInput.value?.selectionStart ?? 0;
  selectionEnd.value = textInput.value?.selectionEnd ?? 0;
}
onMounted(() =>
  document.addEventListener('selectionchange', syncTextSelection),
);
onUnmounted(() =>
  document.removeEventListener('selectionchange', syncTextSelection),
);
function placeTextCaret(offset: number, extend: boolean) {
  const input = textInput.value;
  if (!input) return;
  const anchor = extend ? (input.selectionStart ?? offset) : offset;
  input.focus();
  input.setSelectionRange(Math.min(anchor, offset), Math.max(anchor, offset));
  syncTextSelection();
}
async function selectText() {
  if (mode.value !== 'text') {
    mode.value = 'text';
    return;
  }
  editingText.value = true;
  await nextTick();
  textInput.value?.focus();
  textInput.value?.select();
  syncTextSelection();
}
watch(mode, () => {
  editingText.value = false;
});
const error = ref('');
const fileInput = ref<HTMLInputElement>();
const refresh = ref(0);
function automatic() {
  mode.value = 'auto';
  refresh.value++;
}
const colorRows = [
  {
    name: '中性色',
    names: ['透明', '白色', '白灰', '灰色', '黑色'],
    values: ['', '#ffffff', '#e5e7eb', '#808080', '#000000'],
  },
  {
    name: '蓝',
    values: ['#004cff', '#2878ff', '#54a0ff', '#91c5ff', '#d5eaff'],
  },
  {
    name: '紫',
    values: ['#6200ee', '#8938ff', '#ab6cff', '#c9a0ff', '#ecdcff'],
  },
  {
    name: '粉',
    values: ['#e60080', '#ff32a0', '#ff70bd', '#ffa7d6', '#ffdeef'],
  },
  {
    name: '红',
    values: ['#e60024', '#ff334d', '#ff6b7c', '#ffa3ad', '#ffdbdf'],
  },
  {
    name: '橙',
    values: ['#f56b00', '#ff8b20', '#ffac52', '#ffce91', '#ffe9cc'],
  },
  {
    name: '黄',
    values: ['#efbe00', '#ffd000', '#ffe047', '#ffed8a', '#fff8ce'],
  },
  {
    name: '绿',
    values: ['#00a64c', '#12c96c', '#4ddd91', '#94edbb', '#d4f9e3'],
  },
];
function swatchName(row: (typeof colorRows)[number], index: number) {
  return (
    row.names?.[index] || ['深', '较深', '标准', '较浅', '浅'][index] + row.name
  );
}
function swatchInk(value: string) {
  if (!value) return '#333';
  const rgb = [1, 3, 5].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16),
  );
  return rgb[0]! * 0.299 + rgb[1]! * 0.587 + rgb[2]! * 0.114 > 155
    ? '#333'
    : '#fff';
}

try {
  if (model.value.startsWith('duoyu-icon:')) {
    const data = JSON.parse(model.value.slice(11));
    mode.value = data.mode;
    text.value = data.text || '';
    textEdited.value = data.textEdited ?? (!!data.text && data.text !== '文');
    upload.value = data.image || '';
    color.value = data.color || '';
    material.value = data.material === 'fill' ? 'fill' : 'glass';
  } else if (model.value) {
    mode.value = 'upload';
    upload.value = model.value;
  }
} catch {
  /* Fall back to automatic. */
}
watch([mode, text, upload, color, textEdited, material], () => {
  text.value = Array.from(text.value).slice(0, 6).join('');
  model.value =
    'duoyu-icon:' +
    JSON.stringify({
      mode: mode.value,
      text: text.value,
      textEdited: textEdited.value,
      image: upload.value,
      color: color.value,
      material: material.value,
    });
});
watch(
  () => [props.url, props.title],
  () => {
    if (!textEdited.value && props.url.trim()) {
      text.value = Array.from(props.title.trim()).slice(0, 6).join('');
    }
  },
  { immediate: true },
);
async function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = '';
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
      file.type,
    ) ||
    file.size > 5 * 1024 * 1024
  ) {
    error.value = '请选择 5MB 以内的 PNG、JPEG、WebP 或 GIF 图片';
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.min(128 / bitmap.width, 128 / bitmap.height);
    ctx.drawImage(
      bitmap,
      (128 - bitmap.width * scale) / 2,
      (128 - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    bitmap.close();
    upload.value = canvas.toDataURL('image/png');
  } catch {
    error.value = '图片无法读取，请重新选择';
  }
}
</script>
<template>
  <fieldset>
    <legend>图标</legend>
    <div
      ref="previewRegion"
      class="icon-options"
      :data-material="material"
      :data-transparent="!previewColor"
      role="group"
      aria-label="图标类型"
    >
      <span
        class="preview-wallpaper"
        :style="wallpaperPosition"
        aria-hidden="true"
      ></span>
      <button
        type="button"
        :aria-pressed="mode === 'auto'"
        title="自动获取，点击重新获取"
        @click="automatic"
      >
        <span
          :style="{
            '--icon-hover-fill': previewColor || undefined,
            '--icon-foreground': iconForeground(material, previewColor),
          }"
          class="cell-icon"
          ><img
            v-if="!url.trim()"
            class="default-site-logo"
            src="/icons/128.png"
            alt="默认扩展图标"
            draggable="false" />
          <WorkspaceFavicon
            v-else
            :key="refresh"
            :refresh-key="refresh"
            :title="title || '网址'"
            :page-url="url"
            class="preview"
            :style="{
              '--icon-hover-fill': previewColor || undefined,
              '--icon-foreground': iconForeground(material, previewColor),
            }"
        /></span>
        <span
          class="preview-title desktop-icon-caption"
          :style="{ width: `${DESKTOP_GRID_CELL_WIDTH - 16}px` }"
          :title="title"
          >{{ title || '名称' }}</span
        >
      </button>
      <div
        class="text-option"
        role="button"
        tabindex="0"
        :aria-pressed="mode === 'text'"
        aria-label="文字图标，再次点击编辑"
        @click="selectText"
        @keydown.enter.self.prevent="selectText"
        @keydown.space.self.prevent="selectText"
      >
        <span
          class="text-preview cell-icon"
          :style="{
            '--icon-hover-fill': previewColor || undefined,
            '--icon-foreground': iconForeground(material, previewColor),
          }"
        >
          <input
            v-if="editingText"
            ref="textInput"
            v-model="text"
            @input="textEdited = true"
            class="inline-icon-editor"
            @select="syncTextSelection"
            @keyup="syncTextSelection"
            @pointerup="syncTextSelection"
            aria-label="图标文字，最多六个字"
            placeholder="文"
            @click.stop
            @keydown.stop
            @keydown.enter.prevent="editingText = false"
            @keydown.esc.prevent="editingText = false"
            @blur="editingText = false"
          />
          <TextIcon
            :text="text"
            :editing="editingText"
            :selection-start="selectionStart"
            :selection-end="selectionEnd"
            @caret="placeTextCaret"
          />
        </span>
        <span
          class="preview-title desktop-icon-caption"
          :style="{ width: `${DESKTOP_GRID_CELL_WIDTH - 16}px` }"
          :title="title"
          >{{ title || '名称' }}</span
        >
      </div>

      <button
        type="button"
        :aria-pressed="mode === 'upload'"
        @click="mode === 'upload' ? fileInput?.click() : (mode = 'upload')"
      >
        <span
          v-if="upload"
          :style="{
            '--icon-hover-fill': previewColor || undefined,
            '--icon-foreground': iconForeground(material, previewColor),
          }"
          class="cell-icon"
          ><WorkspaceFavicon
            :src="upload"
            title="上传"
            class="preview"
            :style="{
              '--icon-hover-fill': previewColor || undefined,
              '--icon-foreground': iconForeground(material, previewColor),
            }"
        /></span>
        <span
          v-else
          class="text-preview cell-icon"
          :style="{
            '--icon-hover-fill': previewColor || undefined,
            '--icon-foreground': iconForeground(material, previewColor),
          }"
          aria-hidden="true"
          ><img
            class="upload-placeholder"
            src="/images/upload-icon.png"
            alt=""
            draggable="false"
        /></span>
        <span
          class="preview-title desktop-icon-caption"
          :style="{ width: `${DESKTOP_GRID_CELL_WIDTH - 16}px` }"
          :title="title"
          >{{ title || '名称' }}</span
        >
      </button>
    </div>
    <div class="icon-type-hints" aria-hidden="true">
      <span :class="{ selected: mode === 'auto' }">{{
        mode === 'auto' ? '点击重新获取' : '自动获取'
      }}</span
      ><span :class="{ selected: mode === 'text' }">{{
        mode === 'text' ? '点击修改' : '文字图标'
      }}</span
      ><span :class="{ selected: mode === 'upload' }">{{
        mode === 'upload' ? '点击上传' : '自定义上传'
      }}</span>
    </div>
    <input
      ref="fileInput"
      hidden
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      @change="choose"
    />
    <p v-if="error" role="alert">{{ error }}</p>
  </fieldset>
  <fieldset>
    <legend>图标材质</legend>
    <div class="material-options" role="group" aria-label="图标材质">
      <button
        type="button"
        :aria-pressed="material === 'glass'"
        @click="material = 'glass'"
      >
        液态玻璃
      </button>
      <button
        type="button"
        :aria-pressed="material === 'fill'"
        @click="material = 'fill'"
      >
        填充
      </button>
    </div>
  </fieldset>
  <fieldset>
    <legend>图标颜色</legend>
    <div
      class="color-grid"
      aria-label="图标颜色"
      @pointerleave="hoveredColor = null"
      @focusout="hoveredColor = null"
    >
      <div
        v-for="row in colorRows"
        :key="row.name"
        class="color-row"
        role="group"
        :aria-label="row.name"
      >
        <button
          v-for="(value, index) in row.values"
          :key="value"
          type="button"
          :class="{ transparent: !value }"
          :style="{ backgroundColor: value || '#fff', color: swatchInk(value) }"
          :title="swatchName(row, index)"
          :aria-label="swatchName(row, index)"
          :aria-pressed="color === value"
          @pointerenter="hoveredColor = value"
          @focus="hoveredColor = value"
          @click="color = value"
        >
          {{ color === value ? '✓' : '' }}
        </button>
      </div>
    </div>
  </fieldset>
</template>
<style scoped>
fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
fieldset + fieldset {
  margin-top: 0;
}
legend {
  padding: 0;
  margin-bottom: var(--editor-label-gap, 8px);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: #444;
}
.icon-options {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 14px;
  padding: 24px 20px;
  min-height: 124px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 16px;
  color: #fff;
}
.preview-wallpaper {
  position: absolute;
  z-index: -1;
  pointer-events: none;
  background-image: var(--desktop-wallpaper-image);
  background-size: cover;
  background-position: center;
  background-color: #777;
}
.icon-options :is(button, .text-option) {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 10px;
}
.icon-options .cell-icon {
  width: 56px;
  height: 56px;
  padding: 4px;
  border-radius: 15px;
  background: var(--icon-glass-fill);
}
.icon-options :is(button, .text-option):is(:hover, :focus-visible) .cell-icon {
  background: var(--icon-glass-hover-fill);
}
.icon-options .cell-icon .preview {
  width: 100%;
  height: 100%;
  margin: 0;
  background: transparent;
}
.icon-options .cell-icon :deep(img) {
  width: 100%;
  height: 100%;
}
.text-preview.cell-icon {
  position: relative;
  overflow-wrap: anywhere;
  line-height: 1.1;
}
.preview-title {
  max-width: none;
}
.icon-type-hints {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 0 20px;
  margin-top: 10px;
  min-height: 18px;
  color: #888;
  text-align: center;
  font-size: 12px;
  line-height: 18px;
}
.icon-type-hints .selected {
  color: #1677ff;
}
input[hidden] {
  display: none;
}
p[role='alert'] {
  font-size: 12px;
  color: #ba3535;
  margin: 8px 0 0;
}
.color-grid {
  display: grid;
  width: min(100%, 256px);
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 0;
}
.color-row {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.color-row button {
  width: 100%;
  aspect-ratio: 1;
  height: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: inset 0 0 0 0.5px #fff;
  font-size: 12px;
  cursor: pointer;
}
.color-row button[aria-pressed='true'] {
  font-weight: 800;
}
.color-row .transparent {
  background-image: repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%);
  background-size: 10px 10px;
}
.icon-options .text-preview.cell-icon input.inline-icon-editor,
.icon-options .text-preview.cell-icon input.inline-icon-editor:focus,
.icon-options .text-preview.cell-icon input.inline-icon-editor:focus-visible {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  border: 0 !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
  color: transparent !important;
  caret-color: transparent;
  padding: 0 !important;
  opacity: 0;
}
@media (max-width: 460px) {
  .icon-options,
  .icon-type-hints {
    gap: 8px;
    padding-inline: 10px;
  }
}
</style>

<style scoped>
.icon-type-hints > span {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
}
.icon-type-hints .selected::before {
  content: '';
  flex: 0 0 13px;
  width: 13px;
  height: 13px;
  background: currentColor;
  mask: url('/images/selected-check.png') center / contain no-repeat;
}
</style>

<style scoped>
.icon-options .cell-icon > .default-site-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: grayscale(1);
  opacity: 0.65;
}
.icon-options .cell-icon > .upload-placeholder {
  width: 32px;
  height: 32px;
  object-fit: contain;
}
</style>

<style scoped>
.material-options {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: #f5f5f7;
  border-radius: 8px;
}
.material-options button {
  height: 36px;
  padding: 0 18px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #777;
  cursor: pointer;
}
.material-options button[aria-pressed='true'] {
  background: white;
  color: #222;
  box-shadow: 0 1px 4px #0000000d;
}
.material-options button:hover {
  opacity: 0.7;
}
</style>

<style scoped>
.icon-options .text-preview.cell-icon input.inline-icon-editor {
  pointer-events: none;
}
</style>
