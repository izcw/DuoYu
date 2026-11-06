<script setup lang="ts">
import { guestMode } from '../../shared/storage/account';
import ReorderTransition from '../../shared/components/base/ReorderTransition.vue';
import { createDragLanding } from '../../shared/drag-landing';
import { computed, ref, onUnmounted } from 'vue';
import WorkspaceFavicon from '../workspace/WorkspaceFavicon.vue';
import { database, type LibraryItem } from '../../shared/storage/database';
import { FOLDER_ICON_SIZE } from './grid-config';
import { beginFolderDrag, folderDragItemId } from './page-drag';
const props = defineProps<{items:LibraryItem[]; columns:number; rows:number; disabled?:boolean}>();
const emit = defineEmits<{open:[item:LibraryItem];error:[message:string]}>();
let cleanup: (()=>void)|undefined;
let suppressUntil=0;
async function reorder(item:LibraryItem, target:string){
  try {
    await database.transaction('rw', database.libraryItems, async()=>{
      const items=(await database.libraryItems.where('parent').equals(item.parent).sortBy('order')).filter(i=>i.pageId===item.pageId);
      const from=items.findIndex(i=>i.id===item.id), to=items.findIndex(i=>i.id===target);
      if(from<0 || to<0 || from===to)return;
      items.splice(to,0,items.splice(from,1)[0]!);
      for(const [index,entry] of items.entries()) if(entry.order!==index) await database.libraryItems.update(entry.id,{order:index,updatedAt:Date.now()});
    });
  } catch { emit('error','文件夹排序保存失败，请重试'); }
}
const landing = createDragLanding();
const movingId = ref('');
const order = ref<string[]>([]);
const visible = computed(()=>{
  const icons=props.items.slice(0,props.columns*props.rows);
  return movingId.value ? order.value.flatMap(id=>icons.filter(icon=>icon.id===id)) : icons;
});
function press(event:MouseEvent,item:LibraryItem){
  if(guestMode || props.disabled || event.button!==0 || landing.committing)return;
  cleanup?.();
  const icon=event.currentTarget as HTMLElement;
  const boundary=icon.closest('.cell-panel')!.getBoundingClientRect();
  const slots=Array.from(icon.parentElement!.querySelectorAll<HTMLElement>('[data-folder-item]'),el=>{
    const rect=el.getBoundingClientRect();
    return {id:el.dataset.folderItem!,x:rect.left+rect.width/2,y:rect.top+rect.height/2};
  });
  let target=item.id;
  function move(e:MouseEvent){
    if(!movingId.value){
      if(Math.hypot(e.clientX-event.clientX,e.clientY-event.clientY)<5)return;
      landing.capture(event,icon,'[data-folder-item="'+CSS.escape(item.id)+'"]');
      order.value=slots.map(slot=>slot.id);
      movingId.value=item.id;
      suppressUntil=Infinity;
    }
    if(e.clientX<boundary.left || e.clientX>boundary.right || e.clientY<boundary.top || e.clientY>boundary.bottom){
      cancel();beginFolderDrag(item.id,item.pageId || 'default',icon,e);return;
    }
    landing.track(e);
    const distance=(slot:typeof slots[number])=>Math.hypot(slot.x-e.clientX,slot.y-e.clientY);
    const closest=slots.reduce((a,b)=>distance(a)<=distance(b)?a:b);
    target=closest.id;
    const next=slots.map(s=>s.id).filter(id=>id!==item.id);
    next.splice(slots.indexOf(closest),0,item.id);
    order.value=next;
  }
  function release(e:MouseEvent){
    stop();
    if(!movingId.value)return;
    landing.track(e);
    void landing.commit(()=>reorder(item,target),reset,async()=>{});
  }
  function reset(){movingId.value='';suppressUntil=performance.now()+400;}
  function cancel(){stop();if(movingId.value)reset();landing.dispose();}
  function stop(){window.removeEventListener('mousemove',move,true);window.removeEventListener('mouseup',release,true);window.removeEventListener('blur',cancel);cleanup=undefined;}
  cleanup=cancel;window.addEventListener('mousemove',move,true);window.addEventListener('mouseup',release,true);window.addEventListener('blur',cancel);
}
function open(item:LibraryItem){if(!props.disabled && performance.now()>=suppressUntil)emit("open",item);}
onUnmounted(()=>{cleanup?.();landing.dispose();});
</script>
<template>
  <ReorderTransition class="preview-icons" :style="{gridTemplateColumns:'repeat('+columns+',minmax(0,1fr))',gridTemplateRows:'repeat('+rows+',minmax(0,1fr))','--folder-icon-size':FOLDER_ICON_SIZE+'px'}">
    <button v-for="item in visible" :key="item.id" class="folder-icon cell-icon glass-interaction-target" :data-folder-item="item.id" :style="{visibility:(folderDragItemId===item.id || movingId===item.id)?'hidden':undefined}" :aria-label="'打开收藏 '+item.name" @pointerdown.stop @mousedown.stop="press($event,item)" @dragstart.prevent @click.stop="open(item)">
      <WorkspaceFavicon :src="item.icon" :page-url="item.url" :title="item.name"/>
    </button>
  </ReorderTransition>
</template>
<style scoped>
.preview-icons { display:grid; place-items:center; pointer-events:none; min-width:0; min-height:0; }
.preview-icons > .folder-icon { pointer-events:auto; cursor:pointer; box-sizing:border-box; display:grid; place-items:center; width:var(--folder-icon-size); height:var(--folder-icon-size); min-width:0; min-height:0; overflow:hidden; border:0; }
.preview-icons .folder-icon > :deep(.workspace-favicon) { width:100%; height:100%; min-width:0; min-height:0; }
.preview-icons .folder-icon :deep(img) { width:100%; height:100%; object-fit:contain; }
</style>