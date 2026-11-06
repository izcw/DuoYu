<script setup lang="ts">
import { vAccountEdit, vAccountDrag } from '../../../features/auth/edit-access';
import { guestMode } from '../../../shared/storage/account';
import { useMouseSort } from '../../useMouseSort';
const pressSort = useMouseSort();
import { computed, ref, onUnmounted } from 'vue';
import { createDragLanding } from '../../drag-landing';
import PageIcon from './PageIcon.vue';
import ReorderTransition from './ReorderTransition.vue';
import '../../side-menu.css';
type Entry = { id: string; name: string; icon?: string };
const props = defineProps<{
  label: string;
  addLabel: string;
  pinned: Entry;
  items: Entry[];
  active: string;
  visible?: boolean;
  disabled?: boolean;
  library?: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  add: [];
  context: [event: MouseEvent, id: string];
  reorder: [ids: string[]];
}>();
const hovered = ref(false),
  focused = ref(false),
  hot = ref(''),
  dragged = ref('');
const shown = computed(
  () => props.visible || hovered.value || focused.value || !!dragged.value,
);
const panel = ref<HTMLElement>(),
  preview = ref<string[]>();
const entries = computed(() =>
  preview.value
    ? preview.value.flatMap((id) =>
        props.items.filter((item) => item.id === id),
      )
    : props.items,
);
let slots: { id: string; center: number }[] = [],
  startScroll = 0;
function blur(event: FocusEvent) {
  focused.value =
    event.currentTarget instanceof HTMLElement &&
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget);
}
const dragPreview = createDragLanding();
onUnmounted(dragPreview.dispose);
function start(event: DragEvent, id: string) {
  if (props.disabled || guestMode) {
    event.preventDefault();
    return;
  }
  dragPreview.capture(event, event.currentTarget as HTMLElement, '');
  dragged.value = id;
  startScroll = panel.value?.scrollTop || 0;
  slots = Array.from(
    panel.value?.querySelectorAll<HTMLElement>('[data-menu-row]') || [],
    (row) => {
      const r = row.getBoundingClientRect();
      return { id: row.dataset.menuRow!, center: r.top + r.height / 2 };
    },
  );
  event.dataTransfer?.setData(
    props.library
      ? 'application/x-duoyu-library-page'
      : 'application/x-duoyu-workspace-space',
    id,
  );
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function over(event: DragEvent) {
  if (!dragged.value) return;
  event.preventDefault();
  const ids = slots.filter((slot) => slot.id !== dragged.value);
  const y = event.clientY + (panel.value?.scrollTop || 0) - startScroll;
  const next = ids.map((slot) => slot.id);
  next.splice(ids.filter((slot) => y > slot.center).length, 0, dragged.value);
  preview.value = next;
}
function end() {
  dragPreview.dispose();
  dragged.value = '';
  preview.value = undefined;
  slots = [];
}
function drop(event: DragEvent) {
  if (!dragged.value) return;
  event.preventDefault();
  if (preview.value) emit('reorder', [...preview.value]);
  end();
}
</script>
<template>
  <div
    class="desktop-menu"
    @mousedown.capture="!guestMode && pressSort($event)"
    :class="{ 'is-hovered': shown }"
    :tabindex="shown ? -1 : 0"
    :aria-label="label"
    @mouseenter="hovered = true"
    @mouseleave="
      hovered = false;
      hot = '';
    "
    @focusin="focused = true"
    @focusout="blur"
  >
    <nav
      ref="panel"
      class="side-menu"
      :class="{ 'library-page-menu': library }"
      :aria-label="label"
      :inert="!shown"
      :aria-hidden="!shown"
      @pointerdown.stop
      @click.stop
      @dragover="over"
      @drop="drop"
      @dragend="end"
      @keydown.esc="end"
    >
      <slot name="notice" />
      <button
        class="side-menu-choice"
        :class="
          library ? 'library-page-choice library-home' : 'workspace-space'
        "
        :data-library-page-id="library ? pinned.id : undefined"
        :aria-pressed="active === pinned.id"
        :aria-current="active === pinned.id ? 'page' : undefined"
        @mouseenter="hot = pinned.id"
        @mouseleave="hot = ''"
        @click="emit('select', pinned.id)"
      >
        <PageIcon
          :name="pinned.icon"
          :active="active === pinned.id || hot === pinned.id"
        /><small>{{ pinned.name }}</small>
      </button>
      <ReorderTransition class="library-page-list">
        <div
          v-for="item in entries"
          :key="item.id"
          class="library-page-row"
          :class="{ 'is-dragging': dragged === item.id }"
          v-account-drag :data-menu-row="item.id"
          :data-library-page-id="library ? item.id : undefined"
          :draggable="!disabled && !guestMode"
          @dragstart.stop="start($event, item.id)"
          @contextmenu.prevent.stop="emit('context', $event, item.id)"
        >
          <button
            class="side-menu-choice"
            :class="library ? 'library-page-choice' : 'workspace-space'"
            :aria-pressed="active === item.id"
            :aria-current="active === item.id ? 'page' : undefined"
            @mouseenter="hot = item.id"
            @mouseleave="hot = ''"
            @click="emit('select', item.id)"
          >
            <PageIcon
              :name="item.icon"
              :active="active === item.id || hot === item.id"
            /><small>{{ item.name }}</small>
          </button>
        </div>
      </ReorderTransition>
      <button
        class="side-menu-add"
        :class="library ? 'library-page-add' : 'workspace-space-add'"
        :aria-label="addLabel"
        v-account-edit :disabled="disabled"
        @mouseenter="hot = 'add'"
        @mouseleave="hot = ''"
        @click="emit('add')"
      >
        <PageIcon name="Add" :active="hot === 'add'" />
      </button>
    </nav>
  </div>
</template>
<style scoped>
.desktop-menu {
  position: fixed;
  z-index: 10;
  inset: 0 auto 0 0;
  width: 107px;
  padding: 0 5px 0 17px;
  display: flex;
  align-items: center;
  border-radius: 24px;
}
.desktop-menu > nav {
  --menu-row-gap: 6px;
  display: flex;
  flex-direction: column;
  gap: var(--menu-row-gap);
  width: 100%;
  padding: 10px 0;
  opacity: 0;
  transform: translateX(-100px);
  pointer-events: none;
  transition:
    opacity 300ms ease,
    transform 500ms cubic-bezier(0.22, 0.8, 0.22, 1);
}
.desktop-menu.is-hovered > nav {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}
.library-page-list {
  display: flex;
  flex-direction: column;
  gap: var(--menu-row-gap);
}
.desktop-menu > nav > * {
  flex-shrink: 0;
}
.library-page-list:empty {
  display: none;
}
.library-page-row {
  position: relative;
  border-radius: 14px;
  cursor: pointer;
}
.library-page-row.is-dragging {
  opacity: 0;
}
.side-menu-add {
  width: 100%;
  padding: 8px 3px;
  display: grid;
  place-items: center;
  color: inherit;
}
@media (max-width: 699px) {
  .desktop-menu {
    width: 54px;
    padding: 0 2px 0 6px;
  }
  /* The hidden menu must not cover the search controls near the left edge. */
  .desktop-menu:not(.is-hovered) {
    width: 12px;
    padding: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .desktop-menu > nav {
    transition: none;
  }
}
</style>
