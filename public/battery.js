const STOPS = [
  [15, '--danger'],
  [50, '--caution'],
  [100, '--on'],
];

export function batteryFill(capacity) {
  const level = Math.max(0, Math.min(100, capacity));
  if (level <= STOPS[0][0]) return `var(${STOPS[0][1]})`;
  for (let i = 1; i < STOPS.length; i += 1) {
    const [bottom, bottomColor] = STOPS[i - 1];
    const [top, topColor] = STOPS[i];
    if (level <= top) {
      const share = Math.round(((level - bottom) / (top - bottom)) * 100);
      return share === 100 ? `var(${topColor})` : `color-mix(in oklch, var(${topColor}) ${share}%, var(${bottomColor}))`;
    }
  }
  return `var(${STOPS[STOPS.length - 1][1]})`;
}

export function batteryReading(remote) {
  if (remote.online && remote.battery) return { capacity: remote.battery.capacity, status: remote.battery.status, stale: false, at: null };
  const last = remote.lastBattery;
  if (!last) return null;
  return { capacity: last.capacity, status: last.status, stale: true, at: last.at };
}

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function batteryAge(ms) {
  if (!(ms >= MINUTE)) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  return `${Math.floor(ms / DAY)} d ago`;
}
