<script setup lang="ts">
import Sliders from '@icon-park/vue-next/es/icons/SettingTwo';
import Pencil from '@icon-park/vue-next/es/icons/Pencil';
import ShapeIcon from '@icon-park/vue-next/es/icons/CirclesAndTriangles';
import Arrow from '@icon-park/vue-next/es/icons/ArrowRightUp';
import TextIcon from '@icon-park/vue-next/es/icons/Text';
import Erase from '@icon-park/vue-next/es/icons/Erase';
import Pic from '@icon-park/vue-next/es/icons/Pic';
import Hand from '@icon-park/vue-next/es/icons/Palm';
import Upload from '@icon-park/vue-next/es/icons/UploadPicture';
import Clipboard from '@icon-park/vue-next/es/icons/Clipboard';
import Close from '@icon-park/vue-next/es/icons/Close';
import Minus from '@icon-park/vue-next/es/icons/Minus';
import Plus from '@icon-park/vue-next/es/icons/Plus';
import Fit from '@icon-park/vue-next/es/icons/FullScreen';
import { computed, ref } from 'vue';
import {
  importStamp,
  palette,
  type Brush,
  type Paper,
  type PenSettings,
  type Shape,
  type StampImage,
  type Tool,
} from './drawing';
import { requireAccount } from '../auth/edit-access';

