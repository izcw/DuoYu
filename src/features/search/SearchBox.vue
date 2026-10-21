<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue';
import { browser } from 'wxt/browser';
import EngineSelector from './EngineSelector.vue';
import {
  getSearchEngine,
  getSearchUrl,
  isSearchEngineId,
  type SearchEngineId,
} from './engines';
import { useSearchSuggestions } from './useSearchSuggestions';

const query = ref('');
const engine = ref<SearchEngineId>('bing');
const currentEngine = computed(() => getSearchEngine(engine.value));
const wheelVisible = ref(false);
const searchError = ref('');
const opening = ref(false);
let engineChanged = false;
let saveEngine = Promise.resolve();
onMounted(async () => {
  input.value?.focus({ preventScroll: true });
  try {
    const saved = await browser.storage.local.get('searchEngine');
    if (!engineChanged && isSearchEngineId(saved.searchEngine))
      engine.value = saved.searchEngine;
  } catch {
    /* The default engine remains available if settings cannot be read. */
  }
});
function selectEngine(value: SearchEngineId) {
  engineChanged = true;
  engine.value = value;
  searchError.value = '';
  // Serialize rapid selections so the final choice also wins on disk.
  saveEngine = saveEngine
    .then(() => browser.storage.local.set({ searchEngine: value }))
    .catch(() => {});
}
const focused = ref(false);
const composing = ref(false);
const dismissed = ref(false);
const selected = ref<string | null>(null);
const input = useTemplateRef<HTMLInputElement>('input');
const form = useTemplateRef<HTMLFormElement>('form');
const { suggestions, related, loading, failed, cancel } = useSearchSuggestions(
  query,
  composing,
);
const options = computed(() => {
  const text = query.value.trim();
  return text
    ? [
        text,
        ...suggestions.value.filter(
          (item) => item.toLocaleLowerCase() !== text.toLocaleLowerCase(),
        ),
      ].slice(0, 10)
    : [];
});
const open = computed(
  () =>
    focused.value &&
    !wheelVisible.value &&
    !dismissed.value &&
    !composing.value &&
    options.value.length > 0,
);
const activeIndex = computed(() =>
  selected.value === null ? -1 : options.value.indexOf(selected.value),
);
const feedback = computed(() =>
  loading.value
    ? '正在获取建议…'
    : failed.value
      ? '联想暂不可用，仍可直接搜索'
      : options.value.length === 1
        ? '暂无更多建议，回车搜索完整内容'
        : '↑ ↓ 选择 · Enter 搜索 · Esc 收起',
);
let compositionTimer: ReturnType<typeof setTimeout> | undefined;
let justComposed = false;
watch(query, () => {
  selected.value = null;
  dismissed.value = false;
  searchError.value = '';
});
watch(options, (items) => {
  if (selected.value && !items.includes(selected.value)) selected.value = null;
});

async function search(text = query.value) {
  await openResult(getSearchUrl(engine.value, text), text);
}
async function translate() {
  const text = query.value.trim();
  const target = /\p{Script=Han}/u.test(text) ? 'en' : 'zh';
  const url = new URL('https://fanyi.baidu.com/mtpe-individual/multimodal');
  url.searchParams.set('query', text);
  url.searchParams.set('lang', `auto2${target}`);
  await openResult(url.toString(), text);
}
async function openResult(url: string, text: string) {
  if (composing.value || justComposed || !text.trim() || opening.value) return;
  cancel();
  dismissed.value = true;
  opening.value = true;
  searchError.value = '';
  try {
    await browser.tabs.create({ url });
  } catch {
    searchError.value = '未能打开搜索标签页，请重试。';
  } finally {
    opening.value = false;
  }
}
function submit() {
  search(open.value && selected.value !== null ? selected.value : query.value);
}
function clear() {
  query.value = '';
  selected.value = null;
  cancel();
  input.value?.focus();
}
function onFocusOut(event: FocusEvent) {
  if (
    event.relatedTarget instanceof Node &&
    form.value?.contains(event.relatedTarget)
  )
    return;
  focused.value = false;
  selected.value = null;
}
function endComposition() {
  composing.value = false;
  justComposed = true;
  clearTimeout(compositionTimer);
  compositionTimer = setTimeout(() => {
    justComposed = false;
  }, 0);
}
async function onKeydown(event: KeyboardEvent) {
  if (
    event.isComposing ||
    composing.value ||
    justComposed ||
    event.keyCode === 229
  ) {
    if (event.key === 'Enter') event.preventDefault();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    submit();
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    dismissed.value = true;
    selected.value = null;
  } else if (
    options.value.length &&
    (event.key === 'ArrowDown' || event.key === 'ArrowUp')
  ) {
    event.preventDefault();
    dismissed.value = false;
    const index =
      activeIndex.value === -1
        ? event.key === 'ArrowDown'
          ? 0
          : options.value.length - 1
        : (activeIndex.value +
            (event.key === 'ArrowDown' ? 1 : -1) +
            options.value.length) %
          options.value.length;
    selected.value = options.value[index] ?? null;
    await nextTick();
    form.value
      ?.querySelector(`#bing-suggestion-${index}`)
      ?.scrollIntoView({ block: 'nearest' });
  }
}
onUnmounted(() => clearTimeout(compositionTimer));
</script>

