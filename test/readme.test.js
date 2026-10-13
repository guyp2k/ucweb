import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readmeImages() {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const markdown = [...readme.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map(([, alt, src]) => ({ alt, src }));
  const html = [...readme.matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({ alt: tag.match(/\balt="([^"]*)"/)?.[1] ?? '', src: tag.match(/\bsrc="([^"]+)"/)?.[1] }));
  return [...markdown, ...html];
}

test('every image in the README exists and has alt text', async () => {
  const images = await readmeImages();
  assert.ok(images.length >= 10, `found ${images.length} images`);
  for (const { alt, src } of images) {
    assert.ok(alt.trim(), `${src} has alt text`);
    assert.ok(!/^https?:/.test(src), `${src} is a file in the repository`);
    assert.ok((await stat(path.join(root, src))).isFile(), `${src} exists`);
  }
});

test('every screenshot in docs/screenshots is used in the README', async () => {
  const used = new Set((await readmeImages()).map(({ src }) => src));
  for (const file of await readdir(path.join(root, 'docs', 'screenshots'))) {
    assert.ok(used.has(`docs/screenshots/${file}`), `${file} is shown in the README`);
  }
});
