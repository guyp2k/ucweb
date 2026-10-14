import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { discoverThemes } from '../src/server.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TOKENS = ['bg', 'surface', 'surface-raised', 'border', 'text', 'muted', 'accent', 'accent-fill', 'accent-fill-hover', 'on-accent', 'glow', 'ok', 'on', 'caution', 'danger', 'warn', 'font-body', 'font-display', 'font-label', 'display-weight', 'label-case', 'label-tracking', 'radius'];

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const light = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  let hue = 0;
  if (delta !== 0 && max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (delta !== 0 && max === g) hue = 60 * ((b - r) / delta + 2);
  else if (delta !== 0) hue = 60 * ((r - g) / delta + 4);
  return { hue: (hue + 360) % 360, sat };
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

  test(`the ${theme.name} theme's battery colors are a visible amber and red`, async () => {
    const css = await readFile(path.join(publicDir, 'themes', theme.id, 'theme.css'), 'utf8');
    const color = (token) => css.match(new RegExp(`--${token}: (#[0-9a-f]{6});`))[1];
    const caution = hsl(color('caution'));
    const danger = hsl(color('danger'));
    assert.ok(caution.hue >= 30 && caution.hue <= 55 && caution.sat >= 0.5, `${theme.id}: --caution ${color('caution')} is not amber (hue ${caution.hue.toFixed(0)})`);
    assert.ok((danger.hue <= 10 || danger.hue >= 350) && danger.sat >= 0.5, `${theme.id}: --danger ${color('danger')} is not red (hue ${danger.hue.toFixed(0)})`);
    for (const token of ['caution', 'danger']) {
      assert.ok(contrast(color(token), color('surface')) >= 3, `${theme.id}: --${token} on surface is ${contrast(color(token), color('surface')).toFixed(2)}:1`);
    }
  });

  test(`the ${theme.name} theme's activity-on dot is a visible green`, async () => {
    const css = await readFile(path.join(publicDir, 'themes', theme.id, 'theme.css'), 'utf8');
    const color = (token) => css.match(new RegExp(`--${token}: (#[0-9a-f]{6});`))[1];
    const { hue, sat } = hsl(color('on'));
    assert.ok(hue >= 90 && hue <= 160 && sat >= 0.4, `${theme.id}: --on ${color('on')} is not green (hue ${hue.toFixed(0)}, saturation ${sat.toFixed(2)})`);
    assert.ok(contrast(color('on'), color('surface')) >= 3, `${theme.id}: --on on surface is ${contrast(color('on'), color('surface')).toFixed(2)}:1`);
  });
}

test('an activity that is on shows its dot in the theme green', async () => {
  const css = await readFile(path.join(publicDir, 'styles.css'), 'utf8');
  const rule = css.match(/:is\(\.tile, \.control-title\)\[data-state="ON"\] \.badge::before \{([^}]*)\}/);
  assert.ok(rule, 'styles.css has no rule for the ON dot');
  assert.match(rule[1], /background: var\(--on\);/);
});

test('the battery meter takes its color from the battery level, not the warning state', async () => {
  const css = await readFile(path.join(publicDir, 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /\.chip\.is-warn \.meter-fill/);
  const app = await readFile(path.join(publicDir, 'app.js'), 'utf8');
  assert.match(app, /fill\.style\.background = batteryFill\(reading\.capacity\);/);
});

test('the README and the Unraid template list every theme', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ids = (await readdir(path.join(root, 'public', 'themes'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const template = await readFile(path.join(root, 'unraid', 'ucweb.xml'), 'utf8');
  const settingsRow = readme.split('\n').find((line) => line.startsWith('| `UCWEB_THEME`'));
  const templateTheme = template.split('\n').find((line) => line.includes('Target="UCWEB_THEME"'));
  for (const id of ids) {
    assert.ok(settingsRow.includes(`\`${id}\``), `README settings row lists ${id}`);
    assert.match(templateTheme, new RegExp(`[ "]${id}[,. ]`), `Unraid template lists ${id}`);
  }
});

test('the logo goes back to its idle animation after the send pulse', async () => {
  const css = await readFile(path.join(publicDir, 'styles.css'), 'utf8');
  const animation = (selector) => css.match(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*?animation: ([^;]+);`))?.[1];
  for (const [part, idle] of [['.wave-1', 'logo-wave'], ['.wave-2', 'logo-wave'], ['.wave-3', 'logo-wave'], ['.logo-core', 'logo-core']]) {
    const sending = animation(`.logo.is-sending ${part}`);
    assert.ok(sending, `${part} has a sending animation`);
    assert.match(sending, /^logo-(send|press) /, `${part} plays the pulse first`);
    assert.match(sending, new RegExp(`, ${idle} [^,]* infinite$`), `${part} resumes ${idle} forever after the pulse`);
  }
});
