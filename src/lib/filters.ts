import type { Event } from "@/types/event";

/**
 * Three ways to narrow a night down, all computed from the payload already in
 * hand — no extra request, no extra round trip.
 *
 * The first pass at this shipped **Free** and **Before 12** and both were dead
 * weight. Free was a text match over the title, because RA's listing payload
 * carries no price at all, so it read 0 on most nights and could never be
 * trusted on the nights it did not. Before 12 was worse in the opposite
 * direction: almost every listing starts before midnight, so it matched
 * everything and filtered nothing — a chip reading "21" beside a count of 21.
 *
 * What is left is one editorial signal and two crowd-size ones, which is the
 * question people actually arrive with: *is this the big one tonight, or the
 * one nobody has found yet?*
 */
/**
 * Order is the reading order in the chip row: the two crowd-size filters sit
 * together on the left because they are one axis with two ends, and RA Pick is
 * pushed to the right because it is somebody else's opinion rather than a
 * property of the night.
 */
export const FILTER_KEYS = ["lowkey", "busy", "pick"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export const FILTER_LABELS: Record<FilterKey, string> = {
  lowkey: "Low-key",
  busy: "Busy",
  pick: "RA Pick",
};

/**
 * The share of a night that counts as busy, and the share that counts as
 * low-key. A third each, so the middle third belongs to neither.
 *
 * Relative to the night, never absolute. A Tuesday's biggest room draws fewer
 * people than a Saturday's quietest, so any fixed head count would make one of
 * those chips useless on half the days of the week — which is exactly how the
 * two filters this replaced failed.
 */
const TIER_SHARE = 1 / 3;

/**
 * The attending counts that bound each tier for a given night.
 *
 * Computed over the whole day's listings rather than over whatever is currently
 * filtered, so turning **Busy** on and off does not redefine what busy means.
 */
function tiers(events: Event[]): { busyFrom: number; lowkeyTo: number } {
  const counts = events
    .map((event) => event.attending)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);

  // Nothing to rank: a day with no head counts at all leaves both chips empty
  // rather than declaring every event both busy and low-key.
  if (counts.length === 0) return { busyFrom: Infinity, lowkeyTo: -1 };

  const cut = Math.max(1, Math.round(counts.length * TIER_SHARE));
  return {
    busyFrom: counts[cut - 1]!,
    lowkeyTo: counts[Math.max(0, counts.length - cut)]!,
  };
}

/** All selected filters must hold — narrowing, not widening. */
export function applyFilters(events: Event[], active: readonly FilterKey[]): Event[] {
  if (active.length === 0) return events;

  const { busyFrom, lowkeyTo } = tiers(events);
  const holds: Record<FilterKey, (event: Event) => boolean> = {
    pick: (event) => event.isPick,
    busy: (event) => event.attending >= busyFrom,
    lowkey: (event) => event.attending > 0 && event.attending <= lowkeyTo,
  };

  return events.filter((event) => active.every((key) => holds[key](event)));
}

/**
 * How many events each filter would leave *given the others already on*, so a
 * chip showing 0 is telling the truth about what tapping it does rather than
 * about the unfiltered day.
 */
export function filterCounts(
  events: Event[],
  active: readonly FilterKey[],
): Record<FilterKey, number> {
  const counts = {} as Record<FilterKey, number>;
  for (const key of FILTER_KEYS) {
    const combined = active.includes(key) ? active : [...active, key];
    counts[key] = applyFilters(events, combined).length;
  }
  return counts;
}
