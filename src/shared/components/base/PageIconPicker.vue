<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { pageIconGroups, pageIcons } from '../../page-icons';
import { usePickerFold } from '../../usePickerFold';
import PageIcon from './PageIcon.vue';

const selected = defineModel<string>({ required: true });
const viewport = ref<HTMLElement>();
const scheduleFold = usePickerFold(viewport);
const cursor = ref(
  pageIcons.some((icon) => icon.id === selected.value)
    ? selected.value
    : pageIcons[0]?.id,
);
onMounted(() => {
  viewport.value
    ?.querySelector('[aria-pressed="true"]')
    ?.scrollIntoView({ block: 'nearest' });
});

function navigate(event: KeyboardEvent) {
  const target = event.target;
  if (
    !(target instanceof HTMLButtonElement) ||
    !target.dataset.choice ||
    !target.parentElement
  )
    return;
  const buttons = [
    ...viewport.value!.querySelectorAll<HTMLButtonElement>('[data-choice]'),
  ];
  const index = buttons.indexOf(target);
  let next: HTMLButtonElement | undefined;
  switch (event.key) {
    case 'Home':
      next = buttons[0];
      break;
    case 'End':
      next = buttons.at(-1);
      break;
    case 'ArrowLeft':
      next = buttons[index - 1];
      break;
    case 'ArrowRight':
      next = buttons[index + 1];
      break;
    case 'ArrowUp':
    case 'ArrowDown': {
      // Category boundaries can have a short final row. Follow the visual column.
      const originY = target.offsetTop,
        originX = target.offsetLeft;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let rowDistance = Infinity,
        columnDistance = Infinity;
      for (const button of buttons) {
        const dy = (button.offsetTop - originY) * direction;
        const dx = Math.abs(button.offsetLeft - originX);
        if (
          dy > 1 &&
          (dy < rowDistance || (dy === rowDistance && dx < columnDistance))
        ) {
          next = button;
          rowDistance = dy;
          columnDistance = dx;
        }
      }
      break;
    }
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  next?.focus();
}
</script>
<template>
  <div class="page-icon-picker" role="group" aria-label="选择页面图标">
    <div
      ref="viewport"
      class="icon-scroll"
      @scroll.passive="scheduleFold"
      @keydown="navigate"
      @wheel.stop
    >
      <section
        v-for="group in pageIconGroups"
        :key="group.name"
        :aria-label="group.name"
      >
        <h3>{{ group.name }}</h3>
        <div class="choices">
          <button
            v-for="icon in group.icons"
            :key="icon.id"
            type="button"
            :data-choice="icon.id"
            :title="icon.label"
            :aria-label="icon.label"
            :aria-pressed="selected === icon.id"
            :tabindex="cursor === icon.id ? 0 : -1"
            @focus="cursor = icon.id"
            @click="selected = icon.id"
          >
            <PageIcon
              :name="icon.id"
              :active="selected === icon.id"
              :size="25"
            />
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.page-icon-picker {
  color: #f2f2f2;
  background: #222;
  border-radius: 14px;
  overflow: hidden;
  min-width: 0;
}
.icon-scroll {
  position: relative;
  height: clamp(132px, 35svh, 304px);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 0 12px 10px;
  scroll-padding-block: 12px;
}
h3 {
  margin: 16px 0 7px;
  font-size: 12px;
  font-weight: 600;
  color: inherit;
  opacity: 0.8;
}
.choices {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
}
button {
  display: grid;
  place-items: center;
  padding: 0;
  height: 38px;
  min-width: 0;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  border-radius: 9px;
}
button:hover {
  background: rgb(255 255 255 / 12%);
}
button[aria-pressed='true'] {
  background: rgb(80 158 255 / 30%);
  box-shadow: inset 0 0 0 1px rgb(164 206 255 / 66%);
}
button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
@media (max-width: 420px) {
  .choices {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
</style>
