import type { Event } from "@/types/event";

/**
 * The three things worth narrowing a night down by, as predicates over an event
 * that is already in hand — no extra request, no extra round trip.
 *
 * Two of these read a real field. The third does not, and that is worth being
 * blunt about: **RA's listing payload carries no price.** There is no `cost`,
 * no `isFree`, no ticket tier — the fields are title, date, times, venue,
 * lineup, attending count and the RA Pick blurb. So "Free" here is a text
 * match, not a fact, and it is deliberately a conservative one (see below).
 */
export const FILTER_KEYS = ["pick", "free", "early"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * Free entry, inferred from what the promoter wrote.
 *
 * The naive version — `/\bfree\b/` — is wrong often enough to be worse than no
 * filter: *Free Your Mind* is a long-running party, "sugar free" and "free
 * jazz" are genres, and a chip that lies about money is a chip that gets people
 * turned away at a door. So the word only counts when it is doing the job of
 * quoting a price: next to entry/admission/RSVP, at the end of the line where a
 * price would go, or spelled as a number.
 *
 * The cost of that caution is misses — a free party whose title never says so
 * simply will not appear — and misses are the right side to fail on.
 */
const FREE_PATTERNS: readonly RegExp[] = [
  // The trailing \b lives inside the alternation rather than after it: `w/`
  // ends on a non-word character, so a boundary assertion outside the group
  // fails on exactly the phrasing it was added for.
  /\bfree\s*(?:(?:entry|entrance|admission|before|b4|rsvp|with\s+rsvp|all\s+night)\b|w\/)/i,
  /\b(?:entry|entrance|admission|cover)\s*[:=–—-]?\s*free\b/i,
  /\bno\s+cover\b/i,
  /\$\s*0(?:\.00)?\b/,
  // A trailing "· Free" / "— FREE", which is how a price gets appended.
  /[·|—–\-:]\s*free\s*$/i,
];

export function isFree(event: Event): boolean {
  const text = `${event.title} ${event.pickBlurb ?? ""}`;
  return FREE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Starts before midnight — i.e. you can get there, hear something and still go
 * home on the same date you left.
 *
 * RA gives `startTime` as a local wall-clock stamp, and for a 2am party that
 * stamp lands on the *following* calendar day while the listing stays filed
 * under the night it belongs to. So the test is not "hour < 24" (always true)
 * but "the clock has not rolled over yet": same day as the listing, and not one
 * of the small hours.
 */
export function startsBeforeMidnight(event: Event): boolean {
  const start = event.startTime || event.date;
  if (!start) return false;

  const listingDay = (event.date || start).slice(0, 10);
  if (start.slice(0, 10) > listingDay) return false;

  const hour = Number(start.slice(11, 13));
  return Number.isFinite(hour) && hour >= 6 && hour <= 23;
}

const PREDICATES: Record<FilterKey, (event: Event) => boolean> = {
  pick: (event) => event.isPick,
  free: isFree,
  early: startsBeforeMidnight,
};

export const FILTER_LABELS: Record<FilterKey, string> = {
  pick: "RA Pick",
  free: "Free",
  early: "Before 12",
};

/** All selected filters must hold — narrowing, not widening. */
export function applyFilters(events: Event[], active: readonly FilterKey[]): Event[] {
  if (active.length === 0) return events;
  return events.filter((event) => active.every((key) => PREDICATES[key](event)));
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
