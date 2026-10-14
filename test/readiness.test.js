import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readinessText } from '../public/readiness.js';

const problem = (text, steps = 1, blocking = true) => ({ text, steps, blocking });

test('a ready macro shows its step count', () => {
  assert.deepEqual(readinessText({ verdict: 'ready', steps: 7, runs: 7, problems: [] }), { text: 'Ready · 7 steps', warn: false, title: '' });
  assert.deepEqual(readinessText({ verdict: 'ready', steps: 1, runs: 1, problems: [] }), { text: 'Ready · 1 step', warn: false, title: '' });
});

test('a macro with no steps says so', () => {
  assert.deepEqual(readinessText({ verdict: 'nothing', steps: 0, runs: 0, problems: [] }), { text: 'Has no steps', warn: true, title: '' });
});

test('a macro whose steps all target deleted devices says it runs nothing, and why', () => {
  assert.deepEqual(readinessText({ verdict: 'nothing', steps: 1, runs: 0, problems: [problem('Den ATV no longer exists', 1, false)] }), {
    text: 'Runs nothing: Den ATV no longer exists',
    warn: true,
    title: 'Den ATV no longer exists',
  });
});

test('a blocked macro leads with the first cause and counts the rest, with every cause in the tooltip', () => {
  const view = { verdict: 'blocked', steps: 4, runs: 4, problems: [problem("Den Lamp's integration is not connected", 3), problem('The IR emitter for Projector is not available')] };
  assert.deepEqual(readinessText(view), {
    text: "Won't run: Den Lamp's integration is not connected (+1 more)",
    warn: true,
    title: "Den Lamp's integration is not connected (3 steps)\nThe IR emitter for Projector is not available",
  });
});

test('a ready macro with steps the run skips past is flagged, not called broken', () => {
  assert.deepEqual(readinessText({ verdict: 'ready', steps: 5, runs: 4, problems: [problem('Old Lamp no longer exists', 1, false)] }), {
    text: 'Ready · 5 steps, 1 warning',
    warn: true,
    title: 'Old Lamp no longer exists',
  });
});
