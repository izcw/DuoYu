<script setup lang="ts">
import { computed, ref } from 'vue';
import MemoBody from './MemoBody.vue';
import { guestMode } from '../../shared/storage/account';
import type { Memo } from '../../shared/storage/database';

const props = defineProps<{
  note: Memo;
  compact?: boolean;
  saveBody: (source: string) => Promise<boolean>;
}>();
const emit = defineEmits<{
  menu: [event: MouseEvent];
  reveal: [];
  gesture: [event: PointerEvent, action: 'move' | 'resize' | 'sort'];
}>();
const field = ref<InstanceType<typeof MemoBody>>();
const archived = computed(() => props.note.archivedAt !== null);
const label = computed(
  () =>
    props.note.title ||
    props.note.body.slice(0, 120).split('\n', 1)[0] ||
    '便签',
);
function press(event: PointerEvent) {
  if ((event.target as Element).closest('a')) return;
  if (archived.value) emit('gesture', event, 'sort');
  else if (
    event.target === event.currentTarget ||
    (event.target as Element).closest('.memo-grip')
  )
    emit('gesture', event, 'move');
}
defineExpose({ focusBody: () => field.value?.focus() });
</script>
<template>
  <button
    v-if="compact"
    type="button"
    class="memo-card memo-distant-card"
    :data-color="note.color"
    :data-memo-id="note.id"
    :aria-label="'查看便签：' + label"
    :title="label"
    @click="
      !$event.shiftKey && !$event.ctrlKey && !$event.metaKey && emit('reveal')
    "
    @contextmenu.prevent.stop="emit('menu', $event)"
  />
  <article
    v-else
    class="memo-card"
    :data-color="note.color"
    :data-memo-id="note.id"
    :class="{ archived }"
    :aria-label="label"
    @contextmenu.prevent.stop="emit('menu', $event)"
    @pointerdown="press"
  >
    <div
      class="memo-grip"
      :title="archived ? '拖动排序' : '拖动便签'"
      aria-hidden="true"
    ></div>
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
      :note="note"
      :save-body="saveBody"
      :readonly="archived || guestMode"
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

<style scoped>
.memo-distant-card {
  padding: 0;
  background: var(--paper);
  box-shadow: none;
  cursor: zoom-in;
}
.memo-distant-card:is(:focus-visible, .is-selected) {
  outline: calc(2px / var(--memo-camera-scale)) solid currentColor;
  outline-offset: calc(1px / var(--memo-camera-scale));
}
</style>
