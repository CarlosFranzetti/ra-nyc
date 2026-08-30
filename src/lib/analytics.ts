import { track } from "@vercel/analytics";

/**
 * Counting the taps that leave the app.
 *
 * Every one of these is an outbound link, and that bounds what can honestly be
 * measured: this records that somebody *left towards* a ticket page or a ride,
 * never that they bought a ticket or took the ride. Nothing on this side of the
 * link can know the second thing, and a chart labelled "412 Ubers ordered" when
 * the truth is "412 people tapped Uber" is the kind of number that gets
 * believed and then acted on.
 *
 * ## What is deliberately not sent
 *
 * No identifiers, nothing typed, and nothing about the person. The properties
 * below are all facts about the *listing* — a venue's name, an event's id, a
 * link's host — which are public on ra.co already. Vercel Web Analytics is
 * cookieless and does not build a per-visitor profile; keeping the payload to
 * public facts about public events is what stops that being undone from here.
 *
 * Search terms are the obvious omission and the deliberate one: what somebody
 * looks for is the most identifying thing this app touches, and the recent list
 * (see lib/recentSearches) already keeps it on their own device where it is
 * useful. It has no business leaving.
 */

/**
 * The kinds of exit, which are the funnel.
 *
 * A closed set rather than free strings, because these become chart series and
 * a typo would silently become a fourth series nobody notices is a duplicate.
 */
export const OUTBOUND_KINDS = [
  /** The RA page for an event, from the listings or the venue sheet. */
  "tickets",
  "uber",
  "lyft",
  "maps",
  /** An artist's own links — SoundCloud, Bandcamp, socials, their RA page. */
  "artist-link",
  /** The two donate links in Customize. */
  "donate",
] as const;

export type OutboundKind = (typeof OUTBOUND_KINDS)[number];

/** Everything an outbound event may carry. All optional, all public facts. */
export interface OutboundContext {
  /** Venue name, for the ride and map exits. */
  venue?: string | null;
  /** RA's event id, which is the join key back to a listing. */
  eventId?: string | null;
  /** Where the link goes. Host only — never the full URL. */
  host?: string | null;
  /** Which surface the tap came from, when one kind has several. */
  from?: string | null;
}

/**
 * Vercel rejects an event whose properties are not scalars, and silently
 * truncates long strings. Nulls and undefineds are dropped rather than sent as
 * "null", because an absent property and the string "null" chart differently.
 */
const MAX_VALUE = 80;

export function outboundProps(
  context: OutboundContext,
): Record<string, string> {
  const props: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (!clean) continue;
    props[key] = clean.slice(0, MAX_VALUE);
  }
  return props;
}

/**
 * The host of a URL, for grouping exits by where they went.
 *
 * Host rather than the whole URL on purpose: "soundcloud.com" is the useful
 * fact and it is one of a handful of values, whereas a full URL is unique per
 * event and would turn one chart series into thousands. It also cannot carry a
 * query string somewhere it should not go — the Uber and Lyft links have
 * coordinates in them.
 */
export function hostOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * Records one exit.
 *
 * Never throws: analytics is not worth breaking a tap for, and `track` is a
 * no-op both in development and when Web Analytics is switched off for the
 * project, so this is safe to call before the dashboard toggle is flipped.
 */
export function outbound(kind: OutboundKind, context: OutboundContext = {}): void {
  try {
    track(kind, outboundProps(context));
  } catch {
    /* never let a metric break a link */
  }
}
