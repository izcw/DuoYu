import { shallowReactive } from 'vue';
import type { Memo } from '../../shared/storage/database';
import { memoSource } from './markdown';
import {
  checkpointMemo,
  clearMemoCheckpoint,
  type MemoCheckpoint,
} from './memo-recovery';

type Draft = MemoCheckpoint & { failed: boolean; storage?: Storage };
const writes = shallowReactive(new Map<string, Draft>());
// Keep the old live-query row readable while its replacement is in flight.
// Once the query replaces that row its overlay can be garbage collected.
const snapshots = new WeakMap<Memo, Draft>();
// IndexedDB transactions can be aborted when the renderer closes. Only copy
// outstanding writes synchronously at pagehide, never on the typing hot path.
window.addEventListener('pagehide', () => {
  for (const draft of writes.values()) draft.storage = checkpointMemo(draft);
});

export function readMemoDraft(note: Memo) {
  const pending = writes.get(note.id);
  if (pending) snapshots.set(note, pending);
  const local = pending ?? snapshots.get(note);
  return local ? local.source : memoSource(note.title, note.body, note.html);
}

export function memoNeedsRetry(id: string) {
  return writes.get(id)?.failed === true;
}

export async function writeMemoDraft(
  note: Memo,
  source: string,
  persist: (source: string) => Promise<boolean>,
) {
  let edit = writes.get(note.id);
  if (edit) {
    edit.source = source;
    snapshots.set(note, edit);
    if (edit.writing !== null) return;
  } else {
    const previous = snapshots.get(note);
    const base = previous
      ? { ...note, title: '', body: previous.source, html: undefined }
      : note;
    edit = shallowReactive<Draft>({
      operation: crypto.randomUUID(),
      base: { ...base },
      source,
      committed: null,
      writing: null,
      failed: false,
    });
    writes.set(note.id, edit);
  }
  snapshots.set(note, edit);
  // At most one transaction per note is in flight. A fast typist's latest
  // complete source supersedes intermediate edits while that write runs.
  edit.failed = false;
  do {
    const value = edit.source;
    edit.writing = value;
    const success = await persist(value);
    edit.writing = null;
    if (!success) {
      edit.failed = true;
      return;
    }
    edit.committed = value;
  } while (edit.source !== edit.committed);
  if (edit.storage) clearMemoCheckpoint(edit.storage, edit.operation);
  writes.delete(note.id);
}
