<script setup lang="ts">
import { vAccountEdit, vAccountDrag } from '../auth/edit-access';
import { guestMode } from '../../shared/storage/account';
import { computed, onUnmounted, ref, watch, nextTick } from 'vue';
import { createDragLanding } from '../../shared/drag-landing';
import { accountStorage } from '../../shared/storage/account';
import { saveWallpaperPreview } from './wallpaper-preview';
import { liveQuery } from 'dexie';
import { database } from '../../shared/storage/database';
import { assetObjectUrl } from '../sync/assets';
import {
  activeDesktop,
  addDesktop,
  chooseDesktop,
  renameDesktop,
  deleteDesktop,
  prefix,
  switchDesktop,
  type Desktop,
} from './desktops';
import { readDesktop } from './desktop-profile';
import WallpaperBackground from './WallpaperBackground.vue';
import WallpaperSurface from './WallpaperSurface.vue';
import { getDailyWallpaperUrl } from './wallpaper';

const emit = defineEmits<{ selected: [] }>();
const editing = ref<{
  id: string;
  name: string;
  action: 'menu' | 'rename' | 'delete';
}>();
function wheel(event: WheelEvent) {
  const el = event.currentTarget as HTMLElement;
  if (
    event.ctrlKey ||
    Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
    el.scrollWidth <= el.clientWidth
  )
    return;
  event.preventDefault();
  el.scrollLeft +=
    event.deltaY *
    (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1);
}
async function submitAction() {
  const item = editing.value;
  if (!item) return;
  try {
    if (item.action === 'rename') await renameDesktop(item.id, item.name);
    else if (item.action === 'delete') {
      const wasActive = activeDesktop.value === item.id;
      await deleteDesktop(item.id);
      if (wasActive) {
        dialog.value?.close();
        emit('selected');
      }
    }
    editing.value = undefined;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '桌面操作失败';
  }
}
const dialog = ref<HTMLDialogElement>();
const profiles = ref<Desktop[]>([]);
const active = computed(() =>
  profiles.value.find((p) => p.id === activeDesktop.value),
);
const legacyBlob = ref<Blob>();
const error = ref('');
const subscription = liveQuery(async () => ({
  desktops: (
    await database.preferences.where('id').startsWith(prefix).toArray()
  ).map((p) => p.value as Desktop),
  first: await readDesktop('default'),
  deleted: await database.syncShadow.get(
    'preferences:' + prefix + activeDesktop.value,
  ),
  mode: (await database.preferences.get('wallpaperMode'))?.value,
})).subscribe({
  next: ({ desktops, first, deleted }) => {
    if (
      activeDesktop.value !== 'default' &&
      !desktops.some((d) => d.id === activeDesktop.value) &&
      deleted?.deleted &&
      deleted.entityId === prefix + activeDesktop.value
    ) {
      switchDesktop('default');
      emit('selected');
    }
    profiles.value = [first, ...desktops.filter((d) => d.id !== 'default')].sort(
      (a, b) => a.created - b.created || a.id.localeCompare(b.id),
    );
    legacyBlob.value = first.legacyBlob;
  },
  error: () => {
    error.value = '无法读取桌面壁纸';
  },
});
const cards = computed(() => [
  profiles.value.find((p) => p.id === 'default') ?? {
    id: 'default',
    created: 0,
    selection: 'legacy',
    name: undefined,
  },
  ...profiles.value.filter((p) => p.id !== 'default'),
]);
const orderKey = 'duoyu-desktop-order';
function savedOrder(): string[] {
  try { const ids = JSON.parse(accountStorage.getItem(orderKey) || '[]'); return Array.isArray(ids) ? ids : []; } catch {return [];}
}
const order = ref(savedOrder());
const orderedCards = computed(() => {
  const positions = new Map(order.value.map((id,index)=>[id,index]));
  return [...cards.value].sort((a,b)=>(positions.get(a.id) ?? Infinity)-(positions.get(b.id) ?? Infinity));
});
const dragged = ref('');
let original:string[] = [], slots:{id:string;center:number}[] = [];
const landing = createDragLanding();
let cancelGesture: (() => void) | undefined;
let suppressClick = false;
function press(event:MouseEvent,id:string) {
  if(guestMode || event.button !== 0 || landing.committing) return;
  cancelGesture?.();
  const button = event.currentTarget as HTMLElement, strip = button.parentElement!;
  function inside(e:MouseEvent){ return strip.contains(document.elementFromPoint(e.clientX,e.clientY)); }
  function move(e:MouseEvent){
    if(!dragged.value){
      if(Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<5)return;
      original=orderedCards.value.map(card=>card.id);
      slots=Array.from(strip.querySelectorAll<HTMLElement>('[data-desktop]'),el=>{
        const rect=el.getBoundingClientRect();
        return {id:el.dataset.desktop!,center:rect.left+rect.width/2+strip.scrollLeft};
      });
      landing.capture(event,button,'[data-desktop="'+CSS.escape(id)+'"]');
      dragged.value=id;
      suppressClick=true;
    }
    landing.track(e);
    if(!inside(e))return;
    const x=e.clientX+strip.scrollLeft,next=original.filter(value=>value!==id);
    next.splice(slots.filter(slot=>slot.id!==id && x>slot.center).length,0,id);
    order.value=next;
  }
  function cleanup(){
    window.removeEventListener('mousemove',move);
    window.removeEventListener('mouseup',release);
    window.removeEventListener('blur',cancel);
    window.removeEventListener('keydown',key);
    cancelGesture=undefined;
    setTimeout(()=>{suppressClick=false;},0);
  }
  function cancel(){cleanup();if(dragged.value)order.value=original;dragged.value='';landing.dispose();}
  function key(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();cancel();}}
  function release(e:MouseEvent){
    if(!dragged.value || !inside(e)){cancel();return;}
    cleanup();
    landing.track(e);
    void landing.commit(async()=>{accountStorage.setItem(orderKey,JSON.stringify(order.value));},()=>{dragged.value='';},nextTick)
      .catch(()=>{order.value=original;error.value='桌面顺序保存失败';});
  }
  cancelGesture=cancel;
  window.addEventListener('mousemove',move);
  window.addEventListener('mouseup',release);
  window.addEventListener('blur',cancel);
  window.addEventListener('keydown',key);
}
function cardName(id:string){const i=cards.value.findIndex(card=>card.id===id);return cards.value[i]?.name || '桌面'+(i+1);}
const daily = ref(getDailyWallpaperUrl());
const timer = setInterval(() => {
  daily.value = getDailyWallpaperUrl();
}, 60000);
const legacyUrl = ref('');
watch(legacyBlob, (blob, _, cleanup) => {
  legacyUrl.value = blob ? URL.createObjectURL(blob) : '';
  const url = legacyUrl.value;
  if (url) cleanup(() => URL.revokeObjectURL(url));
});
const retryImages = ref(0);
const retryAssets = () => { retryImages.value++; };
window.addEventListener('duoyu-assets-retry', retryAssets);
window.addEventListener('online', retryAssets);
const imageCache = ref<Record<string, string>>({});
const imageKey = (card: Desktop) => card.asset || (card.selection === 'daily' ? daily.value : legacyUrl.value);
const images = computed(() => Object.fromEntries(cards.value.map(card => [card.id, imageCache.value[imageKey(card)] || ''])));
const opened = ref(false);
watch(
  [cards, activeDesktop, opened, daily, legacyUrl, retryImages],
  async (_, __, cleanup) => {
    let valid = true;
    cleanup(() => {
      valid = false;
    });
    for (const card of cards.value) {
      if (!opened.value && (card.id !== activeDesktop.value || card.selection === 'legacy' || card.selection === 'daily')) continue;
      try {
        const image = card.asset
          ? await assetObjectUrl(card.asset)
          : card.id === 'default' && legacyUrl.value
            ? legacyUrl.value
            : card.selection === 'daily' ? daily.value : '';
        if (valid && image) imageCache.value = { ...imageCache.value, [imageKey(card)]: image };
      } catch {
        if (valid)
          error.value = '壁纸暂时无法加载，请检查网络后重新打开切换面板';
      }
    }
  },
  { immediate: true },
);
const source = computed(() => images.value[activeDesktop.value] || '');
watch(
  [source, active],
  ([url, profile], _, cleanup) => {
    if (!profile || profile.selection === 'daily' || !url) return;
    const preview = new Image();
    preview.onload = () => saveWallpaperPreview(preview,profile.asset || url,profile.asset ? 'local:'+profile.asset : url, profile.id === 'default' ? 'duoyu:wallpaper-preview' : 'duoyu:desktop-preview:'+profile.id);
    preview.src=url;
    document.documentElement.style.setProperty(
      '--desktop-wallpaper-image',
      `url("${url}")`,
    );
    document.documentElement.dataset.desktopWallpaper = 'ready';
    cleanup(() => {
      preview.onload=null;
      document.documentElement.style.removeProperty(
        '--desktop-wallpaper-image',
      );
      delete document.documentElement.dataset.desktopWallpaper;
    });
  },
  { flush: 'post' },
);
const adding = ref(false);
async function add() {
  if (adding.value) return;
  adding.value = true;
  try {
    const id = await addDesktop();
    await select(id);
  } catch {
    error.value = '桌面创建失败，请重试';
  } finally {
    adding.value = false;
  }
}
async function open() {
  opened.value = true;
  error.value = '';
  await nextTick();
  dialog.value?.showModal();
}
async function select(id: string) {
  if (suppressClick || landing.committing) return;
  try {
    if (guestMode) switchDesktop(id);
    else await chooseDesktop(id);
    dialog.value?.close();
    emit('selected');
  } catch {
    error.value = '桌面选择保存失败，请重试';
  }
}
onUnmounted(() => {
  cancelGesture?.();
  landing.dispose();
  subscription.unsubscribe();
  window.removeEventListener('duoyu-assets-retry', retryAssets);
  window.removeEventListener('online', retryAssets);
  clearInterval(timer);
});
</script>
<template>
  <WallpaperBackground :key="activeDesktop" :desktop="activeDesktop"
    v-if="
      active?.selection === 'daily'
    "
  />
  <WallpaperSurface v-else :source="source" :loaded="!!source" />
  <Teleport to="#desktop-switch-slot">
    <button
      class="desktop-switch-entry"
      aria-label="切换桌面"
      title="切换桌面"
      @click="open"
    >
      <img src="/images/switch-desktop.png" alt="" />
    </button>
  </Teleport>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="desktop-drawer"
      aria-labelledby="desktop-drawer-title"
      @close="
        opened = false;
        editing = undefined;
      "
      @click="$event.target === dialog && dialog?.close()"
    >
      <section>
        <header>
          <h2 id="desktop-drawer-title">切换桌面</h2>
          <button aria-label="关闭切换桌面" @click="dialog?.close()">×</button>
        </header>
        <TransitionGroup tag="div" name="card-order" class="desktop-cards" @wheel="wheel">
          <button
            v-for="card in orderedCards"
            v-account-drag draggable="false" :data-desktop="card.id" :class="{dragging:dragged===card.id}" @mousedown="press($event,card.id)"
            :key="card.id"
            :aria-pressed="activeDesktop === card.id"
            @click="select(card.id)"
            @contextmenu.prevent="
              (editing = {
                id: card.id,
                name: cardName(card.id),
                action: 'menu',
              })
            "
          >
            <span class="desktop-thumb"
              ><img
                draggable="false" v-if="opened && images[card.id]"
                :src="images[card.id]"
                alt="" /></span
            ><strong>{{ cardName(card.id) }}</strong></button
          ><button v-account-edit key="add" aria-label="添加桌面" :disabled="adding" @click="add">
            <span class="desktop-thumb desktop-plus">＋</span
            ><strong>添加桌面</strong>
          </button>
        </TransitionGroup>
        <form
          v-if="editing"
          class="desktop-actions"
          @submit.prevent="submitAction"
        >
          <template v-if="editing.action === 'menu'"
            ><strong>{{ editing.name }}</strong
            ><button
              type="button"
              v-account-edit @click="
                editing.action = 'rename';
                nextTick(() => dialog?.querySelector('input')?.select());
              "
            >
              重命名</button
            ><button
              v-if="editing.id !== 'default'"
              type="button"
              v-account-edit @click="editing.action = 'delete'"
            >
              删除桌面
            </button></template
          >
          <template v-else-if="editing.action === 'rename'"
            ><input
              v-model="editing.name"
              maxlength="40"
              aria-label="桌面名称"
              required
            /><button>保存</button></template
          >
          <template v-else
            ><span>删除「{{ editing.name }}」？</span
            ><button>确认删除</button></template
          >
          <button type="button" @click="editing = undefined">取消</button>
        </form>
        <p v-if="error" role="alert">{{ error }}</p>
      </section>
    </dialog>
  </Teleport>
