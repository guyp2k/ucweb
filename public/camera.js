export function snapshotAge(ms) {
  if (!(ms >= 5000)) return 'Updated just now';
  if (ms < 60000) return `Updated ${Math.floor(ms / 1000)} s ago`;
  if (ms < 3600000) return `Updated ${Math.floor(ms / 60000)} min ago`;
  return `Updated ${Math.floor(ms / 3600000)} h ago`;
}
