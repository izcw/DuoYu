import MarkdownIt, { type Token } from 'markdown-it';
import TurndownService from 'turndown';
import { cleanMemoHtml } from './markup';

const markdown = new MarkdownIt({ html: false, breaks: true });
markdown.validateLink = (url) => /^(https?:\/\/|mailto:)/i.test(url);
markdown.renderer.rules.link_open = (tokens, index, options, _, renderer) => {
  const link = tokens[index]!;
  link.attrSet('target', '_blank');
  link.attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};
const renderImage = markdown.renderer.rules.image!;
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const image = tokens[index]!;
  image.attrSet('loading', 'lazy');
  image.attrSet('referrerpolicy', 'no-referrer');
  return renderImage(tokens, index, options, env, renderer);
};

// These two literal, attribute-free tags round-trip the old editor's formats.
markdown.inline.ruler.before(
  'html_inline',
  'memo_legacy_style',
  (state, silent) => {
    if (state.src[state.pos] !== '<') return false;
    const match = /^<(\/?)(u|mark)>/.exec(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) {
      const closing = !!match[1],
        tag = match[2]!;
      state.push(tag + (closing ? '_close' : '_open'), tag, closing ? -1 : 1);
    }
    state.pos += match[0].length;
    return true;
  },
);

markdown.core.ruler.after('inline', 'memo_tasks', ({ tokens, Token }) => {
  for (const [index, token] of tokens.entries()) {
    if (
      token.type !== 'inline' ||
      tokens[index - 1]?.type !== 'paragraph_open' ||
      tokens[index - 2]?.type !== 'list_item_open'
    )
      continue;
    const first = token.children?.[0];
    if (first?.type !== 'text') continue;
    const mark = /^\[([ xX])\]\s+/.exec(first.content);
    if (!mark) continue;
    first.content = first.content.slice(mark[0].length);
    const box = new Token('memo_task', 'input', 0);
    box.attrSet('type', 'checkbox');
    box.attrSet('disabled', '');
    if (mark[1] !== ' ') box.attrSet('checked', '');
    token.children!.unshift(box);
  }
});

const legacy = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
});
legacy.addRule('strikethrough', {
  filter: (node) => node.nodeName === 'S' || node.nodeName === 'STRIKE',
  replacement: (content) => '~~' + content + '~~',
});
legacy.addRule('memoStyle', {
  filter: ['u', 'mark'],
  replacement: (content, node) => {
    const tag = node.nodeName.toLowerCase();
    return '<' + tag + '>' + content + '</' + tag + '>';
  },
});

export function memoSource(title: string, body: string, html?: string): string {
  const content = html ? legacy.turndown(cleanMemoHtml(html)) : body;
  if (!title || title === '新便签') return content;
  return (
    '# ' + legacy.escape(title.replace(/\s*\n\s*/g, ' ')) + '\n\n' + content
  );
}

export function renderMemo(source: string): string {
  return markdown.render(source);
}

function inlineText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.children) return inlineText(token.children);
      if (token.type === 'hardbreak' || token.type === 'softbreak') return '\n';
      return token.content;
    })
    .join('');
}

export function memoSearchText(source: string): string {
  return markdown
    .parse(source, {})
    .flatMap((block) => {
      if (block.type === 'inline') return [inlineText(block.children || [])];
      if (block.type === 'fence' || block.type === 'code_block')
        return [block.content.trimEnd()];
      return [];
    })
    .join('\n');
}
