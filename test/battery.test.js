import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batteryFill } from '../public/battery.js';

test('a full battery is green, half is amber and 15% or less is red', () => {
  assert.equal(batteryFill(100), 'var(--on)');
  assert.equal(batteryFill(50), 'var(--caution)');
  assert.equal(batteryFill(15), 'var(--danger)');
  assert.equal(batteryFill(4), 'var(--danger)');
});

test('the battery color blends smoothly between the stops as it drains', () => {
  assert.equal(batteryFill(75), 'color-mix(in oklch, var(--on) 50%, var(--caution))');
  assert.equal(batteryFill(90), 'color-mix(in oklch, var(--on) 80%, var(--caution))');
  assert.equal(batteryFill(40), 'color-mix(in oklch, var(--caution) 71%, var(--danger))');
  assert.equal(batteryFill(20), 'color-mix(in oklch, var(--caution) 14%, var(--danger))');
});

test('a battery reading outside 0 to 100 is clamped', () => {
  assert.equal(batteryFill(130), 'var(--on)');
  assert.equal(batteryFill(-5), 'var(--danger)');
});
