<script setup lang="ts">
import WorkspaceFavicon from './WorkspaceFavicon.vue';
import { hostname } from './collections';
defineProps<{ title:string; url:string; icon?:string; readonly?:boolean }>();
defineEmits<{open:[]}>();
</script>
<template>
  <div class="workspace-card-main">
    <span class="workspace-icon-slot"><WorkspaceFavicon :src="icon" :page-url="url" :title="title"/><slot name="checkbox"/></span>
    <component :is="readonly ? 'span' : 'button'" class="workspace-link glass-control" :title="url" @click="$emit('open')"><span><strong>{{ title }}</strong><small>{{ hostname(url) }}</small></span></component>
    <slot/>
  </div>
</template>
