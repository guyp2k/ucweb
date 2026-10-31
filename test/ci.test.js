import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const workflow = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'ci.yml');

test('a newer push to main cancels the older CI run so latest is never overwritten by an older build', async () => {
  const yaml = await readFile(workflow, 'utf8');
  const block = yaml.match(/^concurrency:\n((?: {2}.+\n)+)/m);
  assert.ok(block, 'ci.yml has no workflow-level concurrency block');
  assert.match(block[1], /^ {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}$/m);
  assert.match(block[1], /^ {2}cancel-in-progress: true$/m);
});

test('CI tests the Node releases ucweb supports and none that are past end of life', async () => {
  const yaml = await readFile(workflow, 'utf8');
  assert.match(yaml, /^ {8}node: \['22', '24'\]$/m);
  const root = path.join(path.dirname(workflow), '..', '..');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '>=22');
  assert.match(await readFile(path.join(root, 'README.md'), 'utf8'), /^Node 22 or later\./m);
});

test('every action in CI runs on the Node 24 runtime, not the deprecated Node 20 one', async () => {
  const yaml = await readFile(workflow, 'utf8');
  const minimum = { 'actions/checkout': 5, 'actions/setup-node': 5, 'docker/setup-buildx-action': 4, 'docker/build-push-action': 7, 'docker/login-action': 4 };
  const uses = [...yaml.matchAll(/uses: ([\w-]+\/[\w-]+)@v(\d+)$/gm)];
  assert.ok(uses.length >= 7, `found ${uses.length} actions`);
  for (const [, action, major] of uses) {
    assert.ok(action in minimum, `${action} has no known Node 24 release here`);
    assert.ok(Number(major) >= minimum[action], `${action}@v${major} still runs on Node 20`);
  }
});
