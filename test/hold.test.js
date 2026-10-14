import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHold, LONG_PRESS_MS } from '../public/hold.js';

function clock() {
  let now = 0;
  const timers = new Map();
  let next = 1;
  return {
    setTimer: (fn, ms) => {
      timers.set(next, { fn, at: now + ms });
      return next++;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

function hold() {
  const time = clock();
  const sent = [];
  const control = createHold({ setTimer: time.setTimer, clearTimer: time.clearTimer, onShort: () => sent.push('short'), onLong: () => sent.push('long') });
  return { time, sent, control };
}

test('a long press takes half a second', () => {
  assert.equal(LONG_PRESS_MS, 500);
});

test('letting go before half a second sends the short press, once, on release', () => {
  const { time, sent, control } = hold();
  control.down();
  time.advance(300);
  assert.deepEqual(sent, []);
  control.up();
  time.advance(1000);
  assert.deepEqual(sent, ['short']);
});

test('holding for half a second sends the long press once, and letting go after sends nothing more', () => {
  const { time, sent, control } = hold();
  control.down();
  time.advance(499);
  assert.deepEqual(sent, []);
  time.advance(1);
  assert.deepEqual(sent, ['long']);
  time.advance(3000);
  control.up();
  assert.deepEqual(sent, ['long']);
});

test('a press that is cancelled, by sliding off or the window losing focus, sends nothing', () => {
  const { time, sent, control } = hold();
  control.down();
  time.advance(200);
  control.cancel();
  time.advance(1000);
  control.up();
  assert.deepEqual(sent, []);
});

test('a release without a press sends nothing, and presses after a long press start fresh', () => {
  const { time, sent, control } = hold();
  control.up();
  control.down();
  time.advance(600);
  control.up();
  control.down();
  time.advance(100);
  control.up();
  assert.deepEqual(sent, ['long', 'short']);
});
