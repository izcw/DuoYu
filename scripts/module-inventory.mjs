// Build a reproducible navigation index from the source review allowlist.
import { readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse } from 'vue/compiler-sfc';

const out = path.resolve('work/review-2026-11-04');
const { files } = JSON.parse(
  await readFile(path.join(out, 'SOURCE-REVIEW.json'), 'utf8'),
);
const known = new Set(
  files.filter((f) => f.sha256).map((f) => f.repo + '/' + f.file),
);
const posix = path.posix;
const modules = [],
  goPackages = new Map(),
  parseErrors = [];
const idRepo = 'DuoYu-ID';
const aliases = {
  '@': 'admin/src',
  '@views': 'admin/src/views',
  '@imgs': 'admin/src/assets/images',
  '@icons': 'admin/src/assets/icons',
  '@utils': 'admin/src/utils',
  '@stores': 'admin/src/store',
  '@styles': 'admin/src/assets/styles',
};

function localReference(repo, file, specifier) {
  const source = specifier.split('?')[0];
  let base;
  if (source.startsWith('.'))
    base = posix.join(repo, posix.dirname(file), source);
  else {
    const slash = source.indexOf('/'),
      alias = slash < 0 ? source : source.slice(0, slash);
    const mapping =
      repo === idRepo
        ? aliases
        : repo === 'DuoYu-Extensions'
          ? { '@': 'src', '~': 'src', '@@': '', '~~': '' }
          : {};
    if (Object.hasOwn(mapping, alias))
      base = posix.join(
        repo,
        mapping[alias],
        slash < 0 ? '' : source.slice(slash + 1),
      );
  }
  if (!base) return null;
  const suffixes = [
    '',
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '.vue',
    '.json',
    '.css',
    '.scss',
    '/index.ts',
    '/index.js',
    '/index.vue',
  ];
  const target = suffixes.map((s) => base + s).find((p) => known.has(p));
  if (target) return { specifier, target };
  if (
    base.startsWith(repo + '/') &&
    /\.(webp|png|svg|jpe?g|gif|ico|woff2?)$/i.test(base) &&
    statSync(path.resolve('..', base), { throwIfNoEntry: false })?.isFile()
  )
    return { specifier, target: base, kind: 'asset' };
  return { specifier, target: null };
}

const componentTypes = 'admin/src/types/import/components.d.ts';
const declarations = await readFile(
  path.resolve('..', idRepo, componentTypes),
  'utf8',
);
const componentMap = new Map();
for (const match of declarations.matchAll(
  /^\s*(\w+): typeof import\(['"]([^'"]+)['"]\)/gm,
)) {
  const ref = localReference(idRepo, componentTypes, match[2]);
  if (ref?.target) componentMap.set(match[1], ref.target);
}
function templateComponents(ast) {
  const tags = new Set();
  const visit = (node) => {
    if (node?.tag) {
      const tag = node.tag
        .split('-')
        .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
        .join('');
      if (componentMap.has(tag)) tags.add(componentMap.get(tag));
    }
    if (Array.isArray(node?.children)) node.children.forEach(visit);
  };
  visit(ast);
  return [...tags].sort();
}

for (const entry of files) {
  const { repo, file, sha256 } = entry;
  if (!sha256) continue;
  const key = repo + '/' + file;
  if (file.endsWith('.go') && !file.endsWith('_test.go')) {
    const text = await readFile(path.resolve('..', repo, file), 'utf8');
    const name = text.match(/^package\s+(\w+)/m)?.[1];
    if (name) {
      const group = repo + '/' + posix.dirname(file) + ' (' + name + ')';
      if (!goPackages.has(group)) goPackages.set(group, []);
      goPackages.get(group).push(key);
    }
    continue;
  }
  if (
    !/^(src\/|admin\/src\/|server\/sync\/src\/)/.test(file) ||
    !/\.(vue|[cm]?js|tsx?)$/.test(file) ||
    file.endsWith('.d.ts')
  )
    continue;
  const text = await readFile(path.resolve('..', repo, file), 'utf8');
  let scripts = [text],
    extra = [],
    registeredTemplateCandidates = [];
  if (file.endsWith('.vue')) {
    const { descriptor, errors } = parse(text, { filename: file });
    if (errors.length) parseErrors.push({ key, errors: errors.map(String) });
    const blocks = [descriptor.script, descriptor.scriptSetup].filter(Boolean);
    scripts = blocks.map((b) => b.content);
    extra = blocks.map((b) => b.src).filter(Boolean);
    if (repo === idRepo)
      registeredTemplateCandidates = templateComponents(
        descriptor.template?.ast,
      );
  }
  const specifiers = new Set(extra),
    dynamic = [];
  for (const script of scripts) {
    for (const ref of ts.preProcessFile(script, true, true).importedFiles)
      specifiers.add(ref.fileName);
    const ast = ts.createSourceFile(
      file,
      script,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const arg = node.arguments[0];
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          arg &&
          !ts.isStringLiteralLike(arg)
        )
          dynamic.push(node.getText(ast).slice(0, 200));
        else if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.getText(ast) === 'import.meta.glob'
        )
          dynamic.push(node.getText(ast).slice(0, 200));
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  const references = [...specifiers]
    .sort()
    .map((s) => localReference(repo, file, s))
    .filter(Boolean);
  modules.push({
    file: key,
    sha256,
    references,
    registeredTemplateCandidates,
    dynamic,
  });
}
const summary = {
  modules: modules.length,
  staticReferences: modules.reduce(
    (n, m) =>
      n + m.references.filter((r) => r.target && r.kind !== 'asset').length,
    0,
  ),
  assetReferences: modules.reduce(
    (n, m) => n + m.references.filter((r) => r.kind === 'asset').length,
    0,
  ),
  unresolvedLocalReferences: modules.reduce(
    (n, m) => n + m.references.filter((r) => !r.target).length,
    0,
  ),
  registeredTemplateCandidates: modules.reduce(
    (n, m) => n + m.registeredTemplateCandidates.length,
    0,
  ),
  dynamicExpressions: modules.reduce((n, m) => n + m.dynamic.length, 0),
  goPackages: goPackages.size,
  goSources: [...goPackages.values()].reduce((n, rows) => n + rows.length, 0),
  parseErrors: parseErrors.length,
};
await writeFile(
  path.join(out, 'MODULE-INVENTORY.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      summary,
      scope:
        'Static local imports in application Vue/JS/TS and Node sync source; includes type imports. Imported asset paths were checked for existence. Registered template names are candidates, and dynamic expressions require manual tracing. Go entries describe source directory/package membership; build tags, runtime messages, CSS imports, third-party packages and test coverage require separate evidence.',
      parseErrors,
      modules,
      goPackages: Object.fromEntries(goPackages),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary));
if (parseErrors.length) process.exitCode = 1;
