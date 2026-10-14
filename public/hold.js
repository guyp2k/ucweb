export const LONG_PRESS_MS = 500;

export function createHold({ onShort, onLong, ms = LONG_PRESS_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let pressed = false;
  let fired = false;
  const stop = () => {
    clearTimer(timer);
    timer = null;
  };
  return {
    down() {
      stop();
      pressed = true;
      fired = false;
      timer = setTimer(() => {
        timer = null;
        fired = true;
        onLong();
      }, ms);
    },
    up() {
      if (!pressed) return;
      pressed = false;
      stop();
      if (!fired) onShort();
    },
    cancel() {
      pressed = false;
      stop();
    },
  };
}
