<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { pageIconGroups } from '../../page-icons';
import PageIcon from './PageIcon.vue';

const selected = defineModel<string>({ required: true });
const query = ref('');
const category = ref('');
const viewport = ref<HTMLElement>();
const cursor = ref(selected.value);
const groups = computed(() => {
  const term = query.value.trim().toLowerCase();
  return pageIconGroups
    .filter((group) => !category.value || group.name === category.value)
    .map((group) => ({
      name: group.name,
      icons: group.icons.filter((icon) =>
        (group.name + ' ' + icon.label + ' ' + icon.id.toLowerCase()).includes(
          term,
        ),
      ),
    }))
    .filter((group) => group.icons.length);
});
const ids = computed(() =>
  groups.value.flatMap((group) => group.icons.map((icon) => icon.id)),
);
const tabStop = computed(() =>
  ids.value.includes(cursor.value) ? cursor.value : ids.value[0],
);

watch([category, query], () => {
  if (viewport.value) viewport.value.scrollTop = 0;
});
onMounted(async () => {
  await nextTick();
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
function clearQuery(event: KeyboardEvent) {
  if (query.value) {
    event.preventDefault();
    event.stopPropagation();
    query.value = '';
  }
}
</script>
<template>
  <div class="page-icon-picker" role="group" aria-label="选择页面图标">
    <div class="filters">
      <div class="search">
        <PageIcon name="Search" :size="16" />
        <input
          v-model="query"
          type="search"
          aria-label="搜索图标"
          placeholder="搜索图标"
          @keydown.enter.prevent
          @keydown.esc="clearQuery"
        />
      </div>
      <select v-model="category" aria-label="图标分类">
        <option value="">全部分类</option>
        <option
          v-for="group in pageIconGroups"
          :key="group.name"
          :value="group.name"
        >
          {{ group.name }}
        </option>
      </select>
    </div>
    <div ref="viewport" class="icon-scroll" @keydown="navigate" @wheel.stop>
      <section
        v-for="group in groups"
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
            :tabindex="tabStop === icon.id ? 0 : -1"
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
      <p v-if="!groups.length" role="status">没有找到匹配的图标</p>
    </div>
  </div>
</template>
<style scoped>
.page-icon-picker {
  color: inherit;
  min-width: 0;
}
.filters {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.search,
select {
  background: rgb(255 255 255 / 9%);
  border: 1px solid rgb(255 255 255 / 20%);
  border-radius: 10px;
  color: inherit;
}
.search {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}
.search:focus-within,
select:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 1px;
}
.search input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 8px 0;
  outline: 0;
}
.search input::placeholder {
  color: inherit;
  opacity: 0.72;
}
select {
  font: inherit;
  font-size: 13px;
  padding: 0 6px;
}
option {
  background: #27303a;
  color: white;
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
p {
  margin: 36px 0;
  text-align: center;
  font-size: 13px;
}
@media (max-width: 420px) {
  .choices {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
</style>
