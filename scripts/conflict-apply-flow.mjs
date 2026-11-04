import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ref, computed, nextTick } from 'vue';
const source = (await readFile('src/features/sync/ConflictCenter.vue','utf8')).split('<script setup lang="ts">')[1].split('</script>')[0].replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm,'');
const code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/export \{\};?/g,'');
async function scenario(mode) {
 let rows=[{id:'one',createdAt:1}], applied=0, refreshes=0;
 const scope={ref,computed,nextTick,watch:()=>{},onMounted:()=>{},onUnmounted:()=>{},defineModel:()=>ref(false),
 database:{syncShadow:{toArray:async()=>[]},syncConflicts:{orderBy:()=>({reverse:()=>({toArray:async()=>rows})}),toArray:async()=>rows},syncOutbox:{toArray:async()=>[]}},
 groupPreviewMenus:r=>r.length?[{id:mode==='changed'&&refreshes?'changed':'page:home',records:r,changes:[],menus:[],name:'首页'}]:[],
 conflictChanges:()=>[],prepareLocalPreview:()=>({entities:[],overflow:false}),previewVersion:()=>[],previewConflictViews:()=>[],
 refreshConflictPreview:async()=>{refreshes++;if(mode==='error')throw Error('连接失败');if(mode==='resolved')rows=[];},
 discardConflicts:async()=>{applied++;rows=[];}};
 const api=new Function(...Object.keys(scope),code+';return {apply,records,selected,busy,error,message,latestReady};')(...Object.values(scope));
 api.records.value=rows;api.selected.value='page:home';await api.apply('cloud');
 assert.equal(api.busy.value,false);
 if(mode==='ok'){assert.equal(applied,1);assert.equal(api.error.value,'');assert.equal(api.latestReady.value,true);}
 if(mode==='error'){assert.match(api.error.value,/连接失败/);assert.equal(applied,0);}
 if(mode==='changed'){assert.match(api.error.value,/分组已变化/);assert.equal(applied,0);}
 if(mode==='resolved'){assert.equal(applied,0);assert.equal(api.records.value.length,0);assert(api.message.value);}
}
for(const mode of ['ok','error','changed','resolved'])await scenario(mode);
console.log('PASS refresh then apply in one click, refresh error, regrouping feedback, already-resolved refresh');
