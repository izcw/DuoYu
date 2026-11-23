<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { liveQuery } from 'dexie';
import { database, type Memo } from '../../shared/storage/database';
import { guestMode } from '../../shared/storage/account';
import { syncState } from '../sync/client';
import { requireAccount } from '../auth/edit-access';
import DesktopMenu from '../../shared/components/base/DesktopMenu.vue';
import PageIcon from '../../shared/components/base/PageIcon.vue';
import MenuEditorDialog from '../../shared/components/base/MenuEditorDialog.vue';
import ReorderTransition from '../../shared/components/base/ReorderTransition.vue';
import { createDragLanding } from '../../shared/drag-landing';
import BaseDialog from '../../shared/components/base/BaseDialog.vue';
import Archive from '@icon-park/vue-next/es/icons/FolderDownload';
import Search from '@icon-park/vue-next/es/icons/Search';
import NotesIcon from '@icon-park/vue-next/es/icons/Notes';
import { minZoom, useMemoCanvas } from './useMemoCanvas';
import MemoOverview from './MemoOverview.vue';
import MemoCard from './MemoCard.vue';
import { memoSearchText } from './markdown';
import {
  archiveMemos,
  readMemoView,
  bringToFront,
  createMemo,
  memoColors,
  reorderArchive,
  updateMemo,
} from './memos';
import '../../shared/side-menu.css';
import './memo.css';

const views = [
  { id: 'wall', name: '便签墙', icon: 'Notes' },
  { id: 'archive', name: '归档', icon: 'Folder' },
] as const;
const view = ref('wall');
const pages = ref<import('../../shared/storage/database').MemoPage[]>([]);
const pageForm = ref(false);
const pageEditing = ref('');
const pageName = ref('');
const pageIcon = ref('Notes');
const pageBusy = ref(false);
const pageError = ref('');
const activeMenu = computed(() =>
  [...views, ...pages.value].find((item) => item.id === view.value),
);
const pageSubscription = liveQuery(() =>
  database.memoPages.orderBy('order').toArray(),
).subscribe({
  next: (value) => {
    pages.value = value;
  },
  error: () => {
    error.value = '便签菜单读取失败';
  },
});
function editPage(id = '') {
  if (!requireAccount()) return;
  const page = pages.value.find((item) => item.id === id);
  pageName.value = page?.name ?? '';
  pageIcon.value = page?.icon ?? 'Notes';
  pageEditing.value = id;
  pageError.value = '';
  pageForm.value = true;
}
async function savePage() {
  const name = pageName.value.trim();
  if (!name || pageBusy.value || !requireAccount()) return;
  pageBusy.value = true;
  try {
    const id = pageEditing.value || crypto.randomUUID();
    await database.transaction('rw', database.memoPages, async () => {
      if (pageEditing.value)
        await database.memoPages.update(id, { name, icon: pageIcon.value });
      else {
        const last = await database.memoPages.orderBy('order').last();
        await database.memoPages.add({
          id,
          name,
          icon: pageIcon.value,
          order: (last?.order ?? -1) + 1,
        });
      }
    });
    changeView(id);
    pageForm.value = false;
  } catch (e) {
    pageError.value = e instanceof Error ? e.message : '菜单保存失败';
  } finally {
    pageBusy.value = false;
  }
}
function sortPages(ids: string[]) {
  void run(() =>
    database.transaction('rw', database.memoPages, () =>
      Promise.all(
        ids.map((id, order) => database.memoPages.update(id, { order })),
      ),
    ),
  );
}
const dates = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const visibleNotes = shallowRef<Memo[]>([]);
const loaded = ref(false);
const query = ref('');
const pending = ref(false);
const queueSubscription = guestMode
  ? undefined
  : liveQuery(() => database.syncOutbox.count()).subscribe((count) => {
      pending.value = count > 0;
    });
