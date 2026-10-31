import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the installed ws is past the releases with the memory disclosure and fragment DoS advisories', async () => {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const [major, minor, patch] = lock.packages['node_modules/ws'].version.split('.').map(Number);
  assert.equal(major, 8);
  assert.ok(minor > 20 || (minor === 20 && patch >= 2), `ws ${lock.packages['node_modules/ws'].version} is affected by GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p (fixed after 8.20.1)`);
});

test('the image runs Node 24, the current long-term release, on a supported Alpine', async () => {
  const from = (await readFile(path.join(root, 'Dockerfile'), 'utf8')).match(/^FROM node:(\d+)\.(\d+)\.(\d+)-alpine3\.(\d+)$/m);
  assert.ok(from, 'the image is pinned to an exact node:X.Y.Z-alpine3.N tag');
  const [, major, minor, , alpine] = from.map(Number);
  assert.equal(major, 24);
  assert.ok(minor >= 22, `node 24.${minor} is older than 24.22`);
  assert.ok(alpine >= 23, `alpine 3.${alpine} is out of support`);
});
