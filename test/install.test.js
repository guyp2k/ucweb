import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function pngSize(src) {
  const bytes = await readFile(path.join(publicDir, src.replace(/^\//, '')));
  assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47], `${src} is a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

const manifest = async () => JSON.parse(await readFile(path.join(publicDir, 'manifest.webmanifest'), 'utf8'));
const html = () => readFile(path.join(publicDir, 'index.html'), 'utf8');

test('the manifest makes ucweb an installable standalone app rooted at /', async () => {
  const app = await manifest();
  assert.equal(app.id, '/');
  assert.equal(app.start_url, '/');
  assert.equal(app.scope, '/');
  assert.equal(app.display, 'standalone');
  assert.match(app.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(app.background_color, /^#[0-9a-f]{6}$/i);
});

test('every manifest icon is a PNG of exactly the size it claims', async () => {
  const { icons } = await manifest();
  const pngs = icons.filter((icon) => icon.type === 'image/png');
  assert.ok(pngs.length >= 3, 'there are PNG icons');
  for (const icon of pngs) assert.equal(await pngSize(icon.src), icon.sizes, icon.src);
});

test('Android gets a 192 and a 512 icon plus a maskable 512', async () => {
  const { icons } = await manifest();
  const has = (sizes, purpose) => icons.some((icon) => icon.type === 'image/png' && icon.sizes === sizes && (icon.purpose ?? 'any').split(' ').includes(purpose));
  assert.ok(has('192x192', 'any'), '192 any');
  assert.ok(has('512x512', 'any'), '512 any');
  assert.ok(has('512x512', 'maskable'), '512 maskable');
});

test('iPhones get a 180 px home screen icon and open ucweb full screen', async () => {
  const page = await html();
  const touch = page.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(touch, 'index.html links an apple-touch-icon');
  assert.equal(await pngSize(touch[1]), '180x180');
  assert.match(page, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(page, /<meta name="apple-mobile-web-app-title" content="ucweb">/);
});
