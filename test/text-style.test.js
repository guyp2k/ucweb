import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'reference', '.git']);
const TEXT = /\.(js|css|html|json|md|sh|xml|yml|yaml|webmanifest|txt|svg)$|^Dockerfile$/;

async function textFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await textFiles(full)));
    else if (TEXT.test(entry.name)) files.push(full);
  }
  return files;
}

test('no file contains an em dash or an en dash', async () => {
  const offenders = [];
  for (const file of await textFiles(root)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      if (/[\u2013\u2014]/u.test(line)) offenders.push(`${path.relative(root, file)}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
