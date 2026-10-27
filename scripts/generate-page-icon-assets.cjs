// Generate transparent filled artwork from the same IconPark components as the outline picker.
const { createSSRApp, h } = require('vue');
const { renderToString } = require('vue/server-renderer');
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs');
(async () => {
  const source = readFileSync('src/shared/page-icons.ts', 'utf8');
  const imports = [
    ...source.matchAll(
      /import (\w+) from '@icon-park\/vue-next\/es\/icons\/(\w+)'/g,
    ),
  ];
  mkdirSync('public/images/iconpark-filled', { recursive: true });
  for (const [, id, name] of imports) {
    const Icon = require('@icon-park/vue-next/lib/icons/' + name).default;
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(Icon, { theme: 'filled', fill: '#000', size: 48, strokeWidth: 3 }),
      }),
    );
    const svg = html.match(/<svg[\s\S]*?<\/svg>/)[0];
    const shapes = svg
      .slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'))
      .replaceAll('#000', '#MASKWHITE')
      .replaceAll('#FFF', '#000')
      .replaceAll('#MASKWHITE', '#fff');
    writeFileSync(
      `public/images/iconpark-filled/${id}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><mask id="shape" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48" style="mask-type:luminance">${shapes}</mask><path fill="white" mask="url(#shape)" d="M0 0h48v48H0z"/></svg>`,
    );
  }
})();
