import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { canVibrate, tap, TAP_MS } from '../public/haptics.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function phone() {
  const calls = [];
  return { calls, vibrate: (pattern) => calls.push(pattern) > 0 };
}

test('a press buzzes the phone for 10 ms when vibration is on', () => {
  const nav = phone();
  assert.equal(TAP_MS, 10);
  assert.equal(tap(nav, true, true), true);
  assert.deepEqual(nav.calls, [10]);
});

test('a press does not buzz when vibration is switched off', () => {
  const nav = phone();
  assert.equal(tap(nav, false, true), false);
  assert.deepEqual(nav.calls, []);
});

test('a browser without vibration is reported as unable and left alone', () => {
  assert.equal(canVibrate({}, true), false);
  assert.equal(canVibrate(undefined, true), false);
  assert.equal(tap({}, true, true), false);
  assert.equal(canVibrate(phone(), true), true);
});

test('a desktop browser that has the vibrate call but no touch screen does not buzz or offer the switch', () => {
  const nav = phone();
  assert.equal(canVibrate(nav, false), false);
  assert.equal(tap(nav, true, false), false);
  assert.deepEqual(nav.calls, []);
});

test('a browser that refuses or throws on vibrate does not break the press', () => {
  assert.equal(tap({ vibrate: () => false }, true, true), false);
  assert.equal(tap({ vibrate: () => { throw new TypeError('blocked'); } }, true, true), false);
});

test('the vibration switch sits in the menu, starts hidden and is a toggle button', async () => {
  const html = await readFile(path.join(root, 'public', 'index.html'), 'utf8');
  const nav = html.match(/<nav class="nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const group = nav.match(/<div\b[^>]*\bid="haptics-group"[^>]*>/)?.[0];
  assert.ok(group, 'the menu has a #haptics-group');
  assert.match(group, /\bhidden\b/);
  const button = nav.match(/<button\b[^>]*\bid="haptics"[^>]*>/)?.[0];
  assert.ok(button, 'the menu has a #haptics button');
  assert.match(button, /\baria-pressed="true"/);
  assert.match(button, /\btype="button"/);
  assert.doesNotMatch(html.match(/<header class="topbar">[\s\S]*?<\/header>/)[0], /haptics/);
});
