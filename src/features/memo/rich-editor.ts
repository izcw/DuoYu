import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import { renderMemo } from './markdown';

// Convert the preview's disabled checkboxes to the editor's task-list schema.
export function editableMemoHtml(source: string) {
  const html = renderMemo(source);
  if (!html.includes('type="checkbox"')) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const list of template.content.querySelectorAll('ul')) {
    let group: HTMLUListElement | undefined;
    for (const item of Array.from(list.children)) {
      const box = item.querySelector<HTMLInputElement>(
        ':scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]',
      );
      const type = box ? 'taskList' : 'bulletList';
      if (group?.dataset.type !== type) {
        group = document.createElement('ul');
        group.dataset.type = type;
        list.before(group);
      }
      if (box) {
        item.setAttribute('data-type', 'taskItem');
        item.setAttribute('data-checked', String(box.checked));
        box.remove();
      }
      group.append(item);
    }
    list.remove();
  }
  return template.innerHTML;
}

export function createMemoEditor(
  element: HTMLElement,
  source: string,
  changed: () => void,
) {
  const editor: Editor = new Editor({
    element,
    content: editableMemoHtml(source),
    extensions: [
      StarterKit.configure({
        trailingNode: false,
        link: { openOnClick: false, autolink: false },
      }),
      Markdown,
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image.configure({ inline: true }),
      Highlight.extend({
        renderMarkdown: (node, helpers) =>
          '<mark>' + helpers.renderChildren(node) + '</mark>',
      }),
    ],
    editorProps: {
      attributes: {
        class: 'memo-document',
        role: 'textbox',
        'aria-label': '便签正文',
        'aria-multiline': 'true',
        spellcheck: 'true',
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (!text || view.state.selection.$from.parent.type.spec.code)
          return false;
        event.preventDefault();
        editor.commands.insertContent(editableMemoHtml(text));
        return true;
      },
    },
    onUpdate: changed,
  });
  return editor;
}
