/**
 * Clock time for the transport bar — `formatDuration`'s "1h 2m" is right for a
 * set list but useless next to a scrubber.
 *
 * Hours only appear once there are hours, so a 40-minute set reads `4:12` and
 * not `0:04:12`.
 */
export function formatClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
