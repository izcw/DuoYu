<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { pageIconGroups, pageIcons } from '../../page-icons';
import PageIcon from './PageIcon.vue';

const selected = defineModel<string>({ required: true });
const viewport = ref<HTMLElement>();
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
      const origin = target.getBoundingClientRect();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      let rowDistance = Infinity,
        columnDistance = Infinity;
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        const dy = (rect.top - origin.top) * direction;
        const dx = Math.abs(rect.left - origin.left);
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
    <div ref="viewport" class="icon-scroll" @keydown="navigate" @wheel.stop>
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
            <span class="fold"
              ><PageIcon
                :name="icon.id"
                :active="selected === icon.id"
                :size="25"
            /></span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
<style scoped>
.page-icon-picker {
  color: inherit;
  min-width: 0;
}
.icon-scroll {
  height: clamp(120px, 30svh, 228px);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 0 5px;
  scroll-padding-block: 12px;
}
h3 {
  margin: 12px 0 5px;
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
.fold {
  display: grid;
  place-items: center;
}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .fold {
      animation: edge-fold linear both;
      animation-timeline: view(block);
    }
    @keyframes edge-fold {
      0% {
        transform: perspective(110px) rotateX(-65deg) scaleY(0.76);
        opacity: 0.45;
      }
      20%,
      80% {
        transform: perspective(110px) rotateX(0) scaleY(1);
        opacity: 1;
      }
      100% {
        transform: perspective(110px) rotateX(65deg) scaleY(0.76);
        opacity: 0.45;
      }
    }
  }
}
@media (max-width: 420px) {
  .choices {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
</style>
