<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
export interface RadialItem {
  id: string;
  name: string;
  icon: string;
}
const props = withDefaults(
  defineProps<{
    items: RadialItem[];
    open: boolean;
    center: { x: number; y: number };
    radius?: number;
    shape?: 'full' | 'half';
    selected?: string;
    label: string;
    centerVisible?: boolean;
    clearSelectionInCenter?: boolean;
    focusOwner?: string;
    interaction?: { clickButton: 0 | 2; holdButton: 0 | 2; dragButton: 0 | 2 };
  }>(),
  {
    radius: 112,
    shape: 'full',
    selected: '',
    centerVisible: false,
    clearSelectionInCenter: false,
    interaction: () => ({ clickButton: 0, holdButton: 0, dragButton: 0 }),
  },
);
const emit = defineEmits<{
  select: [id: string];
  reorder: [ids: string[]];
  close: [];
}>();
const root = ref<HTMLDivElement>();
const order = ref<RadialItem[]>([]);
const marked = ref('');
const markerAngle = ref(-90);
const failed = ref(new Set<string>());
const dragging = ref('');
const dragPoint = ref({ x: 0, y: 0 });
let drag:
  | { pointer: number; id: string; x: number; y: number; moved: boolean }
  | undefined;
let suppressClick = false;
const angleFor = (i: number) =>
  props.shape === 'full'
    ? -90 + (360 * i) / order.value.length
    : 246 - (132 * i) / Math.max(1, order.value.length - 1);
