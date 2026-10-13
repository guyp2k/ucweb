import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (file) => readFile(path.join(publicDir, file), 'utf8');

function cssBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is styled`);
  return css.slice(start, css.indexOf('}', start));
}

test('the menu button opens the drawer it names, and script and styles pin the drawer at the same width', async () => {
  const [html, css, app] = await Promise.all([read('index.html'), read('styles.css'), read('app.js')]);
  assert.match(html, /id="menu-button"[^>]*aria-controls="nav"/);
  assert.match(html, /<nav class="nav" id="nav"/);
  const width = Number(app.match(/const PINNED_NAV = '\(min-width: (\d+)px\)'/)[1]);
  const pinned = css.slice(css.indexOf(`@media (min-width: ${width}px) {`));
  assert.ok(css.includes(`@media (min-width: ${width}px) {`), `styles pin the drawer at ${width}px`);
  assert.match(pinned.slice(0, pinned.indexOf('\n}\n')), /\.menu-button,\s*\.nav-close \{\s*display: none;/);
  assert.ok(css.includes(`@media (max-width: ${width - 1}px) {`), `styles slide the drawer in below ${width}px`);
});

test('every browse link in the drawer names a screen the app renders', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('app.js')]);
  const screens = [...html.matchAll(/data-screen="([a-z]+)"/g)].map(([, screen]) => screen);
  assert.deepEqual(screens, ['entities', 'integrations']);
  for (const screen of screens) assert.ok(app.includes(`saved === '${screen}'`), screen);
});

test('device tiles never borrow the activity tile state attribute, so a sensor that is on is not shown as running', async () => {
  const [devices, css] = await Promise.all([read('devices.js'), read('styles.css')]);
  assert.ok(!/dataset\.state\b/.test(devices), 'devices.js sets data-state');
  assert.ok(!/\.dev-tile\[data-state/.test(css), 'styles key device tiles on data-state');
  assert.match(devices, /PASSIVE_TYPES = new Set\(\['sensor', 'select', 'button', 'macro'/);
});

test('the page column fills its grid track, so its width does not change with what a page shows', async () => {
  assert.match(cssBlock(await read('styles.css'), '.page'), /\n {2}width: 100%;/);
});

test('device sliders share the player slider look in every engine', async () => {
  const css = await read('styles.css');
  for (const part of ['::-webkit-slider-runnable-track', '::-moz-range-track', '::-moz-range-progress', '::-webkit-slider-thumb', '::-moz-range-thumb']) {
    assert.ok(css.includes(`.player-volume-input${part},\n.dev-range-input${part} {`), part);
  }
});

test('on a phone only the activities page puts the running activity\'s controls first, and a desktop keeps them beside every page', async () => {
  const [css, app] = await Promise.all([read('styles.css'), read('app.js')]);
  const raised = [...css.matchAll(/([^{}\n]+) \{\s*order: -1;/g)].map(([, selector]) => selector.trim());
  assert.deepEqual(raised, ['.layout.has-active:not(.shows-devices) .control']);
  const desktop = css.slice(css.indexOf('@media (min-width: 900px) {'));
  assert.match(desktop.slice(0, desktop.indexOf('\n}\n')), /\.layout\.has-active:not\(\.shows-devices\) \.control \{\s*order: 0;/);
  assert.match(app, /classList\.toggle\('shows-devices', !onlyActivities\)/);
});