<template>
  <form
    ref="form"
    class="search-form"
    :class="{ 'wheel-visible': wheelVisible }"
    role="search"
    @submit.prevent="submit"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <div class="search-box liquid-glass" data-liquid-card>
      <EngineSelector
        :model-value="engine"
        @update:model-value="selectEngine"
        @visibility-change="wheelVisible = $event"
      />
      <input
        id="search-input"
        ref="input"
        v-model="query"
        role="combobox"
        :aria-label="`使用 ${currentEngine.name} 搜索`"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-controls="open ? 'bing-suggestions' : undefined"
        :aria-expanded="open"
        :aria-activedescendant="
          open && activeIndex >= 0
            ? `bing-suggestion-${activeIndex}`
            : undefined
        "
        placeholder="搜索，发现更多"
        autocomplete="off"
        autofocus
        autocapitalize="off"
        enterkeyhint="search"
        spellcheck="false"
        maxlength="2000"
        @focus="dismissed = false"
        @compositionstart="composing = true"
        @compositionend="endComposition"
        @keydown="onKeydown"
      />
      <button
        v-if="query"
        class="search-clear glass-control glass-interactive"
        type="button"
        aria-label="清空搜索"
        title="清空"
        @click="clear"
      >
        <img src="/images/close.png" alt="" />
      </button>
      <button
        type="submit"
        class="search-submit glass-control glass-interactive"
        aria-label="开始搜索"
        :title="`在新标签页使用 ${currentEngine.name} 搜索`"
        :disabled="!query.trim() || composing || opening"
        @click.prevent="search(query)"
      >
        <img class="search-action-icon" src="/images/search.png" alt="" />
      </button>
    </div>
    <div v-if="open" class="search-suggestions glass-surface">
      <button
        class="translation-option glass-control glass-interactive"
        type="button"
        :disabled="opening"
        :title="`使用百度翻译：${query.trim()}`"
        @click="translate"
      >
        <span class="translation-symbol" aria-hidden="true">译</span>
        <span>翻译「{{ query.trim() }}」</span>
        <small>百度翻译 ↗</small>
      </button>
      <ul
        id="bing-suggestions"
        class="suggestion-list"
        role="listbox"
        aria-label="Bing 搜索建议"
      >
        <li
          v-for="(suggestion, index) in options"
          :id="`bing-suggestion-${index}`"
          :key="suggestion"
          role="option"
          class="glass-control glass-interactive"
          tabindex="-1"
          :aria-selected="activeIndex === index"
          :class="{ active: activeIndex === index }"
          :title="suggestion"
          @mousedown.prevent
          @click="search(suggestion)"
        >
          <img src="/images/search.png" alt="" /><span>{{ suggestion }}</span>
          <small v-if="index === 0" class="suggestion-kind">搜索</small>
          <small v-else-if="related" class="suggestion-kind">相关</small>
        </li>
      </ul>
      <p class="search-feedback" role="status" aria-live="polite">
        {{ feedback }}<span v-if="engine !== 'bing'"> · 联想由 Bing 提供</span>
      </p>
    </div>
    <p v-if="searchError" class="search-feedback" role="alert">
      {{ searchError }}
    </p>
  </form>
</template>