const syncLabel = computed(() => {
  if (guestMode) return '访客只读';
  const { status } = syncState.value;
  if (status === '正在同步') return status;
  if (pending.value || status === '待同步' || status === '有更改待处理')
    return '';
  return status === '未登录' ? '等待同步' : status;
});
const searchField = ref<HTMLInputElement>();
const searchResults = ref<HTMLElement>();
const needle = computed(() => query.value.trim().toLowerCase());
const searchEntries = computed(() =>
  visibleNotes.value.map((note) => {
    const text = note.html ? note.body : memoSearchText(note.body);
    const heading = note.title || text.split('\n', 1)[0] || '空白便签';
    return { note, text, heading, lowercase: text.toLowerCase() };
  }),
);
const matches = computed(() =>
  searchEntries.value.flatMap(({ note, text, heading, lowercase }) => {
    const index = lowercase.indexOf(needle.value);
    if (index < 0 && !heading.toLowerCase().includes(needle.value)) return [];
    const start = Math.max(0, index - 20);
    const snippet =
      heading === text && !start
        ? ''
        : (start ? '…' : '') + text.slice(start, start + 120);
    return [{ note, heading, snippet }];
  }),
);
const viewport = ref<HTMLElement>();
const menuEl = ref<HTMLElement>();
const canvas = useMemoCanvas(view, viewport, visibleNotes);
const { ids, camera, spaceHeld, rectangle } = canvas;
const gridStep = computed(() => {
  const spacing = 24 * camera.value.scale;
  return spacing * 2 ** Math.ceil(Math.log2(16 / spacing));
});
const distantView = computed(
  () => view.value !== 'archive' && camera.value.scale < minZoom,
);
const deleting = ref<string[]>();
const selectedIds = computed(() =>
  visibleNotes.value
    .filter((note) => ids.value.has(note.id))
    .map((note) => note.id),
);
const error = ref('');
const cardRefs = new Map<string, InstanceType<typeof MemoCard>>();
watch(
  view,
  (page, _, cleanup) => {
    visibleNotes.value = [];
    loaded.value = false;
    const subscription = liveQuery(() => readMemoView(page)).subscribe({
      next(value) {
        visibleNotes.value = value;
        loaded.value = true;
      },
      error() {
        error.value = '便签读取失败';
      },
    });
    cleanup(() => subscription.unsubscribe());
  },
  { immediate: true, flush: 'sync' },
);
async function run(action: () => Promise<unknown>) {
  if (!requireAccount()) return false;
  try {
    error.value = '';
    await action();
    return true;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '便签保存失败';
    return false;
  }
}
const menu = ref<{
  id?: string;
  left: number;
  top: number;
  x: number;
  y: number;
}>();
const selected = computed(() =>
  visibleNotes.value.find((note) => note.id === menu.value?.id),
);
function openMenu(event: MouseEvent, note?: Memo) {
  if (!viewport.value || (view.value === 'archive' && !note)) return;
  if (note && !ids.value.has(note.id)) ids.value = new Set([note.id]);
  if (!note) ids.value = new Set();
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const left =
    event.detail === 0 && event.type === 'click' ? anchor.left : event.clientX;
  const top =
    event.detail === 0 && event.type === 'click'
      ? anchor.bottom
      : event.clientY;
  menu.value = {
    id: note?.id,
    left,
    top,
    ...canvas.world(canvas.local({ clientX: left, clientY: top })),
  };
  void nextTick(() => {
    if (!menu.value || !menuEl.value) return;
    const panel = menuEl.value.getBoundingClientRect();
    menu.value.left = Math.max(6, Math.min(left, innerWidth - panel.width - 6));
    menu.value.top = Math.max(6, Math.min(top, innerHeight - panel.height - 6));
    menuEl.value.querySelector('button')?.focus({ preventScroll: true });
  });
}
function closeOutside(event: PointerEvent) {
  if (!menuEl.value?.contains(event.target as Node)) menu.value = undefined;
}
function menuKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    const card = menu.value?.id && cardRefs.get(menu.value.id);
    const origin = card
      ? (card.$el.querySelector('.memo-options') ?? card.$el)
      : viewport.value;
    menu.value = undefined;
    origin?.focus({ preventScroll: true });
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key))
    return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = Array.from(menuEl.value?.querySelectorAll('button') ?? []);
  const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[
    (from +
      (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) +
      buttons.length) %
      buttons.length
  ]?.focus();
}
let pendingFocus = '';
async function add() {
  const space = viewport.value;
  const point = menu.value;
  if (!space || !point) return;
  menu.value = undefined;
  const width = Math.max(180, Math.min(264, space.clientWidth - 20));
  const edge = canvas.world({ x: space.clientWidth, y: space.clientHeight });
  const origin = canvas.world({ x: 0, y: 0 });
  const x = Math.max(origin.x, Math.min(point.x, edge.x - width));
  const y = Math.max(origin.y, Math.min(point.y, edge.y - 212));
  const page = view.value;
  ids.value = new Set();
  await run(async () => {
    pendingFocus = await createMemo(x, y, width, page);
    await nextTick();
    focusNew();
  });
}
async function focusNew() {
  if (!pendingFocus) return;
  const note = visibleNotes.value.find((item) => item.id === pendingFocus);
  if (!note) return;
  pendingFocus = '';
  if (distantView.value || !cardRefs.has(note.id)) {
    canvas.revealNote(note);
    await nextTick();
  }
  cardRefs.get(note.id)?.focusBody();
}
watch(visibleNotes, () => nextTick(focusNew));
async function locate(note: Memo) {
  query.value = '';
  ids.value = new Set([note.id]);
  await nextTick();
  if (view.value === 'archive') {
    cardRefs.get(note.id)?.$el.scrollIntoView({ block: 'nearest' });
  } else {
    canvas.revealNote(note);
  }
  viewport.value?.focus({ preventScroll: true });
}
function searchKeys(event: KeyboardEvent, index = -1) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;
  const key = event.key;
  if (key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (index >= 0) searchField.value?.focus();
    else if (query.value) query.value = '';
    else viewport.value?.focus({ preventScroll: true });
    return;
  }
  if (!needle.value || !matches.value.length) return;
  if (index === -1 && key === 'Enter') {
    event.preventDefault();
    void locate(matches.value[0]!.note);
    return;
  }
  const count = matches.value.length;
  let next: number;
  if (key === 'ArrowDown') next = (index + 1) % count;
  else if (key === 'ArrowUp') next = index <= 0 ? count - 1 : index - 1;
  else if (index >= 0 && key === 'Home') next = 0;
  else if (index >= 0 && key === 'End') next = count - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  searchResults.value?.getElementsByTagName('button').item(next)?.focus();
}
function changeColor(color: Memo['color']) {
  const targets = selectedIds.value;
  menu.value = undefined;
  void run(() =>
    database.memos
      .where('id')
      .anyOf(targets)
      .modify({ color, updatedAt: Date.now() }),
  );
}
function archive() {
  const targets = selectedIds.value;
  const toArchive = view.value !== 'archive';
  menu.value = undefined;
  void run(() => archiveMemos(targets, toArchive));
}
function askDelete() {
  menu.value = undefined;
  if (selectedIds.value.length && requireAccount())
    deleting.value = [...selectedIds.value];
}
function confirmDelete() {
  const targets = deleting.value;
  if (targets)
    void run(async () => {
      await database.memos.bulkDelete(targets);
      deleting.value = undefined;
    });
}