const size = computed(() =>
  Math.min(
    44,
    Math.max(
      20,
      2 *
        props.radius *
        Math.sin(
          Math.PI /
            (props.shape === 'full'
              ? order.value.length
              : Math.max(2, ((order.value.length - 1) * 360) / 132)),
        ) -
        10,
    ),
  ),
);
watch(
  () => props.items,
  (items) => {
    if (!drag) order.value = [...items];
  },
  { immediate: true, deep: true },
);
watch(
  () => props.open,
  (open) => {
    drag = undefined;
    dragging.value = '';
    order.value = [...props.items];
    if (open) {
      marked.value = '';
      if (props.selected) mark(props.selected);
    }
  },
);
function mark(id: string) {
  const index = order.value.findIndex((item) => item.id === id);
  if (index < 0) return;
  marked.value = id;
  const target = angleFor(index);
  markerAngle.value =
    props.shape === 'half'
      ? target
      : markerAngle.value +
        ((((target - markerAngle.value + 540) % 360) + 360) % 360) -
        180;
}
function nearest(x: number, y: number) {
  if (Math.hypot(x - props.center.x, y - props.center.y) <= 22) return '';
  let id = '';
  let best = Infinity;
  order.value.forEach((item, i) => {
    const angle = (angleFor(i) * Math.PI) / 180;
    const distance = Math.hypot(
      x - props.center.x - props.radius * Math.cos(angle),
      y - props.center.y - props.radius * Math.sin(angle),
    );
    if (distance < best) {
      best = distance;
      id = item.id;
    }
  });
  return id;
}
function preview(x: number, y: number) {
  const id = nearest(x, y);
  if (id) mark(id);
  else if (props.clearSelectionInCenter) marked.value = '';
  return id;
}
function selectAt(x: number, y: number) {
  const id = nearest(x, y);
  if (id) emit('select', id);
  else emit('close');
}
function start(event: PointerEvent, item: RadialItem) {
  if (event.button !== props.interaction.dragButton || !event.isPrimary) return;
  event.preventDefault();
  suppressClick = false;
  drag = {
    pointer: event.pointerId,
    id: item.id,
    x: event.clientX,
    y: event.clientY,
    moved: false,
  };
}
function move(event: PointerEvent) {
  if (!props.open) return;
  if (!drag) {
    preview(event.clientX, event.clientY);
    return;
  }
  if (event.pointerId !== drag.pointer) return;
  if (
    !drag.moved &&
    Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6
  )
    return;
  drag.moved = true;
  dragging.value = drag.id;
  dragPoint.value = {
    x: event.clientX - props.center.x,
    y: event.clientY - props.center.y,
  };
  const target = nearest(event.clientX, event.clientY);
  if (target && target !== drag.id) {
    const from = order.value.findIndex((item) => item.id === drag!.id);
    const to = order.value.findIndex((item) => item.id === target);
    const [item] = order.value.splice(from, 1);
    order.value.splice(to, 0, item!);
  }
  mark(drag.id);
}
function up(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return;
  const finished = drag;
  drag = undefined;
  dragging.value = '';
  suppressClick = true;
  if (finished.moved)
    emit(
      'reorder',
      order.value.map((item) => item.id),
    );
  else emit('select', finished.id);
}
function cancel() {
  drag = undefined;
  dragging.value = '';
  order.value = [...props.items];
}
function click(event: MouseEvent, id: string) {
  if (suppressClick && event.detail !== 0) {
    suppressClick = false;
    return;
  }
  if (event.detail === 0 || event.button === props.interaction.clickButton)
    emit('select', id);
}
async function key(event: KeyboardEvent, index: number) {
  if (event.key === 'Escape') {
    emit('close');
    return;
  }
  const delta = ['ArrowRight', 'ArrowDown'].includes(event.key)
    ? 1
    : ['ArrowLeft', 'ArrowUp'].includes(event.key)
      ? -1
      : 0;
  if (!delta && !['Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const to =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? order.value.length - 1
        : (index + delta + order.value.length) % order.value.length;
  if (event.altKey) {
    const [item] = order.value.splice(index, 1);
    order.value.splice(to, 0, item!);
    emit(
      'reorder',
      order.value.map((item) => item.id),
    );
  }
  await nextTick();
  root.value
    ?.querySelectorAll<HTMLButtonElement>('.radial-choice')
    [to]?.focus();
}
function selectMarked() {
  if (props.open && marked.value) {
    emit('select', marked.value);
    return true;
  }
  return false;
}
function lostFocus(event: FocusEvent) {
  if (!props.open) return;
  const target = event.target;
  if (
    target instanceof Element &&
    (root.value?.contains(target) ||
      (props.focusOwner && target.closest(props.focusOwner)))
  )
    return;
  emit('close');
}
function visibilityChanged() {
  if (document.hidden && props.open) emit('close');
}
function windowBlur() {
  cancel();
  if (props.open) emit('close');
}
function focusFirst() {
  root.value?.querySelector<HTMLButtonElement>('.radial-choice')?.focus();
}
defineExpose({
  preview,
  selectAt,
  selectMarked,
  focusFirst,
  interaction: computed(() => props.interaction),
});
onMounted(() => {
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', windowBlur);
  document.addEventListener('focusin', lostFocus);
  document.addEventListener('visibilitychange', visibilityChanged);
});
onUnmounted(() => {
  document.removeEventListener('pointermove', move);
  document.removeEventListener('pointerup', up);
  document.removeEventListener('pointercancel', cancel);
  window.removeEventListener('blur', windowBlur);
  document.removeEventListener('focusin', lostFocus);
  document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>
<template>
  <div
    ref="root"
    class="radial-wheel"
    :class="{ 'is-open': open }"
    :style="{
      left: `${center.x}px`,
      top: `${center.y}px`,
      '--radius': `${radius}px`,
      '--size': `${size}px`,
    }"
    :inert="!open"
    :aria-hidden="!open"
    role="menu"
    :aria-label="label"
    @contextmenu.prevent
  >
    <button
      v-if="centerVisible"
      type="button"
      class="radial-center glass-surface glass-interactive"
      aria-label="关闭轮盘"
      @click="emit('close')"
    />
    <div
      v-for="(item, index) in order"
      :key="item.id"
      class="radial-orbit"
      :style="{ '--angle': `${angleFor(index)}deg` }"
    >
      <button
        type="button"
        class="radial-choice glass-surface glass-interactive"
        :class="{
          'is-dragging': dragging === item.id,
          'is-marked': marked === item.id,
        }"
        :data-item="item.id"
        :aria-label="item.name"
        :title="`${item.name} · 拖拽排序`"
        :role="selected && item.id !== 'add' ? 'menuitemradio' : 'menuitem'"
        :aria-checked="
          selected && item.id !== 'add' ? selected === item.id : undefined
        "
        :tabindex="open ? 0 : -1"
        @pointerdown="start($event, item)"
        @click="click($event, item.id)"
        @focus="mark(item.id)"
        @keydown="key($event, index)"
      >
        <img
          v-if="!failed.has(item.id)"
          :src="item.icon"
          alt=""
          draggable="false"
          @error="failed.add(item.id)"
        /><span v-else>{{ item.name.slice(0, 1) }}</span>
      </button>
    </div>
    <div
      class="radial-marker"
      :data-target="marked"
      :style="{
        transform: `rotate(${markerAngle}deg)`,
        opacity: open && marked ? 1 : 0,
      }"
    >
      <span />
    </div>
    <div
      v-if="dragging"
      class="radial-drag glass-surface"
      :style="{ transform: `translate(${dragPoint.x}px,${dragPoint.y}px)` }"
    >
      <img :src="order.find((item) => item.id === dragging)?.icon" alt="" />
    </div>
  </div>
</template>
<style scoped>
.radial-wheel {
  position: fixed;
  z-index: 2147483000;
  width: 0;
  height: 0;
  touch-action: none;
  user-select: none;
  visibility: hidden;
  transition: visibility 0s 220ms;
}
.radial-wheel.is-open {
  visibility: visible;
  transition-delay: 0s;
}
.radial-center {
  position: absolute;
  left: -22px;
  top: -22px;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms;
}
.is-open .radial-center {
  opacity: 1;
}
.radial-orbit {
  position: absolute;
  inset: 0;
  transform: rotate(calc(var(--angle) + 90deg));
  opacity: 0;
  transition:
    transform 220ms ease,
    opacity 180ms ease;
  pointer-events: none;
}
.radial-choice {
  position: absolute;
  left: calc(var(--size) / -2);
  top: calc(var(--size) / -2);
  width: var(--size);
  height: var(--size);
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #252525;
  cursor: pointer;
  pointer-events: none;
  transform: translateX(var(--radius)) rotate(calc(-1 * var(--angle) - 90deg));
  transition:
    transform 220ms ease,
    background 120ms;
  padding: 9px;
  touch-action: none;
}
.radial-choice img,
.radial-drag img {
  width: 23px;
  height: 23px;
  max-width: 100%;
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  object-fit: contain;
  pointer-events: none;
}
.is-open .radial-orbit {
  transform: rotate(var(--angle));
  opacity: 1;
  transition-duration: 150ms;
}
.is-open .radial-choice {
  pointer-events: auto;
  transform: translateX(var(--radius)) rotate(calc(-1 * var(--angle)));
  transition-duration: 150ms;
}
.is-open .radial-choice:hover,
.is-open .radial-choice.is-marked {
  transform: translateX(var(--radius)) rotate(calc(-1 * var(--angle)))
    scale(1.1);
}
.radial-marker {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition:
    transform 150ms ease,
    opacity 110ms;
}
.radial-marker span {
  position: absolute;
  left: calc(var(--radius) - 35px);
  top: -3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px #0002;
}
.radial-choice.is-dragging {
  opacity: 0.25;
}
.radial-drag {
  position: absolute;
  left: -22px;
  top: -22px;
  width: 44px;
  height: 44px;
  padding: 9px;
  border-radius: 50%;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .radial-wheel,
  .radial-wheel * {
    transition: none !important;
  }
}
</style>
