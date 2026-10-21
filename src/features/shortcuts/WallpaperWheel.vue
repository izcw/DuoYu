<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import AddShortcutDialog from './components/AddShortcutDialog.vue';
import RadialWheel from '../../shared/components/composite/RadialWheel.vue';
import { database, type ShortcutItem } from '../../shared/storage/database';
import { isWallpaperBlank as blank } from '../wallpaper/blank-area';
const emit = defineEmits<{ workspace: []; library: [] }>();
const actions: ShortcutItem[] = [
  { id: 'duoyu-canvas', name: '画布', icon: '/images/shortcuts/canvas.png' },
  { id: 'duoyu-memo', name: '便签', icon: '/images/shortcuts/memo.png' },
  {
    id: 'duoyu-translate',
    name: '翻译',
    icon: '/images/shortcuts/translate.png',
    url: 'https://fanyi.baidu.com/',
  },
  {
    id: 'duoyu-workspace',
    name: '标签工作区',
    icon: '/images/shortcuts/label.png',
  },
  {
    id: 'duoyu-library',
    name: '收藏库',
    icon: '/images/shortcuts/collection.png',
  },
];

const defaults: ShortcutItem[] = [
  {
    id: 'weread',
    name: '微信读书',
    url: 'https://weread.qq.com/',
    icon: '/images/shortcuts/weread.png',
  },
  {
    id: 'lumehub',
    name: 'LumeHub',
    url: 'https://lumehub.duoyu.link/',
    icon: '/images/shortcuts/lumehub.ico',
  },
  {
    id: 'sspai',
    name: '少数派',
    url: 'https://sspai.com/',
    icon: '/images/shortcuts/sspai.ico',
  },
  ...actions,
  { id: 'add', name: '添加网址', icon: '/images/add.png' },
];
const items = ref(defaults);
const visible = ref(false);
const mounted = ref(false);
const center = ref({ x: 0, y: 0 });
const radius = ref(112);
const wheel = ref<InstanceType<typeof RadialWheel>>();
const interaction = { clickButton: 2, holdButton: 2, dragButton: 0 } as const;
const dialog = ref(false);
const notice = ref('');
const saving = ref(false);
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let gesture: { id: number; x: number; y: number; holding: boolean } | undefined;
let ignoreContext = false;
let ready = false;
let writeQueue = Promise.resolve();
function reorder(ids: string[]) {
  items.value = ids.map((id) => items.value.find((item) => item.id === id)!);
  void save();
}
function save() {
  const snapshot = JSON.parse(JSON.stringify(items.value)) as ShortcutItem[];
  writeQueue = writeQueue
    .then(async () => {
      await database.shortcuts.put({ id: 'wallpaper', items: snapshot });
    })
    .catch(() => {
      notice.value = '保存失败，当前排列仅在本页生效';
    });
  return writeQueue;
}
function open(x: number, y: number) {
  if (!ready || dialog.value) return;
  clearTimeout(closeTimer);
  radius.value = Math.min(
    Math.max(112, items.value.length * 9),
    window.innerWidth / 2 - 34,
    window.innerHeight / 2 - 34,
  );
  const margin = radius.value + 30;
  center.value = {
    x: Math.max(margin, Math.min(innerWidth - margin, x)),
    y: Math.max(margin, Math.min(innerHeight - margin, y)),
  };
  mounted.value = true;
  void nextTick(() => {
    requestAnimationFrame(() => {
      visible.value = true;
    });
  });
}
function close() {
  visible.value = false;
  clearTimeout(holdTimer);
  gesture = undefined;
  closeTimer = setTimeout(() => {
    mounted.value = false;
  }, 220);
}
function select(id: string) {
  const item = items.value.find((entry) => entry.id === id);
  if (!item) return;
  close();
  if (id === 'duoyu-workspace' || id === 'duoyu-library') {
    setTimeout(() => {
      if (id === 'duoyu-workspace') emit('workspace');
      else emit('library');
    }, 220);
  } else if (id === 'add') {
    dialog.value = true;
  } else if (item.url) {
    void browser.tabs.create({ url: item.url });
  }
}
function contextMenu(event: MouseEvent) {
  if (ignoreContext) {
    event.preventDefault();
    return;
  }
  if (!blank(event.target) || dialog.value) return;
  event.preventDefault();
  if (visible.value) {
    close();
    return;
  }
  open(event.clientX, event.clientY);
}
function down(event: PointerEvent) {
  if (dialog.value || !event.isPrimary) return;
  const target = event.target as Element;
  if (event.button === interaction.clickButton) {
    ignoreContext = false;
    if (visible.value) {
      event.preventDefault();
      ignoreContext = true;
      close();
      return;
    }
    if (!blank(target)) return;
    event.preventDefault();
    ignoreContext = true;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      holding: false,
    };
    holdTimer = setTimeout(() => {
      if (!gesture) return;
      gesture.holding = true;
      open(gesture.x, gesture.y);
    }, 180);
  } else if (
    event.button === 0 &&
    visible.value &&
    !target.closest('.radial-wheel')
  ) {
    close();
  }
}
function move(event: PointerEvent) {
  if (gesture?.id === event.pointerId && gesture.holding)
    wheel.value?.preview(event.clientX, event.clientY);
}
function up(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId) return;
  clearTimeout(holdTimer);
  const finished = gesture;
  gesture = undefined;
  if (finished.holding) {
    if (
      Math.hypot(
        event.clientX - center.value.x,
        event.clientY - center.value.y,
      ) > 22
    )
      wheel.value?.selectAt(event.clientX, event.clientY);
    close();
  } else open(finished.x, finished.y);
}
function cancel() {
  close();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (dialog.value) dialog.value = false;
    cancel();
  }
}
async function add(item: ShortcutItem) {
  if (saving.value) return;
  saving.value = true;
  items.value.splice(
    items.value.findIndex((entry) => entry.id === 'add'),
    0,
    item,
  );
  await save();
  saving.value = false;
  dialog.value = false;
}
onMounted(async () => {
  try {
    await database.transaction('rw', database.shortcuts, async () => {
      const stored = await database.shortcuts.get('wallpaper');
      if (
        stored?.items.length &&
        stored.items.some((item) => item.id === 'add')
      )
        items.value = stored.items;
      items.value = items.value.filter(
        (item) =>
          ![
            'bilibili',
            'xiaohongshu',
            'deepseek',
            'mail',
            'translate',
            'translation',
            'baidu-translate',
          ].includes(item.id) &&
          (item.id === 'duoyu-translate' ||
            !item.url?.startsWith('https://fanyi.baidu.com/')),
      );
      // Add built-in actions without resetting the user's saved wheel order.
      for (const action of actions) {
        const index = items.value.findIndex((item) => item.id === action.id);
        if (index >= 0) items.value[index] = action;
        else
          items.value.splice(
            items.value.findIndex((item) => item.id === 'add'),
            0,
            action,
          );
      }
      await database.shortcuts.put({
        id: 'wallpaper',
        items: JSON.parse(JSON.stringify(items.value)) as ShortcutItem[],
      });
    });
  } catch {
    notice.value = '本地存储暂不可用';
  }
  ready = true;
  document.addEventListener('contextmenu', contextMenu);
  document.addEventListener('pointerdown', down);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', keydown);
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
});
onUnmounted(() => {
  clearTimeout(holdTimer);
  clearTimeout(closeTimer);
  document.removeEventListener('contextmenu', contextMenu);
  document.removeEventListener('pointerdown', down);
  document.removeEventListener('pointermove', move);
  document.removeEventListener('pointerup', up);
  document.removeEventListener('pointercancel', cancel);
  document.removeEventListener('keydown', keydown);
  window.removeEventListener('blur', cancel);
  window.removeEventListener('resize', cancel);
});
</script>

<template>
  <Teleport to="body">
    <RadialWheel
      v-if="mounted"
      ref="wheel"
      class="wallpaper-wheel"
      :items="items"
      :open="visible"
      :center="center"
      :radius="radius"
      :interaction="interaction"
      clear-selection-in-center
      label="壁纸快捷网址"
      @select="select"
      @reorder="reorder"
      @close="close"
    />
    <AddShortcutDialog v-model:open="dialog" :busy="saving" @submit="add" />
    <p
      v-if="notice"
      class="shortcut-notice glass-surface"
      role="status"
      @click="notice = ''"
    >
      {{ notice }}
    </p>
  </Teleport>
</template>

<style scoped>
.shortcut-notice {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483002;
  padding: 10px 16px;
  border-radius: 8px;
  color: #fff;
}
@media (prefers-reduced-motion: reduce) {
  .wallpaper-wheel * {
    transition: none !important;
  }
}
</style>
