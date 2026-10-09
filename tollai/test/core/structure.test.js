import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'core');

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsFiles(full)));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('core/ modules are runtime-agnostic: no node: builtin imports', async () => {
  const files = await collectJsFiles(coreDir);
  assert.ok(files.length > 0, 'core/ should contain modules');
  const nodeImport = /(?:from\s+|import\s*\(?\s*)['"]node:/;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.ok(!nodeImport.test(source), `${file} must not import node: builtins`);
  }
});

test('core/ modules never use eval or new Function', async () => {
  const files = await collectJsFiles(coreDir);
  const evalUse = /\beval\s*\(|\bnew\s+Function\s*\(/;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.ok(!evalUse.test(source), `${file} must not use eval/new Function`);
  }
});