defineProps<{
  paper: Paper;
  image?: StampImage;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
}>();
const tool = defineModel<Tool>('tool', { required: true });
const tools = [
  { id: 'brush', label: '画笔', icon: Pencil },
  { id: 'shape', label: '图形', icon: ShapeIcon },
  { id: 'arrow', label: '箭头', icon: Arrow },
  { id: 'text', label: '文字', icon: TextIcon },
  { id: 'eraser', label: '橡皮擦', icon: Erase },
  { id: 'sticker', label: '贴图', icon: Pic },
  { id: 'hand', label: '平移', icon: Hand },
] as const;
const settings = defineModel<PenSettings>({ required: true });
const emit = defineEmits<{
  paper: [color: Paper];
  image: [image: StampImage];
  pastePhoto: [];
  error: [message: string];
  close: [];
  zoomIn: [];
  zoomOut: [];
  fit: [];
}>();
const brushes: [Brush, string][] = [
  ['round', '圆头笔'],
  ['nib', '书法笔'],
  ['marker', '荧光笔'],
];
const shapes: [Shape, string][] = [
  ['rect', '矩形'],
  ['ellipse', '椭圆'],
  ['triangle', '三角形'],
  ['line', '直线'],
];
const colored = computed(() =>
  ['brush', 'shape', 'arrow', 'text'].includes(tool.value),
);
type SizeKey = 'width' | 'textSize' | 'eraserWidth' | 'stickerSize';
const slider = computed<{
  key: SizeKey;
  name: string;
  min: number;
  max: number;
}>(() => {
  switch (tool.value) {
    case 'text':
      return { key: 'textSize', name: '字号', min: 12, max: 160 };
    case 'eraser':
      return { key: 'eraserWidth', name: '橡皮大小', min: 4, max: 160 };
    case 'sticker':
      return { key: 'stickerSize', name: '贴图大小', min: 24, max: 800 };
    default:
      return { key: 'width', name: '线宽', min: 1, max: 56 };
  }
});
const size = computed({
  get: () => settings.value[slider.value.key],
  set: (n: number) => {
    settings.value[slider.value.key] = n;
  },
});
const sizeProgress = computed(
  () =>
    ((size.value - slider.value.min) / (slider.value.max - slider.value.min)) *
      100 +
    '%',
);
const input = ref<HTMLInputElement>();
let pendingPlacement: ((image: StampImage) => Promise<void>) | undefined;
let uploadVersion = 0;
function choosePhoto(place?: (image: StampImage) => Promise<void>) {
  if (!requireAccount()) return;
  pendingPlacement = place;
  input.value?.click();
}
defineExpose({ choosePhoto });
async function upload(event: Event) {
  const field = event.target as HTMLInputElement,
    file = field.files?.[0];
  field.value = '';
  const place = pendingPlacement;
  pendingPlacement = undefined;
  if (!file || !requireAccount()) return;
  const version = ++uploadVersion;
  try {
    const image = await importStamp(file);
    if (version === uploadVersion) emit('image', image);
    if (place) await place(image);
  } catch {
    if (version === uploadVersion)
      emit('error', '照片读取失败，请选择 PNG、JPEG 或 WebP 图片');
  }
}
</script>
<template>
  <aside
    id="canvas-tool-inspector"
    class="canvas-inspector glass-surface"
    aria-label="工具属性"
  >
    <div class="canvas-inspector-title">
      <span class="canvas-inspector-mark" aria-hidden="true"><Sliders /></span>
      <h3>工具属性</h3>
      <button
        class="canvas-mobile-close"
        title="关闭属性"
        aria-label="关闭属性"
        @click="emit('close')"
      >
        <Close />
      </button>
    </div>
    <div class="canvas-properties">
      <div class="canvas-tools" role="toolbar" aria-label="绘图工具">
        <button
          v-for="item in tools"
          :key="item.id"
          :aria-label="item.label"
          :aria-pressed="tool === item.id"
          :title="item.label"
          @click="tool = item.id"
        >
          <component :is="item.icon" /><span>{{ item.label }}</span>
        </button>
      </div>
      <section v-if="tool === 'brush'">
        <h4>笔型</h4>
        <div class="canvas-brushes">
          <button
            v-for="[id, name] in brushes"
            :key="id"
            :aria-pressed="settings.brush === id"
            @click="settings.brush = id"
          >
            <svg
              class="canvas-brush-sample"
              :data-brush="id"
              viewBox="0 0 48 16"
              aria-hidden="true"
            >
              <path
                v-if="id === 'round'"
                d="M4 12 C14 12 21 3 30 5 S39 8 44 4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.7"
                stroke-linecap="round"
              />
              <path
                v-else-if="id === 'nib'"
                d="M3 13 C13 12 19 2 28 3 C34 4 37 7 45 2 C38 12 32 9 27 8 C19 6 15 14 3 13Z"
                fill="currentColor"
              />
              <path
                v-else
                d="m5 9 39-6-2 8-39 4z"
                fill="currentColor"
                opacity=".68"
              />
            </svg>
            <span>{{ name }}</span>
          </button>
        </div>
      </section>
      <section v-if="tool === 'shape'">
        <h4>形状</h4>
        <div class="canvas-options">
          <button
            v-for="[id, label] in shapes"
            :key="id"
            :aria-pressed="settings.shape === id"
            @click="settings.shape = id"
          >
            {{ label }}
          </button>
        </div>
        <label v-if="settings.shape !== 'line'" class="canvas-check"
          ><input v-model="settings.filled" type="checkbox" /> 填充形状</label
        >
      </section>
      <section v-if="tool === 'sticker'">
        <h4>照片</h4>
        <div class="canvas-options canvas-photo-actions">
          <button type="button" @click="emit('pastePhoto')">
            <Clipboard />粘贴照片
          </button>
          <button
            type="button"
            title="选择照片后，点击画布放置"
            @click="choosePhoto()"
          >
            <Upload />选择照片
          </button>
        </div>
        <span v-if="image" class="canvas-image-name" :title="image.name">{{
          image.name
        }}</span>
      </section>
      <input ref="input" hidden type="file" accept="image/*" @change="upload" />
      <section v-if="colored">
        <h4>颜色</h4>
        <div class="canvas-palette">
          <button
            v-for="[name, hex] in palette"
            :key="hex"
            :style="{ '--swatch': hex }"
            :title="name"
            :aria-label="name"
            :aria-pressed="settings.color === hex"
            @click="settings.color = hex"
          ></button>
        </div>
        <label class="canvas-picker"
          ><i :style="{ background: settings.color }" aria-hidden="true"></i
          ><code>{{ settings.color.toUpperCase() }}</code
          ><span>自定义</span
          ><input v-model="settings.color" type="color" aria-label="自定义颜色"
        /></label>
      </section>
      <section v-if="tool !== 'hand'" class="canvas-size">
        <h4>
          <label for="canvas-size">{{ slider.name }}</label
          ><output>{{ size }} px</output>
        </h4>
        <input
          id="canvas-size"
          v-model.number="size"
          type="range"
          :min="slider.min"
          :max="slider.max"
          :style="{ '--range-progress': sizeProgress }"
        />
      </section>
      <section class="canvas-paper-options">
        <h4>画布底色</h4>
        <div class="canvas-options">
          <button
            v-for="[value, name] in [
              ['#ffffff', '白色'],
              ['#000000', '黑色'],
            ] as const"
            :key="value"
            :aria-pressed="paper === value"
            @click="emit('paper', value)"
          >
            <i :style="{ background: value }"></i>{{ name }}
          </button>
        </div>
      </section>
    </div>
    <div class="canvas-zoom" role="group" aria-label="画布缩放">
      <span>缩放</span>
      <div class="canvas-zoom-stepper">
        <button
          title="缩小"
          aria-label="缩小"
          :disabled="!canZoomOut"
          @click="emit('zoomOut')"
        >
          <Minus />
        </button>
        <output aria-label="缩放比例"
          >{{ Number((zoom * 100).toPrecision(3)) }}%</output
        >
        <button
          title="放大"
          aria-label="放大"
          :disabled="!canZoomIn"
          @click="emit('zoomIn')"
        >
          <Plus />
        </button>
      </div>
      <button
        class="canvas-fit"
        title="适合窗口"
        aria-label="适合窗口"
        @click="emit('fit')"
      >
        <Fit />
      </button>
    </div>
  </aside>
</template>
