import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TOKEN = /^[a-z][a-z0-9-]*$/;

function classesMadeBy(source) {
  const classes = new Set();
  const add = (text) => text.split(/\s+/).filter((name) => TOKEN.test(name)).forEach((name) => classes.add(name));
  for (const [, list] of source.matchAll(/el\([^,]+, [`']([^`']+)[`']/g)) add(list.replace(/\$\{[^}]*\}/g, ' '));
  for (const [, args] of source.matchAll(/classList\.(?:add|toggle)\(([^;]*?)\)[;,]/g)) {
    for (const [, name] of args.matchAll(/'([^']+)'/g)) add(name);
  }
  for (const [, name] of source.matchAll(/setAttribute\('class', '([^']+)'\)/g)) add(name);
  for (const [, body] of source.matchAll(/_CLASSES = \{([^}]*)\}/g)) {
    for (const [, name] of body.matchAll(/'([^']+)'/g)) add(name);
  }
  return classes;
}

test('page parts never reuse a class name the app shell styles', async () => {
  const made = classesMadeBy(await readFile(path.join(publicDir, 'pages.js'), 'utf8'));
  const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
  const shell = new Set([...html.matchAll(/<[^>]*class="([^"]+)"[^>]*>/g)]
    .filter(([tag]) => !tag.includes('id="pages"'))
    .flatMap(([, list]) => list.split(/\s+/)));
  assert.ok(made.has('page-media') && made.has('pages-dot') && made.size > 40, `read ${made.size} page classes`);
  assert.ok(shell.has('page') && shell.size > 40, `read ${shell.size} shell classes`);
  assert.deepEqual([...made].filter((name) => shell.has(name)), []);
});

test('each view switch tab controls a panel that exists, and each view hides the other panel', async () => {
  const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
  const css = await readFile(path.join(publicDir, 'styles.css'), 'utf8');
  const tabs = [...html.matchAll(/role="tab" data-view="([a-z]+)" aria-controls="([a-z]+)"/g)].map(([, view, panel]) => ({ view, panel }));
  assert.deepEqual(tabs, [{ view: 'pages', panel: 'pages' }, { view: 'controls', panel: 'pad' }]);
  for (const { panel } of tabs) assert.match(html, new RegExp(`id="${panel}" role="tabpanel"`), panel);
  const hiding = css.match(/\.control-panel\[data-view="pages"\] \.pad,\s*\.control-panel\[data-view="controls"\] \.pages \{\s*display: none;/);
  assert.ok(hiding, 'pages view hides the pad and controls view hides the pages');
});