</template>
<style scoped>
.desktop-switch-entry {
  width: 36px;
  height: 36px;
  padding: 6px;
  z-index: 2147483001;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.desktop-switch-entry img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.desktop-drawer {
  position: fixed;
  inset: auto 0 0;
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 22px 22px 0 0;
  color: #222;
  background: #fff;
}
.desktop-drawer[open] {
  animation: drawer-in 0.22s ease-out;
}
.desktop-drawer::backdrop {
  background: #0005;
}
.desktop-drawer section {
  padding: 22px clamp(18px, 4vw, 64px) 28px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
header h2 {
  font-size: 20px;
  margin: 0;
}
header button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  font-size: 20px;
  cursor: pointer;
}
.desktop-cards {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 16px 3px 4px;
}
.desktop-cards button {
  background: none;
  border: 0;
  flex: 0 0 clamp(144px, 19vw, 240px);
  padding: 0;
  color: inherit;
  cursor: pointer;
}
.card-order-move { transition: transform .18s ease; }
.desktop-cards button.dragging { opacity:0; }
.desktop-cards button[data-desktop] { cursor: grab; }
.desktop-cards button[data-desktop]:active,
.desktop-cards:has(.dragging),
.desktop-cards:has(.dragging) button { cursor: grabbing; }
.desktop-thumb {
  display: grid;
  place-items: center;
  aspect-ratio: 16/9;
  border-radius: 12px;
  overflow: hidden;
  background: #f5f5f7;
}
.desktop-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
[aria-pressed='true'] .desktop-thumb {
  outline: 2px solid #222;
  outline-offset: 2px;
}
strong {
  display: block;
  margin-top: 8px;
  font-size: 14px;
}
.desktop-plus {
  font-size: 32px;
  color: #666;
}
@keyframes drawer-in {
  from {
    transform: translateY(100%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .desktop-drawer[open] {
    animation: none;
  }
}
.desktop-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.desktop-actions button,
.desktop-actions input {
  border: 0;
  background: #f5f5f7;
  border-radius: 8px;
  padding: 8px 14px;
  color: #222;
}
</style>
