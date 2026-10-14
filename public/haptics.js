export const TAP_MS = 10;

export function canVibrate(nav, touch) {
  return touch === true && typeof nav?.vibrate === 'function';
}

export function tap(nav, enabled, touch) {
  if (!enabled || !canVibrate(nav, touch)) return false;
  try {
    return nav.vibrate(TAP_MS) === true;
  } catch {
    return false;
  }
}
