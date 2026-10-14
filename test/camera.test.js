import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotAge } from '../public/camera.js';

test('a camera picture\'s age is counted in seconds for the first minute, then minutes, then hours', () => {
  assert.equal(snapshotAge(0), 'Updated just now');
  assert.equal(snapshotAge(4999), 'Updated just now');
  assert.equal(snapshotAge(5000), 'Updated 5 s ago');
  assert.equal(snapshotAge(59999), 'Updated 59 s ago');
  assert.equal(snapshotAge(60000), 'Updated 1 min ago');
  assert.equal(snapshotAge(3599999), 'Updated 59 min ago');
  assert.equal(snapshotAge(3600000), 'Updated 1 h ago');
  assert.equal(snapshotAge(26 * 3600000), 'Updated 26 h ago');
});

test('a picture from a clock slightly ahead is just now, not negative', () => {
  assert.equal(snapshotAge(-3000), 'Updated just now');
});
