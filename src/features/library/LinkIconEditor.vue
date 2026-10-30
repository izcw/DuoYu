<script setup lang="ts">
import { limitIconText } from '../../shared/icon-text';
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
const pictureFilter = ref('');
const hoveredPictureFilter = ref<string | null>(null);
const previewPictureFilter = computed(
  () => hoveredPictureFilter.value ?? pictureFilter.value,
);
function selectPictureFilter(value: string) {
  pictureFilter.value = value;
}
const iconPadding = ref(4);
const material = ref<'glass' | 'fill'>('glass');
const materials = ['glass', 'fill'] as const;
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
async function selectText(rowMaterial: 'glass' | 'fill') {
  if (material.value !== rowMaterial) {
    editingText.value = false;
    material.value = rowMaterial;
    mode.value = 'text';
    return;
  }
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
watch([mode, material], () => {
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
    name: '青',
    values: ['#01a0d8', '#03c7fb', '#54d6fa', '#92e2fb', '#cbeffe'],
  },
  {
    name: '蓝',
    values: ['#0062fe', '#3c87fd', '#74a6ff', '#a8c6ff', '#d3e1ff'],
  },
  {
    name: '靛紫',
    values: ['#4e22b3', '#5e2feb', '#864efd', '#b08dfc', '#d9c7fd'],
  },
  {
    name: '紫',
    values: ['#982abb', '#be37f3', '#d257fd', '#e391fd', '#eecaff'],
  },
  {
    name: '玫红',
    values: ['#ba2c5d', '#e63b7b', '#ee719e', '#f4a3c0', '#f8d3de'],
  },
  {
    name: '朱红',
    values: ['#ff4017', '#ff614e', '#fd8c81', '#ffb5ae', '#ffdad8'],
  },
  {
    name: '橙',
    values: ['#ff6a03', '#ff8647', '#ffa57d', '#fec5ab', '#ffe3d5'],
  },
  {
    name: '琥珀',
    values: ['#fdaa02', '#feb43f', '#fec776', '#ffd9a8', '#feebd2'],
  },
  {
    name: '金黄',
    values: ['#fcc800', '#fdcb3f', '#fed976', '#fde3a8', '#fef2d4'],
  },
  {
    name: '明黄',
    values: ['#fdfb43', '#fef769', '#fff893', '#fdfbb9', '#fdfcdb'],
  },
  {
    name: '黄绿',
    values: ['#d8ec37', '#e3ee64', '#eaf18f', '#f1f5b5', '#f5f9db'],
  },
  {
    name: '绿',
    values: ['#75bc3f', '#96d35f', '#b1dc8b', '#cce8b4', '#deedd5'],
  },
];
const filterColors = [
  ['', '无'],
  ...colorRows.slice(1).map((row) => [row.values[0]!, row.name]),
  ['#ffffff', '白色'],
  ['#808080', '灰色'],
  ['#000000', '黑色'],
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
    upload.value = data.mode === 'upload' ? data.image || '' : '';
    color.value = data.color || '';
    pictureFilter.value = data.pictureFilter || '';
    iconPadding.value = Math.max(
      0,
      Math.min(8, Number(data.padding ?? 4) || 0),
    );
    material.value = data.material === 'fill' ? 'fill' : 'glass';
  } else if (model.value) {
    mode.value = 'upload';
    upload.value = model.value;
  }
} catch {
  /* Fall back to automatic. */
}
watch(
  [mode, text, upload, color, textEdited, material, pictureFilter, iconPadding],
  () => {
    text.value = limitIconText(text.value);
    model.value =
      'duoyu-icon:' +
      JSON.stringify({
        mode: mode.value,
        text: text.value,
        textEdited: textEdited.value,
        image: mode.value === 'upload' ? upload.value : '',
        color: color.value,
        material: material.value,
        pictureFilter: pictureFilter.value,
        padding: iconPadding.value,
      });
  },
);
watch(
  () => [props.url, props.title],
  () => {
    if (!textEdited.value && props.url.trim()) {
      text.value = limitIconText(props.title.trim());
    }
  },
  { immediate: true },
);
function removeUpload() {
  upload.value = '';
  error.value = '';
  if (fileInput.value) fileInput.value.value = '';
  if (mode.value === 'upload') mode.value = 'auto';
}
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
    <div class="icon-type-hints" aria-hidden="true">
      <span>{{ mode === 'auto' ? '点击重新获取' : '自动获取' }}</span>
      <span>{{ mode === 'text' ? '点击修改' : '文字图标' }}</span>
      <span>{{ mode === 'upload' ? '点击上传' : '自定义上传' }}</span>
    </div>
    <div ref="previewRegion" class="icon-preview-board">
      <div class="preview-wallpaper-clip" aria-hidden="true">
        <span class="preview-wallpaper" :style="wallpaperPosition"></span>
      </div>
      <template v-for="rowMaterial in materials" :key="rowMaterial">
        <div
          class="icon-options"
          :data-material="rowMaterial"
          :style="{ '--icon-padding': `${iconPadding}px` }"
          :data-transparent="!previewColor"
          role="group"
          :aria-label="rowMaterial === 'glass' ? '液态玻璃图标' : '填充图标'"
        >
          <span class="material-row-label" aria-hidden="true">{{
            rowMaterial === 'glass' ? '液态玻璃' : '填充背景'
          }}</span>
          <button
            type="button"
            :aria-pressed="mode === 'auto' && material === rowMaterial"
            title="自动获取，点击重新获取"
            @click="
              material = rowMaterial;
              automatic();
            "
          >
            <span
              :style="{
                '--icon-hover-fill': previewColor || undefined,
                '--icon-foreground': iconForeground(rowMaterial, previewColor),
              }"
              class="cell-icon"
              ><img
                v-if="!url.trim()"
                class="default-site-logo"
                src="/icons/128.png"
                alt="默认扩展图标"
                draggable="false" />
              <WorkspaceFavicon
                :picture-filter="previewPictureFilter"
                v-else
                :key="refresh"
                :refresh-key="refresh"
                :title="title || '网址'"
                :page-url="url"
                class="preview"
                :style="{
                  '--icon-hover-fill': previewColor || undefined,
                  '--icon-foreground': iconForeground(
                    rowMaterial,
                    previewColor,
                  ),
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
            :aria-pressed="mode === 'text' && material === rowMaterial"
            aria-label="文字图标，再次点击编辑"
            @click="selectText(rowMaterial)"
            @keydown.enter.self.prevent="selectText(rowMaterial)"
            @keydown.space.self.prevent="selectText(rowMaterial)"
          >
            <span
              class="text-preview cell-icon"
              :style="{
                '--icon-hover-fill': previewColor || undefined,
                '--icon-foreground': iconForeground(rowMaterial, previewColor),
              }"
            >
              <input
                v-if="editingText && material === rowMaterial"
                :ref="
                  (el) => {
                    if (el) textInput = el as HTMLInputElement;
                  }
                "
                v-model="text"
                @input="textEdited = true"
                class="inline-icon-editor"
                @select="syncTextSelection"
                @keyup="syncTextSelection"
                @pointerup="syncTextSelection"
                aria-label="图标文字，中文最多6字，其他字符最多10个"
                placeholder="文"
                @click.stop
                @keydown.stop
                @keydown.enter.prevent="editingText = false"
                @keydown.esc.prevent="editingText = false"
                @blur="editingText = false"
              />
              <TextIcon
                :text="text"
                :editing="editingText && material === rowMaterial"
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

          <div class="upload-option">
            <button
              type="button"
              :aria-pressed="mode === 'upload' && material === rowMaterial"
              @click="
                mode === 'upload' && material === rowMaterial
                  ? fileInput?.click()
                  : (mode = 'upload');
                material = rowMaterial;
              "
            >
              <span
                v-if="upload"
                :style="{
                  '--icon-hover-fill': previewColor || undefined,
                  '--icon-foreground': iconForeground(
                    rowMaterial,
                    previewColor,
                  ),
                }"
                class="cell-icon"
                ><WorkspaceFavicon
                  :picture-filter="previewPictureFilter"
                  :src="upload"
                  title="上传"
                  class="preview"
                  :style="{
                    '--icon-hover-fill': previewColor || undefined,
                    '--icon-foreground': iconForeground(
                      rowMaterial,
                      previewColor,
                    ),
                  }"
              /></span>
              <span
                v-else
                class="text-preview cell-icon"
                :style="{
                  '--icon-hover-fill': previewColor || undefined,
                  '--icon-foreground': iconForeground(
                    rowMaterial,
                    previewColor,
                  ),
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
            <button
              v-if="upload"
              type="button"
              class="remove-upload"
              aria-label="删除此图片"
              title="删除此图片"
              @click.stop="removeUpload"
              @pointerdown.stop
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
              </svg>
            </button>
          </div>
        </div>
      </template>
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
    <legend>背景颜色</legend>
    <div
      class="color-grid"
      aria-label="背景颜色"
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

  <fieldset v-if="mode !== 'text'">
    <legend>图片滤镜</legend>
    <div
      class="filter-grid color-grid"
      role="group"
      aria-label="图片滤镜"
      @pointerleave="hoveredPictureFilter = null"
      @focusout="hoveredPictureFilter = null"
    >
      <div
        v-for="[value, label] in filterColors"
        :key="value"
        class="color-row"
      >
        <button
          type="button"
          :class="{ transparent: !value }"
          :style="{
            backgroundColor: value || '#fff',
            color: swatchInk(value || ''),
          }"
          :aria-label="`图片滤镜：${label}`"
          :title="label"
          :aria-pressed="pictureFilter === value"
          @pointerenter="hoveredPictureFilter = value || ''"
          @focus="hoveredPictureFilter = value || ''"
          @click="selectPictureFilter(value || '')"
        >
          {{ pictureFilter === value ? '✓' : '' }}
        </button>
      </div>
    </div>
  </fieldset>

  <fieldset v-if="mode !== 'text'" class="icon-padding-control">
    <legend>图标内边距</legend>
    <div
      class="padding-slider"
      :style="{
        '--padding-progress': `${(iconPadding / 8) * 100}%`,
        '--padding-fraction': iconPadding / 8,
      }"
    >
      <div class="padding-track" aria-hidden="true">
        <i
          v-for="value in [0, 2, 4, 6, 8]"
          :key="value"
          :class="{ passed: value <= iconPadding }"
        ></i>
      </div>
      <input
        v-model.number="iconPadding"
        type="range"
        min="0"
        max="8"
        step="2"
        aria-label="图标内边距"
        :aria-valuetext="`${iconPadding}px`"
      />
      <output class="padding-tooltip" aria-hidden="true"
        >{{ iconPadding }}px</output
      >
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
.icon-preview-board {
  position: relative;
  isolation: isolate;
  margin-left: 26px;
  border-radius: 14px;
  padding-bottom: 12px;
}
.icon-options {
  position: relative;
  padding: 24px 20px;
  min-height: 124px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 16px;
  color: #fff;
}
.material-row-label {
  position: absolute;
  right: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%);
  writing-mode: vertical-rl;
  text-orientation: upright;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  letter-spacing: 3px;
  color: #888;
  pointer-events: none;
}
.preview-wallpaper-clip {
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
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
  margin-left: 26px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 0 20px;
  margin-bottom: 10px;
  min-height: 18px;
  color: #888;
  text-align: center;
  font-size: 12px;
  line-height: 18px;
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
  border: 10px solid #f5f5f7;
  border-radius: 8px;
  box-sizing: border-box;
  display: grid;
  width: min(100%, 416px);
  grid-template-columns: repeat(13, minmax(0, 1fr));
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
  box-shadow: none;
  font-size: 12px;
  cursor: pointer;
}
.color-row button[aria-pressed='true'] {
  border: 2px solid #fff;
  box-sizing: border-box;
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
.icon-options :is(button, .text-option)[aria-pressed='true']::after {
  content: '';
  position: absolute;
  bottom: -7px;
  left: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  transform: translateX(-50%);
  pointer-events: none;
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
.icon-options .text-preview.cell-icon input.inline-icon-editor {
  pointer-events: none;
}
</style>

<style scoped>
.filter-grid.color-grid {
  grid-template-columns: repeat(16, minmax(0, 1fr));
  width: min(100%, 512px);
}
</style>

<style scoped>
.icon-padding-control {
  width: min(100%, 352px);
}
.padding-slider {
  position: relative;
  height: 30px;
}
.padding-track {
  position: absolute;
  left: 9px;
  right: 9px;
  top: 12px;
  height: 6px;
  border-radius: 99px;
  background: linear-gradient(
    to right,
    #000000 var(--padding-progress),
    #e4e7ed var(--padding-progress)
  );
  display: flex;
  justify-content: space-between;
  align-items: center;
  pointer-events: none;
}
.padding-track i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
}
.padding-track i:first-child,
.padding-track i:last-child {
  visibility: hidden;
}
.padding-track i.passed {
  background: #000000;
}
.icon-padding-control .padding-slider input[type='range'] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 30px;
  margin: 0;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  border: 0;
  outline: none;
  box-shadow: none;
  cursor: pointer;
}
.padding-slider input::-webkit-slider-runnable-track {
  height: 6px;
  background: transparent;
  border: 0;
}
.padding-slider input::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin-top: -6px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2px solid #e4e7ed;
  background: #fff;
  box-shadow: none;
  transition: box-shadow 150ms ease;
}
.padding-slider input:hover::-webkit-slider-thumb,
.padding-slider input:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px #f5f5f7;
}
.padding-tooltip {
  position: absolute;
  bottom: calc(100% + 3px);
  left: calc(9px + (100% - 18px) * var(--padding-fraction));
  transform: translateX(-50%) translateY(3px);
  padding: 4px 8px;
  border-radius: 7px;
  background: #000000;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}
.padding-slider:hover .padding-tooltip,
.padding-slider:focus-within .padding-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
</style>

<style scoped>
.upload-option {
  position: relative;
  min-width: 0;
}
.icon-options .upload-option > .remove-upload {
  position: absolute;
  top: 0;
  left: calc(50% + 17px);
  z-index: 5;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  color: #fff;
  background: rgb(0 0 0 / 55%);
  cursor: pointer;
}
.icon-options .upload-option > .remove-upload:hover {
  background: #d9363e;
}
</style>
