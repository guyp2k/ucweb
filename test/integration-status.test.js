import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { integrationStatus } from '../public/devices.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('a connected integration reads green, a disconnected or failed one red, one on its way amber, and an idle, unset or disabled one grey', () => {
  const tone = (item) => integrationStatus(item)[1];
  for (const state of ['CONNECTED', 'ACTIVE']) assert.equal(tone({ state, enabled: true }), 'is-ok', state);
  for (const state of ['DISCONNECTED', 'ERROR']) assert.equal(tone({ state, enabled: true }), 'is-warn', state);
  for (const state of ['CONNECTING', 'RECONNECTING']) assert.equal(tone({ state, enabled: true }), 'is-busy', state);
  for (const state of ['IDLE', 'NOT_CONFIGURED', 'UNKNOWN', null, 'SOMETHING_NEW']) assert.equal(tone({ state, enabled: true }), 'is-idle', String(state));
  assert.deepEqual(integrationStatus({ state: 'CONNECTED', enabled: false }), ['Disabled', 'is-idle']);
  assert.deepEqual(integrationStatus({ state: 'DISCONNECTED', enabled: true }), ['Disconnected', 'is-warn']);
});

test('the status pill takes the theme green, red, amber and grey, and keeps its label in the text color', async () => {
  const css = await readFile(path.join(publicDir, 'styles.css'), 'utf8');
  const rule = (selector) => css.match(new RegExp(`\\n${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  for (const [selector, token] of [['.intg-state.is-ok', 'on'], ['.intg-state.is-warn', 'danger'], ['.intg-state.is-busy', 'caution'], ['.intg-state.is-idle', 'muted']]) {
    const body = rule(selector);
    assert.match(body, new RegExp(`background: color-mix\\(in srgb, var\\(--${token}\\) \\d+%, transparent\\);`), `${selector} tint`);
    assert.match(body, new RegExp(`border-color: var\\(--${token}\\);`), `${selector} border`);
    assert.match(body, /color: var\(--text\);/, `${selector} label`);
    assert.match(rule(`${selector}::before`), new RegExp(`background: var\\(--${token}\\);`), `${selector} dot`);
  }
  assert.doesNotMatch(css, /\.intg-state[^{]*\{[^}]*var\(--ok\)/, 'no pill uses --ok, which is grey in several themes');
});
