<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const now = ref(new Date());
const pad = (value: number) => String(value).padStart(2, '0');
const time = computed(
  () =>
    `${pad(now.value.getHours())}:${pad(now.value.getMinutes())}:${pad(now.value.getSeconds())}`,
);
const date = computed(
  () =>
    `${pad(now.value.getMonth() + 1)}月${pad(now.value.getDate())}日  星期${'日一二三四五六'[now.value.getDay()]}`,
);
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  month: 'long',
  day: 'numeric',
});
const lunarDays = [
  '初一',
  '初二',
  '初三',
  '初四',
  '初五',
  '初六',
  '初七',
  '初八',
  '初九',
  '初十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '廿一',
  '廿二',
  '廿三',
  '廿四',
  '廿五',
  '廿六',
  '廿七',
  '廿八',
  '廿九',
  '三十',
];
const lunarDate = computed(() => {
  const parts = lunarFormatter.formatToParts(now.value);
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return `${month}${lunarDays[day - 1] ?? ''}`;
});
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 1000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="clock">
    <time class="clock-time">{{ time }}</time>
    <p class="clock-date">
      <span>{{ date }}</span>
      <span class="clock-lunar">农历{{ lunarDate }}</span>
    </p>
  </div>
</template>
