<script setup lang="ts">
import { computed, ref } from 'vue';
import MemoBody from './MemoBody.vue';
import { guestMode } from '../../shared/storage/account';
import type { Memo } from '../../shared/storage/database';

const props = defineProps<{ note: Memo }>();
const emit = defineEmits<{
  body: [value: string, html: string];
  menu: [event: MouseEvent];
  gesture: [event: PointerEvent, action: 'move' | 'resize' | 'sort'];
}>();
const field = ref<InstanceType<typeof MemoBody>>();
const archived = computed(() => props.note.archivedAt !== null);
// Preserve named notes created before headings moved into the body.
const content = computed(() => {
  const { title, html, body } = props.note;
  if (!title || title === '新便签') return html;
  const heading = document.createElement('h1');
  heading.textContent = title;
  const plain = document.createElement('div');
  plain.textContent = body;
  return heading.outerHTML + (html ?? plain.outerHTML);
});
function press(event: PointerEvent) {
  if (archived.value) emit('gesture', event, 'sort');
  else if (event.target === event.currentTarget) emit('gesture', event, 'move');
}
defineExpose({ focusBody: () => field.value?.focus() });
</script>
<template>
  <article
    class="memo-card"
    :data-color="note.color"
    :data-memo-id="note.id"
    :class="{ archived }"
    :aria-label="note.title || note.body.split('\n')[0] || '便签'"
    @contextmenu.prevent.stop="emit('menu', $event)"
    @pointerdown="press"
  >
    <button
      type="button"
      class="memo-options"
      aria-label="便签操作"
      @pointerdown.stop
      @click.stop="emit('menu', $event)"
    >
      ···
    </button>
    <MemoBody
      ref="field"
      :body="note.body"
      :html="content"
      :readonly="archived || guestMode"
      @save="(text, html) => emit('body', text, html)"
    />
    <span
      v-if="!archived"
      class="memo-resize"
      role="img"
      aria-label="调整便签大小"
      @pointerdown.stop="emit('gesture', $event, 'resize')"
    />
  </article>
</template>
