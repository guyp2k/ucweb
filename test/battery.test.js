import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batteryAge, batteryFill, batteryReading } from '../public/battery.js';

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

const HOUR = 3600000;

test('a live reading from an online remote is shown as current', () => {
  const remote = { online: true, battery: { capacity: 80, status: 'CHARGING' }, lastBattery: { capacity: 80, status: 'CHARGING', at: 1000 } };
  assert.deepEqual(batteryReading(remote), { capacity: 80, status: 'CHARGING', stale: false, at: null });
});

test('an unreadable battery falls back to the last reading, marked stale with its time', () => {
  const remote = { online: true, battery: null, lastBattery: { capacity: 64, status: 'DISCHARGING', at: 5000 } };
  assert.deepEqual(batteryReading(remote), { capacity: 64, status: 'DISCHARGING', stale: true, at: 5000 });
});

test('an offline remote shows its last reading as stale even if it had a battery', () => {
  const remote = { online: false, battery: { capacity: 90, status: 'FULL' }, lastBattery: { capacity: 90, status: 'FULL', at: 7000 } };
  assert.deepEqual(batteryReading(remote), { capacity: 90, status: 'FULL', stale: true, at: 7000 });
});

test('with no reading ever there is nothing to show', () => {
  assert.equal(batteryReading({ online: true, battery: null, lastBattery: null }), null);
  assert.equal(batteryReading({ online: false, battery: null }), null);
});

test('the age of a reading reads like a person would say it', () => {
  assert.equal(batteryAge(0), 'just now');
  assert.equal(batteryAge(59000), 'just now');
  assert.equal(batteryAge(60000), '1 min ago');
  assert.equal(batteryAge(4 * 60000 + 30000), '4 min ago');
  assert.equal(batteryAge(HOUR - 1), '59 min ago');
  assert.equal(batteryAge(HOUR), '1 h ago');
  assert.equal(batteryAge(5 * HOUR + 59 * 60000), '5 h ago');
  assert.equal(batteryAge(24 * HOUR), '1 d ago');
  assert.equal(batteryAge(3 * 24 * HOUR + HOUR), '3 d ago');
});

test('a reading from a clock slightly ahead is just now, not negative', () => {
  assert.equal(batteryAge(-5000), 'just now');
});
