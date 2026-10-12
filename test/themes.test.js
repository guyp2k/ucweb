import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { discoverThemes } from '../src/server.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TOKENS = ['bg', 'surface', 'surface-raised', 'border', 'text', 'muted', 'accent', 'accent-fill', 'accent-fill-hover', 'on-accent', 'glow', 'ok', 'warn', 'font-body', 'font-display', 'font-label', 'display-weight', 'label-case', 'label-tracking', 'radius'];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const themes = await discoverThemes(publicDir);

test('every theme Rabbit Hole has is offered under the same id and name', () => {
  const byId = Object.fromEntries(themes.map((theme) => [theme.id, theme.name]));
  assert.deepEqual(
    { original: byId.original, copper: byId.copper, roon: byId.roon, 'roon-light': byId['roon-light'], 'dark-orange': byId['dark-orange'], 'graphite-brass': byId['graphite-brass'], miyara: byId.miyara },
    { original: 'Original', copper: 'Obsidian & Copper', roon: 'Roon Dark', 'roon-light': 'Roon Light', 'dark-orange': 'Dark Orange', 'graphite-brass': 'Graphite & Brass', miyara: 'Miyara' },
  );
});

for (const theme of themes) {
  test(`the ${theme.name} theme defines every token and its fonts exist`, async () => {
    const css = await readFile(path.join(publicDir, 'themes', theme.id, 'theme.css'), 'utf8');
    for (const token of TOKENS) assert.match(css, new RegExp(`--${token}:`), `${theme.id} is missing --${token}`);
    assert.match(css, new RegExp(`color-scheme: ${theme.colorScheme};`));
    for (const [, url] of css.matchAll(/url\("([^"]+)"\)/g)) {
      assert.ok((await stat(path.join(publicDir, url))).isFile(), `${theme.id} points at a missing font ${url}`);
    }
  });

  test(`the ${theme.name} theme's text meets WCAG AA contrast`, async () => {
    const css = await readFile(path.join(publicDir, 'themes', theme.id, 'theme.css'), 'utf8');
    const color = (token) => css.match(new RegExp(`--${token}: (#[0-9a-f]{6});`))[1];
    for (const [fg, bg] of [['text', 'bg'], ['text', 'surface'], ['muted', 'surface'], ['accent', 'surface'], ['on-accent', 'accent-fill'], ['on-accent', 'accent-fill-hover'], ['warn', 'surface']]) {
      assert.ok(contrast(color(fg), color(bg)) >= 4.5, `${theme.id}: ${fg} on ${bg} is ${contrast(color(fg), color(bg)).toFixed(2)}:1`);
    }
  });
}
