<script setup lang="ts">
import WorkspaceFavicon from './WorkspaceFavicon.vue';
import { computed } from 'vue';
import { hostname, webUrl } from './collections';
const props = defineProps<{ title:string; url:string; icon?:string; readonly?:boolean; openUrls?: ReadonlySet<string> }>();
const href = computed(() => webUrl(props.url));
defineEmits<{open:[]}>();
</script>
<template>
  <div class="workspace-card-main">
    <span class="workspace-icon-slot"><WorkspaceFavicon :src="icon" :page-url="url" :title="title"/><slot name="checkbox"/></span>
    <component :is="readonly ? 'span' : 'button'" class="workspace-link glass-control" :title="url" @click="$emit('open')"><span><strong>{{ title }}</strong><small>{{ hostname(url) }}</small></span></component>
    <slot/>
    <span v-if="href && openUrls?.has(href)" class="workspace-open-dot" role="img" aria-label="此链接已打开"></span>
  </div>
</template>
