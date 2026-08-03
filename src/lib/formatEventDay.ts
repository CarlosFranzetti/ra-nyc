/**
 * "Sat 9 Aug" for a search result.
 *
 * Slices the date prefix and builds a UTC date rather than parsing RA's naive
 * timestamp directly — `new Date("2026-08-09T22:00:00.000")` is read in the
 * *viewer's* zone, which puts a late-night event on the wrong day for anyone
 * west of it.
 */
export function formatEventDay(value: string): string {
  const day = value.slice(0, 10);
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
