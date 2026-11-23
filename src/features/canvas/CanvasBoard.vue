<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { liveQuery } from 'dexie';
import Pencil from '@icon-park/vue-next/es/icons/Pencil';
import Layers from '@icon-park/vue-next/es/icons/Layers';
import Plus from '@icon-park/vue-next/es/icons/Plus';
import Undo from '@icon-park/vue-next/es/icons/Undo';
import Redo from '@icon-park/vue-next/es/icons/Redo';
import Download from '@icon-park/vue-next/es/icons/Download';
import Edit from '@icon-park/vue-next/es/icons/Edit';
import Close from '@icon-park/vue-next/es/icons/Close';
import Settings from '@icon-park/vue-next/es/icons/SettingTwo';
import { guestMode, accountStorage } from '../../shared/storage/account';
import { requireAccount } from '../auth/edit-access';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import CanvasArtwork from './CanvasArtwork.vue';
import CanvasStage from './CanvasStage.vue';
import CanvasInspector from './CanvasInspector.vue';
import {
  ensureSheet,
  newSheet,
  readInk,
  removeSheet,
  sheetView,
  sheets,
  stepHistory,
  type Sheet,
} from './book';
import {
  importStamp,
  type Paper,
  type PenSettings,
  type StampImage,
  type Tool,
} from './drawing';
import { exportPng } from './renderer';
import './canvas.css';

const settings = ref<PenSettings>({
  brush: 'round',
  shape: 'rect',
  color: '#20282b',
  width: 6,
  eraserWidth: 48,
  textSize: 48,
  stickerSize: 320,
  filled: false,
});
const tool = ref<Tool>('brush'),
  image = shallowRef<StampImage>();
const list = shallowRef<Sheet[]>(guestMode ? [newSheet('画布 01')] : []);
const current = ref(accountStorage.getItem('canvas-last-sheet') || '');
const active = computed(
  () => list.value.find((s) => s.id === current.value) ?? list.value[0],
);
const error = ref(''),
  saving = ref(false),
  exporting = ref(false);
const panel = ref<'list' | 'properties'>();
const stage = ref<InstanceType<typeof CanvasStage>>();
const inspector = ref<InstanceType<typeof CanvasInspector>>();
const studio = ref<HTMLElement>();
const safeArea = ref<HTMLElement>();
const modal = ref<'create' | 'edit' | 'delete'>(),
  target = ref(''),
  name = ref(''),
  paper = ref<Paper>('#ffffff'),
  busy = ref(false),
  formError = ref('');
let unsub: { unsubscribe(): void } | undefined,
  alive = true;
