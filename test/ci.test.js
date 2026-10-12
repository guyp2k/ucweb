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
