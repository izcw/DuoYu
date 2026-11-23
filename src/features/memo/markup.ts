const allowed = new Set([
  'B',
  'STRONG',
  'U',
  'S',
  'STRIKE',
  'UL',
  'OL',
  'LI',
  'BR',
  'DIV',
  'P',
  'MARK',
  'H1',
  'H2',
  'H3',
]);
// Pasted and imported markup passes through an inert template before display.
export function cleanMemoHtml(html: string): string {
  const input = document.createElement('template');
  input.innerHTML = html;
  const output = document.createElement('div');
  function copy(source: Node, parent: Node) {
    if (source.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(source.textContent || ''));
      return;
    }
    if (
      !(source instanceof Element) ||
      ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(source.tagName)
    )
      return;
    const container = allowed.has(source.tagName)
      ? parent.appendChild(document.createElement(source.tagName.toLowerCase()))
      : parent;
    for (const child of source.childNodes) copy(child, container);
  }
  for (const child of input.content.childNodes) copy(child, output);
  return output.innerHTML;
}