function showError(message: string) {
  error.value = message;
}
onMounted(async () => {
  if (guestMode) return;
  try {
    await ensureSheet();
    if (!alive) return;
    unsub = liveQuery(() => sheets.orderBy('created').toArray()).subscribe({
      next: (value) => {
        list.value = value;
      },
      error: () => showError('画布列表读取失败，请重新打开画布页'),
    });
  } catch {
    showError('无法打开本机画布库，请重新打开画布页');
  }
});
onUnmounted(() => {
  alive = false;
  unsub?.unsubscribe();
});
function select(id: string) {
  current.value = id;
  if (!guestMode) accountStorage.setItem('canvas-last-sheet', id);
  panel.value = undefined;
}
function stepMenu(direction: number) {
  const index = list.value.findIndex((s) => s.id === active.value?.id);
  const next = list.value[index + direction];
  if (next) select(next.id);
}
defineExpose({ stepMenu });
watch(
  () => active.value?.id,
  () => {
    saving.value = false;
  },
);
watch(
  () => active.value?.paper,
  (color) => {
    if (
      color === '#000000' &&
      ['#000000', '#20282b'].includes(settings.value.color)
    )
      settings.value.color = '#ffffff';
    if (color === '#ffffff' && settings.value.color === '#ffffff')
      settings.value.color = '#20282b';
  },
  { immediate: true },
);
function openForm(mode: 'edit' | 'create') {
  if (!requireAccount()) return;
  const sheet = active.value;
  if (!sheet) return;
  target.value = sheet.id;
  let number = list.value.length + 1;
  while (
    list.value.some(
      (item) => item.name === '画布 ' + String(number).padStart(2, '0'),
    )
  )
    number++;
  name.value =
    mode === 'edit' ? sheet.name : '画布 ' + String(number).padStart(2, '0');
  paper.value = mode === 'edit' ? sheet.paper : '#ffffff';
  formError.value = '';
  modal.value = mode;
}
async function submit() {
  if (busy.value || !modal.value || !requireAccount()) return;
  if (modal.value !== 'delete' && !name.value.trim()) {
    formError.value = '请输入画布名称';
    return;
  }
  busy.value = true;
  try {
    if (modal.value === 'delete') await removeSheet(target.value);
    else if (modal.value === 'edit') {
      if (!(await sheets.update(target.value, { name: name.value.trim() })))
        throw Error('这张画布已被删除');
    } else {
      const sheet = newSheet(name.value.trim(), paper.value);
      await sheets.add(sheet);
      select(sheet.id);
    }
    modal.value = undefined;
  } catch (e) {
    formError.value = e instanceof Error ? e.message : '画布保存失败';
  } finally {
    busy.value = false;
  }
}
async function background(color: Paper) {
  if (!active.value || active.value.paper === color || !requireAccount())
    return;
  try {
    await sheets.update(active.value.id, { paper: color });
  } catch {
    showError('画布底色保存失败');
  }
}
async function history(delta: number) {
  const sheet = active.value;
  if (!sheet || !requireAccount()) return;
  try {
    await stepHistory(sheet.id, delta);
  } catch {
    showError('无法更新画布历史记录');
  }
}
async function download() {
  const sheet = active.value;
  if (!sheet || exporting.value) return;
  exporting.value = true;
  try {
    const scene = guestMode
      ? { sheet, entries: [] }
      : await readInk(sheet.id, -1, 0);
    if (!scene) throw Error('画布已被删除');
    const view = sheetView(scene.sheet);
    const url = URL.createObjectURL(
      await exportPng(view, scene.sheet.paper, scene.entries),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = scene.sheet.name.replace(/[\\/:*?"<>|]/g, '_') + '.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch {
    showError('PNG 导出失败，请重试');
  } finally {
    exporting.value = false;
  }
}
async function readClipboardPhoto() {
  let items: ClipboardItem[];
  try {
    items = await navigator.clipboard.read();
  } catch {
    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘V'
      : 'Ctrl+V';
    throw Error('请在画布上按 ' + shortcut + ' 粘贴照片，或选择本地照片');
  }
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith('image/'));
    if (type)
      return new File([await item.getType(type)], '剪贴板照片', { type });
  }
  throw Error('剪贴板中没有照片');
}
function selectPhoto(photo: StampImage) {
  image.value = photo;
  if (panel.value === 'properties') {
    panel.value = undefined;
    stage.value?.$el.focus({ preventScroll: true });
  }
}
async function pastePhoto(file?: File) {
  const receiver = stage.value;
  if (!receiver || !requireAccount()) return;
  const place = receiver.preparePhotoPlacement();
  try {
    const source = file ?? (await readClipboardPhoto());
    const photo = await importStamp(source).catch(() => {
      throw Error('照片读取失败，请选择 PNG、JPEG 或 WebP 图片');
    });
    await place(photo);
    if (alive && receiver === stage.value) selectPhoto(photo);
  } catch (e) {
    if (alive) showError(e instanceof Error ? e.message : '粘贴照片失败');
  }
}
function paste(event: ClipboardEvent) {
  const target = event.target;
  if (
    event.defaultPrevented ||
    modal.value ||
    !(target instanceof Element) ||
    target.closest(
      'input:not([type="range"]):not([type="color"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  )
    return;
  // The workspace itself has focus when the canvas page first opens.
  const workspace = studio.value?.closest('.workspace-overlay');
  if (!workspace || (target !== workspace && !studio.value?.contains(target)))
    return;
  const data = event.clipboardData;
  if (!data) return;
  const file =
    Array.from(data.files).find((f) => f.type.startsWith('image/')) ??
    Array.from(data.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
  if (!file) return;
  event.preventDefault();
  void pastePhoto(file);
}
function key(e: KeyboardEvent) {
  if (
    e.defaultPrevented ||
    e.isComposing ||
    modal.value ||
    !(e.target instanceof Element) ||
    !e.target.closest('.workspace-overlay') ||
    e.target.closest('input,textarea,select,[contenteditable]')
  )
    return;
  if (e.key === 'Escape' && panel.value) {
    e.preventDefault();
    e.stopPropagation();
    panel.value = undefined;
    return;
  }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'y') {
    e.preventDefault();
    if (!guestMode && !saving.value)
      void history(k === 'y' || e.shiftKey ? 1 : -1);
  }
}
onMounted(() => {
  document.addEventListener('keydown', key, true);
  document.addEventListener('paste', paste);
});
onUnmounted(() => {
  document.removeEventListener('keydown', key, true);
  document.removeEventListener('paste', paste);
});
</script>
<template>
  <section
    ref="studio"
    class="canvas-studio"
    aria-label="画布工作室"
    :data-panel="panel"
  >
    <button
      v-if="panel"
      class="canvas-shade"
      aria-label="收起面板"
      @click="panel = undefined"
    ></button>
    <aside class="canvas-library" aria-label="画布列表">
      <header class="canvas-brand">
        <span class="canvas-brand-icon"><Pencil /></span>
        <h2>画布工作室</h2>
        <button
          class="canvas-mobile-close"
          aria-label="关闭画布列表"
          @click="panel = undefined"
        >
          <Close />
        </button>
      </header>
      <div class="canvas-library-body">
        <button
          class="canvas-add glass-surface"
          :disabled="!active"
          @click="openForm('create')"
        >
          <Plus />新建画布
        </button>
        <h3 class="canvas-list-title">
          <Layers />我的画布<span>{{ list.length }}</span>
        </h3>
        <div class="canvas-cards">
          <button
            v-for="s in list"
            :key="s.id"
            class="canvas-card glass-surface"
            :aria-label="'切换到' + s.name"
            :aria-pressed="active?.id === s.id"
            @click="select(s.id)"
          >
            <span class="canvas-card-tray"
              ><CanvasArtwork :sheet="s" thumbnail @error="showError"
            /></span>
            <span class="canvas-card-label"
              ><i></i><strong>{{ s.name }}</strong></span
            >
          </button>
        </div>
      </div>
    </aside>
    <main v-if="active" class="canvas-editor">
      <div ref="safeArea" class="canvas-fit-area" aria-hidden="true"></div>
      <CanvasStage
        :key="active.id"
        ref="stage"
        :sheet="active"
        :tool="tool"
        :settings="settings"
        :image="image"
        :safe-area="safeArea"
        @error="showError"
        @saving="saving = $event"
        @choose-photo="inspector?.choosePhoto($event)"
      />
      <header class="canvas-document">
        <button
          class="canvas-list-toggle glass-surface"
          aria-label="打开画布列表"
          title="画布列表"
          @click="panel = 'list'"
        >
          <Layers />
        </button>
        <div class="canvas-title glass-surface">
          <h2>
            <button
              :title="'编辑' + active.name"
              aria-label="画布设置"
              @click="openForm('edit')"
            >
              <span>{{ active.name }}</span
              ><Edit />
            </button>
          </h2>
        </div>
        <div class="canvas-document-actions glass-surface">
          <span
            class="canvas-save-status"
            :data-state="guestMode ? 'guest' : saving ? 'saving' : 'saved'"
            ><i></i
            >{{
              guestMode ? '访客预览' : saving ? '正在保存' : '本机画布'
            }}</span
          >
          <button
            class="canvas-props-toggle"
            aria-label="打开工具属性"
            aria-controls="canvas-tool-inspector"
            :aria-expanded="panel === 'properties'"
            title="工具属性"
            @click="panel = 'properties'"
          >
            <Settings />
          </button>
          <button
            aria-label="撤销"
            title="撤销 (Ctrl+Z)"
            :disabled="!active.head || saving"
            @click="history(-1)"
          >
            <Undo />
          </button>
          <button
            aria-label="重做"
            title="重做 (Ctrl+Shift+Z)"
            :disabled="active.head >= active.length || saving"
            @click="history(1)"
          >
            <Redo />
          </button>
          <button
            class="canvas-export"
            :disabled="exporting || saving"
            title="导出 PNG"
            aria-label="导出 PNG"
            @click="download"
          >
            <Download /><span>{{ exporting ? '导出中' : '导出 PNG' }}</span>
          </button>
        </div>
      </header>
      <CanvasInspector
        ref="inspector"
        v-model="settings"
        v-model:tool="tool"
        :paper="active.paper"
        :image="image"
        :zoom="stage?.zoom ?? 1"
        :can-zoom-in="stage?.canZoomIn ?? false"
        :can-zoom-out="stage?.canZoomOut ?? false"
        @zoom-in="stage?.zoomIn()"
        @zoom-out="stage?.zoomOut()"
        @fit="stage?.fit()"
        @image="selectPhoto"
        @paste-photo="pastePhoto()"
        @paper="background"
        @error="showError"
        @close="panel = undefined"
      />
    </main>
    <p v-else class="canvas-loading">
      {{ error ? '无法载入画布' : '正在打开画布…' }}
    </p>
    <div v-if="error" class="canvas-error glass-surface" role="alert">
      {{ error
      }}<button aria-label="关闭提示" @click="error = ''"><Close /></button>
    </div>
  </section>
  <BaseDialog
    :open="!!modal"
    :title="
      modal === 'create'
        ? '新建画布'
        : modal === 'delete'
          ? '删除画布'
          : '画布设置'
    "
    :width="370"
    @update:open="!busy && (modal = undefined)"
  >
    <form class="canvas-form" @submit.prevent="submit">
      <template v-if="modal !== 'delete'">
        <label
          >画布名称<input v-model="name" autofocus maxlength="64" required
        /></label>
        <template v-if="modal === 'create'">
          <fieldset>
            <legend>底色</legend>
            <div class="canvas-form-choices">
              <button
                v-for="[value, label] in [
                  ['#ffffff', '白色'],
                  ['#000000', '黑色'],
                ] as const"
                :key="value"
                type="button"
                :aria-pressed="paper === value"
                @click="paper = value"
              >
                <i :style="{ background: value }"></i>{{ label }}
              </button>
            </div>
          </fieldset>
        </template>
      </template>
      <p v-else>删除「{{ name }}」及其全部绘画内容？此操作无法撤销。</p>
      <p v-if="formError" role="alert">{{ formError }}</p>
      <div class="canvas-form-actions">
        <button
          v-if="modal === 'edit'"
          type="button"
          class="danger"
          @click="modal = 'delete'"
        >
          删除画布</button
        ><button type="button" :disabled="busy" @click="modal = undefined">
          取消</button
        ><button
          type="submit"
          :disabled="busy"
          :class="modal === 'delete' ? 'danger' : 'primary'"
        >
          {{
            modal === 'create'
              ? '创建'
              : modal === 'delete'
                ? '确认删除'
                : '保存'
          }}
        </button>
      </div>
    </form>
  </BaseDialog>
</template>
