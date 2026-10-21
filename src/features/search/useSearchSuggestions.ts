import { onUnmounted, ref, watch, type Ref } from 'vue';
import { getCachedResult, resolveSuggestions } from './bing';

export function useSearchSuggestions(
  query: Ref<string>,
  composing: Ref<boolean>,
) {
  const suggestions = ref<string[]>([]);
  const related = ref(false);
  const loading = ref(false);
  const failed = ref(false);
  let controller: AbortController | undefined;
  let revision = 0;
  function cancel() {
    revision++;
    controller?.abort();
    loading.value = false;
  }
  watch([query, composing], async () => {
    cancel();
    const currentRevision = revision;
    const text = query.value.trim();
    failed.value = false;
    related.value = false;
    if (!text || composing.value) {
      suggestions.value = [];
      return;
    }
    const cached = getCachedResult(text);
    if (cached) {
      suggestions.value = cached.items;
      related.value = cached.related;
      return;
    }
    suggestions.value = suggestions.value.filter((item) =>
      item.toLocaleLowerCase().startsWith(text.toLocaleLowerCase()),
    );
    const request = new AbortController();
    controller = request;
    loading.value = true;
    try {
      const result = await resolveSuggestions(text, request.signal);
      if (revision !== currentRevision || request.signal.aborted) return;
      suggestions.value = result.items;
      related.value = result.related;
    } catch {
      if (revision === currentRevision && !request.signal.aborted)
        failed.value = true;
    } finally {
      if (revision === currentRevision) loading.value = false;
    }
  });
  onUnmounted(cancel);
  return { suggestions, related, loading, failed, cancel };
}
