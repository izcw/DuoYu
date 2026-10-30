<script setup lang="ts">
import { computed } from 'vue';
import { hasChinese, limitIconText } from '../../icon-text';
const props = defineProps<{
  text?: string;
  editing?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}>();
const emit = defineEmits<{ caret: [offset: number, extend: boolean] }>();
function offset(row: number, position: number) {
  return characters.value
    .slice(0, (row ? rows.value[0]!.length : 0) + position)
    .join('').length;
}
function place(event: MouseEvent, row: number, position: number) {
  if (!props.editing) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  emit(
    'caret',
    offset(row, position) +
      (event.clientX >= rect.left + rect.width / 2
        ? characters.value[(row ? rows.value[0]!.length : 0) + position]!.length
        : 0),
    event.shiftKey,
  );
}
function caretClass(row: number, position: number) {
  if (!props.editing || props.selectionStart !== props.selectionEnd) return '';
  const start = offset(row, position);
  if (props.selectionStart === start) return 'caret-before';
  if (
    props.selectionStart === (props.text || '').length &&
    row === rows.value.length - 1 &&
    position === rows.value[row]!.length - 1
  )
    return 'caret-after';
  return '';
}
const characters = computed(() =>
  Array.from(limitIconText(props.text || (props.editing ? '' : '文'))),
);
const rows = computed(() => {
  const chars = characters.value;
  if (!hasChinese(chars.join(''))) {
    return chars.length <= 5 ? [chars] : [chars.slice(0, 5), chars.slice(5)];
  }
  if (chars.length <= 3) return [chars];
  const split = chars.length === 4 ? 2 : 3;
  return [chars.slice(0, split), chars.slice(split)];
});
function selected(row: number, position: number) {
  const index = (row ? rows.value[0]!.length : 0) + position;
  const start = characters.value.slice(0, index).join('').length;
  const end = start + characters.value[index]!.length;
  return (
    props.editing &&
    start < (props.selectionEnd ?? 0) &&
    end > (props.selectionStart ?? 0)
  );
}
const fontSize = computed(() => {
  const count = characters.value.length;
  return (
    (hasChinese(characters.value.join(''))
      ? [54, 54, 34, 24, 29, 23, 23][count]
      : [54, 54, 40, 32, 25, 21][Math.min(count, 5)]) + 'cqw'
  );
});
</script>
<template>
  <span
    class="text-icon"
    :class="{ editing, selecting: editing && selectionStart !== selectionEnd }"
  >
    <span class="text-icon-lines" :style="{ fontSize }">
      <span v-for="(row, index) in rows" :key="index" class="text-icon-row">
        <span
          v-if="editing && !row.length"
          class="caret-before"
          aria-hidden="true"
          >&#8203;</span
        >
        <span
          v-for="(character, position) in row"
          :key="position"
          :class="[
            { 'selected-character': selected(index, position) },
            caretClass(index, position),
          ]"
          @mousedown="place($event, index, position)"
          @click="editing && $event.stopPropagation()"
          >{{ character }}</span
        >
      </span>
    </span>
  </span>
</template>
<style scoped>
.text-icon {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.text-icon-lines {
  width: max-content;
  max-width: 84%;
  display: flex;
  flex-direction: column;
  gap: 0.08em;
  line-height: 1.1;
  font-weight: 600;
}
.text-icon-row {
  display: flex;
  justify-content: center;
  gap: 0.06em;
  white-space: nowrap;
}
.text-icon-row:has(> :only-child) {
  justify-content: center;
}
</style>

<style scoped>
.text-icon-row:last-child:not(:first-child) {
  justify-content: space-between;
}
</style>

<style scoped>
.editing .text-icon-row > span {
  position: relative;
  cursor: text;
  user-select: none;
}
.caret-before::before,
.caret-after::after {
  content: '';
  position: absolute;
  top: 0.05em;
  height: 0.95em;
  border-left: 1px solid currentColor;
  animation: text-caret 1s steps(1) infinite;
}
.caret-before::before {
  left: -0.04em;
}
.caret-after::after {
  right: -0.04em;
}
@keyframes text-caret {
  50% {
    opacity: 0;
  }
}
.selected-character {
  background: #2478e8;
  color: #fff;
}
@media (prefers-reduced-motion: reduce) {
  .caret-before::before,
  .caret-after::after {
    animation: none;
  }
}
</style>
