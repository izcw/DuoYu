import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Node 22.0 predates native TypeScript loading. These two fixture sources
// contain only data and functions, with no runtime imports.
export async function readDataModule(url) {
  const { outputText } = ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
