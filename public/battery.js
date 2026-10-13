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