type Gesture = {
  id: string;
  pointer: number;
  action: 'move' | 'resize' | 'sort';
  startX: number;
  startY: number;
  origin: Pick<Memo, 'x' | 'y' | 'width' | 'height'>;
  moved: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  members: Set<string>;
  target: string;
  after: boolean;
};
const drag = ref<Gesture>();
const viewportSize = ref({ width: 0, height: 0 });
watch(viewport, (el, _, cleanup) => {
  if (!el) return;
  const measure = () => {
    const old = viewportSize.value;
    const size = { width: el.clientWidth, height: el.clientHeight };
    viewportSize.value = size;
    if (
      view.value === 'archive' ||
      !old.width ||
      !size.width ||
      (size.width >= old.width && size.height >= old.height)
    )
      return;
    const { x, y, scale } = camera.value;
    const inside = (n: Memo, area: typeof size) =>
      (n.x + n.width) * scale + x > 0 &&
      n.x * scale + x < area.width &&
      (n.y + n.height) * scale + y > 0 &&
      n.y * scale + y < area.height;
    const only =
      visibleNotes.value.length === 1 ? visibleNotes.value[0] : undefined;
    if (
      only &&
      inside(only, old) &&
      (only.width * scale > size.width - 16 ||
        only.height * scale > size.height - 16)
    ) {
      canvas.revealNote(only);
      return;
    }
    if (visibleNotes.value.some((n) => inside(n, size))) return;
    const note = visibleNotes.value.find((n) => inside(n, old));
    if (note) canvas.revealNote(note);
  };
  const observer = new ResizeObserver(measure);
  observer.observe(el);
  measure();
  cleanup(() => observer.disconnect());
});
const focusedNote = ref('');
const landing = createDragLanding();
let slots: { id: string; rect: DOMRect }[] = [];
let scrollY = 0;
const displayedNotes = computed(() => {
  const d = drag.value;
  const notes = visibleNotes.value;
  if (view.value !== 'archive') {
    const { x, y, scale } = camera.value;
    const { width, height } = viewportSize.value;
    const pad = 120;
    return notes.filter(
      (n) =>
        n.id === focusedNote.value ||
        d?.members.has(n.id) ||
        ((n.x + n.width) * scale + x >= -pad &&
          n.x * scale + x <= width + pad &&
          (n.y + n.height) * scale + y >= -pad &&
          n.y * scale + y <= height + pad),
    );
  }
  if (d?.action !== 'sort' || !d.target) return notes;
  const moved = notes.find((n) => n.id === d.id);
  const rest = notes.filter((n) => n.id !== d.id);
  const index = rest.findIndex((n) => n.id === d.target);
  if (!moved || index < 0) return notes;
  rest.splice(index + Number(d.after), 0, moved);
  return rest;
});
function cancelDrag() {
  canvas.cancel();
  if (landing.committing) return;
  drag.value = undefined;
  landing.dispose();
}
function cancelKey(event: KeyboardEvent) {
  const target = event.target as Element | null;
  if (event.isComposing || event.keyCode === 229) return;
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'f' &&
    !document.querySelector('dialog[open],.base-dialog-backdrop') &&
    !menu.value
  ) {
    event.preventDefault();
    searchField.value?.focus();
    searchField.value?.select();
    return;
  }
  if (
    pageForm.value ||
    deleting.value ||
    menu.value ||
    document.querySelector('dialog[open],.base-dialog-backdrop') ||
    target?.closest(
      'input,textarea,select,[contenteditable="true"],[role="menu"],.memo-results',
    )
  )
    return;
  if (
    event.code === 'Space' &&
    view.value !== 'archive' &&
    !target?.closest('button')
  ) {
    event.preventDefault();
    spaceHeld.value = true;
  } else if (
    event.key === 'Escape' &&
    (drag.value || canvas.gesture.value || selectedIds.value.length)
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (drag.value || canvas.gesture.value) cancelDrag();
    else ids.value = new Set();
  } else if (
    ['Delete', 'Backspace'].includes(event.key) &&
    selectedIds.value.length
  ) {
    event.preventDefault();
    askDelete();
  }
}
function releaseSpace(event: KeyboardEvent) {
  if (event.code === 'Space') spaceHeld.value = false;
}
function blurWindow() {
  spaceHeld.value = false;
  cancelDrag();
}
function cardPress(event: PointerEvent, note: Memo) {
  if (event.button !== 0 || !event.isPrimary) return;
  const el = event.target as Element;
  if (el.matches('.memo-distant-card')) return;
  if (
    (event.shiftKey || event.metaKey || event.ctrlKey) &&
    !el.closest('button, a[href], textarea, [contenteditable=true]') &&
    document.activeElement !== el
  ) {
    const next = new Set(ids.value);
    if (!next.delete(note.id)) next.add(note.id);
    ids.value = next;
    event.preventDefault();
    event.stopPropagation();
    viewport.value?.focus({ preventScroll: true });
    return;
  }
  if (!ids.value.has(note.id)) ids.value = new Set([note.id]);
  if (view.value === 'archive') return;
  if (
    ids.value.size > 1 &&
    !el.closest(
      'button, a[href], .memo-resize, input, textarea, [contenteditable=true]',
    )
  ) {
    event.stopPropagation();
    start(event, note, 'move');
  } else if (!guestMode) void run(() => bringToFront(note.id));
}
function wheel(event: WheelEvent) {
  if (view.value === 'archive' || drag.value || canvas.gesture.value) return;
  if (
    !event.ctrlKey &&
    (event.target as Element).closest('.memo-text:focus-within')
  )
    return;
  event.preventDefault();
  const pixels =
    event.deltaY *
    (event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? viewport.value!.clientHeight
        : 1);
  canvas.zoom(
    camera.value.scale * Math.exp(-pixels * 0.002),
    canvas.local(event),
  );
}
function start(event: PointerEvent, note: Memo, action: Gesture['action']) {
  const space = viewport.value;
  if (
    !space ||
    event.button !== 0 ||
    !event.isPrimary ||
    drag.value ||
    landing.committing ||
    (event.target as Element).closest(
      'input, textarea, button, a[href], [contenteditable=true]',
    ) ||
    !requireAccount()
  )
    return;
  event.preventDefault();
  menu.value = undefined;
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
  const { x, y, width, height } = note;
  drag.value = {
    id: note.id,
    pointer: event.pointerId,
    action,
    origin: { x, y, width, height },
    x,
    y,
    width,
    height,
    startX: event.clientX + space.scrollLeft,
    startY: event.clientY + space.scrollTop,
    moved: false,
    members: new Set(action === 'move' ? selectedIds.value : [note.id]),
    target: '',
    after: false,
  };
  if (action === 'sort') {
    scrollY = space.scrollTop;
    slots = Array.from(
      space.querySelectorAll<HTMLElement>('[data-memo-id]'),
      (el) => ({ id: el.dataset.memoId!, rect: el.getBoundingClientRect() }),
    );
  }
  space.setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (canvas.gesture.value) return canvas.move(event);
  const d = drag.value,
    space = viewport.value;
  if (!d || !space || event.pointerId !== d.pointer) return;
  const dx = event.clientX + space.scrollLeft - d.startX,
    dy = event.clientY + space.scrollTop - d.startY;
  if (!d.moved && Math.hypot(dx, dy) < 3) return;
  if (!d.moved && d.action === 'sort') {
    const selector = '[data-memo-id="' + CSS.escape(d.id) + '"]';
    const source = space.querySelector<HTMLElement>(selector);
    if (!source) return cancelDrag();
    landing.capture(
      new MouseEvent('mousedown', {
        clientX: d.startX - space.scrollLeft,
        clientY: d.startY - scrollY,
      }),
      source,
      selector,
    );
  }
  d.moved = true;
  if (d.action === 'move') {
    d.x = d.origin.x + Math.round(dx / camera.value.scale);
    d.y = d.origin.y + Math.round(dy / camera.value.scale);
  } else if (d.action === 'resize') {
    d.width = Math.max(
      180,
      Math.round(d.origin.width + dx / camera.value.scale),
    );
    d.height = Math.max(
      140,
      Math.round(d.origin.height + dy / camera.value.scale),
    );
  } else {
    landing.track(event);
    const bounds = space.getBoundingClientRect();
    const x = event.clientX,
      y = event.clientY;
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    ) {
      d.target = '';
      return;
    }
    if (y > bounds.bottom - 24) space.scrollTop += 12;
    else if (y < bounds.top + 24) space.scrollTop -= 12;
    const slotY = y + space.scrollTop - scrollY;
    const index = slots.findIndex(
      ({ rect }, i) =>
        slotY < rect.top ||
        (slotY <= rect.bottom &&
          (x <= rect.right || slots[i + 1]?.rect.top !== rect.top)),
    );
    const to = index < 0 ? slots.length - 1 : index;
    const from = slots.findIndex((slot) => slot.id === d.id);
    d.target = to === from ? '' : (slots[to]?.id ?? '');
    d.after = to > from;
  }
}
async function end(event: PointerEvent) {
  if (canvas.finish(event)) return;
  const d = drag.value;
  if (!d || event.pointerId !== d.pointer) return;
  move(event);
  if (!d.moved) {
    drag.value = undefined;
    return;
  }
  if (d.action === 'sort') {
    if (!d.target) return cancelDrag();
    await run(() =>
      landing.commit(
        async () => {
          await reorderArchive(d.id, d.target, d.after);
        },
        () => {
          drag.value = undefined;
        },
        async () => {
          visibleNotes.value = await readMemoView('archive');
          await nextTick();
        },
      ),
    );
  } else {
    drag.value = undefined;
    if (d.action === 'resize')
      await run(() => updateMemo(d.id, { width: d.width, height: d.height }));
    else {
      const page = view.value;
      await run(() =>
        database.memos
          .where('id')
          .anyOf([...d.members])
          .modify((note) => {
            if (note.archivedAt === null && (note.pageId || 'wall') === page) {
              note.x += d.x - d.origin.x;
              note.y += d.y - d.origin.y;
              note.updatedAt = Date.now();
            }
          }),
      );
    }
  }
}
function noteBox(note: Memo) {
  const d = drag.value;
  const moving = d?.action === 'move' && d.members.has(note.id);
  const box = d?.id === note.id ? d : note;
  return {
    x: note.x + (moving ? d.x - d.origin.x : 0),
    y: note.y + (moving ? d.y - d.origin.y : 0),
    width: box.width,
    height: box.height,
  };
}
const layerOrder = computed(() =>
  [...visibleNotes.value].sort((a, b) => a.layer - b.layer),
);
const mapNotes = computed(() =>
  layerOrder.value.map((note) => ({
    id: note.id,
    color: note.color,
    layer: note.layer,
    ...noteBox(note),
  })),
);
function cardStyle(note: Memo) {
  if (view.value === 'archive') return;
  const box = noteBox(note);
  return {
    left: box.x + 'px',
    top: box.y + 'px',
    width: box.width + 'px',
    height: box.height + 'px',
    zIndex: note.layer,
  };
}
let archiveScroll = 0;
function changeView(id: string) {
  if (id === view.value || landing.committing) return;
  if (view.value === 'archive') archiveScroll = viewport.value?.scrollTop ?? 0;
  cancelDrag();
  ids.value = new Set();
  menu.value = undefined;
  pendingFocus = '';
  query.value = '';
  focusedNote.value = '';
  view.value = id;
  canvas.restoreCamera();
  nextTick(() =>
    viewport.value?.scrollTo(0, id === 'archive' ? archiveScroll : 0),
  );
}
function stepMenu(direction: number) {
  if (
    pageForm.value ||
    menu.value ||
    deleting.value ||
    drag.value ||
    canvas.gesture.value ||
    landing.committing ||
    document.documentElement.classList.contains('mouse-sorting')
  )
    return;
  const order = ['wall', ...pages.value.map((page) => page.id), 'archive'];
  changeView(
    order[
      (order.indexOf(view.value) + direction + order.length) % order.length
    ]!,
  );
}
defineExpose({ stepMenu });
onMounted(() => {
  document.addEventListener('pointerdown', closeOutside, true);
  document.addEventListener('keydown', cancelKey, true);
  window.addEventListener('blur', blurWindow);
  document.addEventListener('keyup', releaseSpace);
});
onUnmounted(() => {
  landing.dispose();
  pageSubscription.unsubscribe();
  queueSubscription?.unsubscribe();
  window.removeEventListener('blur', blurWindow);
  document.removeEventListener('keyup', releaseSpace);
  document.removeEventListener('keydown', cancelKey, true);
  document.removeEventListener('pointerdown', closeOutside, true);
});
</script>
<template>
  <section class="memo-board" aria-label="便签">
    <DesktopMenu
      label="便签菜单"
      add-label="新建菜单"
      :pinned="views[0]"
      :bottom-item="views[1]"
      :items="pages"
      :active="view"
      visible
      @select="changeView"
      @add="editPage()"
      @context="(_, id) => editPage(id)"
      @reorder="sortPages"
    />
    <MenuEditorDialog
      :open="pageForm"
      :title="pageEditing ? '编辑菜单' : '新建菜单'"
      :adding="!pageEditing"
      name-label="菜单名称"
      :busy="pageBusy"
      :error="pageError"
      v-model:name="pageName"
      v-model:icon="pageIcon"
      @close="pageForm = false"
      @submit="savePage"
    />
    <section class="memo-main">
      <header class="memo-toolbar">
        <div class="memo-heading">
          <div class="workspace-heading-copy">
            <PageIcon :name="activeMenu?.icon || 'Notes'" active :size="24" />
            <h2>{{ activeMenu?.name }}</h2>
          </div>
          <span class="memo-meta">
            <span v-if="loaded" class="memo-total"
              >{{ visibleNotes.length }} 张</span
            >
            <span
              v-if="syncLabel"
              class="memo-status"
              :title="syncState.error || '账号同步状态'"
              >{{ syncLabel }}</span
            >
          </span>
        </div>
        <label class="workspace-search memo-search glass-surface">
          <Search :size="18" aria-hidden="true" />
          <input
            ref="searchField"
            v-model="query"
            type="search"
            aria-label="搜索当前页便签"
            placeholder="搜索当前页"
            @keydown="searchKeys($event)"
          />
          <kbd v-if="!query" aria-hidden="true">⌘ / Ctrl F</kbd>
          <button
            v-else
            type="button"
            class="workspace-icon glass-control glass-interactive"
            aria-label="清空便签搜索"
            @click="
              query = '';
              searchField?.focus();
            "
          >
            ×
          </button>
        </label>
      </header>
      <section
        v-if="needle"
        ref="searchResults"
        class="memo-results"
        aria-label="便签搜索结果"
      >
        <p role="status">
          {{
            matches.length
              ? '找到 ' + matches.length + ' 张便签'
              : '没有找到匹配的便签'
          }}
        </p>
        <button
          v-for="({ note, heading, snippet }, index) in matches"
          class="glass-surface glass-interactive"
          :key="note.id"
          :data-color="note.color"
          @keydown="searchKeys($event, index)"
          @click="locate(note)"
        >
          <span class="memo-result-dot" aria-hidden="true"></span>
          <span
            >{{ heading }}<small v-if="snippet">{{ snippet }}</small></span
          >
          <span aria-hidden="true">↗</span>
        </button>
      </section>
      <div
        v-show="!needle"
        ref="viewport"
        class="memo-viewport"
        :style="{
          '--memo-grid-step': gridStep + 'px',
          '--memo-grid-x': (camera.x % gridStep) + 'px',
          '--memo-grid-y': (camera.y % gridStep) + 'px',
        }"
        role="region"
        :aria-label="view === 'archive' ? '归档便签' : '便签画布'"
        :class="{
          'is-archive': view === 'archive',
          'is-hand':
            view !== 'archive' && (spaceHeld || canvas.gesture.value?.pan),
        }"
        :tabindex="view === 'archive' ? -1 : 0"
        @pointerdown.capture="
          !drag && !landing.committing && canvas.start($event)
        "
        @wheel="wheel"
        @contextmenu.prevent.stop="openMenu($event)"
        @pointermove="move"
        @pointerup="end"
        @pointercancel="cancelDrag"
        @lostpointercapture="cancelDrag"
      >
        <div v-if="loaded && !visibleNotes.length" class="memo-empty">
          <component
            :is="view === 'archive' ? Archive : NotesIcon"
            :size="38"
            aria-hidden="true"
          />
          <strong>{{
            view === 'archive' ? '还没有归档便签' : '这面便签墙还是空的'
          }}</strong>
          <span>{{
            view === 'archive'
              ? '归档后，可以在这里查看和还原。'
              : '右键点击空白处，选择「新建便签」。'
          }}</span>
        </div>
        <component
          :is="view === 'archive' ? ReorderTransition : 'div'"
          class="memo-surface"
          :style="
            view === 'archive'
              ? undefined
              : {
                  '--memo-camera-scale': camera.scale,
                  transform:
                    'translate(' +
                    camera.x +
                    'px,' +
                    camera.y +
                    'px) scale(' +
                    camera.scale +
                    ')',
                }
          "
        >
          <MemoCard
            v-for="note in displayedNotes"
            :key="note.id"
            :ref="
              (el) => {
                if (el)
                  cardRefs.set(note.id, el as InstanceType<typeof MemoCard>);
                else cardRefs.delete(note.id);
              }
            "
            :note="note"
            :compact="distantView && focusedNote !== note.id"
            @focusin="
              $event.target !== $event.currentTarget && (focusedNote = note.id)
            "
            @focusout="focusedNote = ''"
            @reveal="locate(note)"
            :style="cardStyle(note)"
            :class="{
              'is-selected': ids.has(note.id),
              'sort-source':
                drag?.action === 'sort' && drag.moved && drag.id === note.id,
            }"
            @pointerdown.capture="cardPress($event, note)"
            @gesture="(event, action) => start(event, note, action)"
            @menu="openMenu($event, note)"
            :save-body="
              (body) =>
                run(() =>
                  updateMemo(note.id, { title: '', body, html: undefined }),
                )
            "
          />
        </component>
        <div
          v-if="rectangle"
          class="memo-marquee"
          :style="{
            left: rectangle.x + 'px',
            top: rectangle.y + 'px',
            width: rectangle.width + 'px',
            height: rectangle.height + 'px',
          }"
          aria-hidden="true"
        />
      </div>
      <MemoOverview
        :key="view"
        v-if="view !== 'archive' && !needle && visibleNotes.length"
        :viewport="viewport"
        :notes="mapNotes"
        :camera="camera"
        :minimum-scale="canvas.minimumScale.value"
        :selected="ids"
        @zoom="canvas.zoom($event)"
        @navigate="canvas.centerOn"
        @fit="canvas.fitNotes"
      />
    </section>
    <div
      v-if="menu"
      ref="menuEl"
      class="memo-menu"
      role="menu"
      aria-label="便签操作"
      :style="{ left: menu.left + 'px', top: menu.top + 'px' }"
      @keydown="menuKeys"
      @contextmenu.prevent.stop
    >
      <template v-if="selected">
        <div v-if="selectedIds.length === 1" class="memo-dates">
          <span>创建 {{ dates.format(selected.createdAt) }}</span>
          <span>修改 {{ dates.format(selected.updatedAt) }}</span>
          <span v-if="selected.archivedAt !== null"
            >归档 {{ dates.format(selected.archivedAt) }}</span
          >
        </div>
        <div class="memo-palette">
          <button
            v-for="(name, color) in memoColors"
            :key="color"
            :data-color="color"
            role="menuitemradio"
            :aria-checked="selected.color === color"
            :aria-label="name"
            :title="name"
            @click="changeColor(color)"
          />
        </div>
        <button role="menuitem" @click="archive()">
          {{ selected.archivedAt !== null ? '移回便签墙' : '归档' }}
        </button>
        <button role="menuitem" class="memo-danger" @click="askDelete()">
          删除
        </button>
      </template>
      <button v-else-if="!menu.id" role="menuitem" @click="add">
        ＋ 新建便签
      </button>
    </div>
    <p v-if="error" class="memo-error" role="alert">
      {{ error }} <button aria-label="关闭提示" @click="error = ''">×</button>
    </p>
    <BaseDialog
      :open="!!deleting"
      solid
      title="删除便签？"
      @update:open="deleting = undefined"
    >
      <p>将删除 {{ deleting?.length }} 张便签。</p>
      <div class="memo-dialog-actions">
        <button @click="deleting = undefined">取消</button
        ><button class="memo-danger" @click="confirmDelete">删除</button>
      </div>
    </BaseDialog>
  </section>
</template>
