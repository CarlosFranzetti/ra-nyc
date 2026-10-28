/**
 * Server-side client for the Resident Advisor GraphQL endpoint.
 *
 * This runs on Vercel (or in the Vite dev middleware), never in the browser:
 * ra.co does not send CORS headers, and the `User-Agent` / `Referer` headers it
 * expects are forbidden headers that browsers silently strip from fetch().
 *
 * The query and the transform below are ported from the original Supabase edge
 * function this replaced — that version was the one that actually worked, and
 * getting `flyerFront` and `attending` back is what fixed missing flyers.
 */

import {
  cacheEvents,
  olderCoverage,
  recentCachedEvents,
  searchCachedEvents,
  searchOlderCachedEvents,
} from "./eventCache.js";
import { normalizeName, searchKey, withinEditDistance } from "./normalize.js";
import { expandTerm } from "./vocab.js";

export const RA_GRAPHQL_URL = "https://ra.co/graphql";

/** RA's internal area id for New York City. */
export const NYC_AREA_ID = 8;

const NEW_YORK_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar date in New York, as `YYYY-MM-DD`.
 *
 * "Today" here used to be `new Date().toISOString().slice(0, 10)`, which is the
 * date in UTC, and Vercel runs in UTC. New York is four or five hours behind it,
 * so from about 20:00 ET (19:00 in winter) the server believed it was already
 * tomorrow: tonight's listings were filed under `past`, the search window moved
 * a day early, and the cache's `current_date` agreed with all of it. RA's own
 * dates are naive New York local days, so this is the only clock that can be
 * compared against them.
 *
 * Asked of `Intl` by zone name rather than by subtracting a fixed offset,
 * because the offset is not fixed — it is four hours until the first Sunday of
 * November and five after, and a constant would be wrong for half the year.
 * `formatToParts` rather than a locale that happens to print ISO order, so the
 * answer does not depend on which locale data the runtime shipped.
 */
export function newYorkDay(at: number = Date.now()): string {
  const parts: Record<string, string> = {};
  for (const part of NEW_YORK_DAY.formatToParts(at)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * A calendar day moved by whole days, as `YYYY-MM-DD`.
 *
 * Arithmetic on the date itself, in UTC, where every day is exactly 86,400
 * seconds long. Adding days to an instant and reading it back in New York would
 * land an hour off across the two DST changes a year; a bare date has no hour
 * to lose.
 */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export interface RAArtist {
  id: string;
  name: string;
}

/** Cleaned-up event shape sent to the browser. */
export interface RAEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  url: string;
  imageUrl: string | null;
  venue: { id: string | null; name: string; area: string };
  artists: RAArtist[];
  attending: number;
  isPick: boolean;
  pickBlurb: string | null;
}

/** Raw listing as RA returns it. */
interface RAListing {
  id: string;
  listingDate: string;
  event: {
    id: string;
    title: string;
    attending: number | null;
    date: string;
    startTime: string | null;
    endTime: string | null;
    contentUrl: string;
    flyerFront: string | null;
    images: { id: string; filename: string; alt: string | null }[] | null;
    venue: { id: string; name: string; contentUrl: string } | null;
    artists: { id: string; name: string }[] | null;
    pick: { blurb: string } | null;
  };
}

const EVENT_LISTINGS_QUERY = `
  query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
    eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
      data {
        id
        listingDate
        event {
          id
          title
          attending
          date
          startTime
          endTime
          contentUrl
          flyerFront
          images {
            id
            filename
            alt
          }
          venue {
            id
            name
            contentUrl
          }
          artists {
            id
            name
          }
          pick {
            blurb
          }
        }
      }
      totalResults
    }
  }
`;

export class RAError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RAError";
  }
}

/**
 * RA is inconsistent about image paths: absolute URLs, protocol-relative URLs,
 * bare filenames, and — the case that broke flyers for a while — a value that
 * already contains `images.ra.co/` but without a scheme. Prefixing the host
 * unconditionally turns that last one into `images.ra.co/images.ra.co/…`.
 */
export function normalizeImageUrl(src: string): string {
  const s = src.trim();
  if (s.startsWith("http")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.includes("images.ra.co/")) {
    return `https://${s.replace(/^https?:\/\//, "").replace(/^\/+/, "")}`;
  }
  return `https://images.ra.co/${s.replace(/^\/+/, "")}`;
}

/**
 * One RA listing → one event, or `null` when RA sent a listing with no event.
 *
 * That happens. On 2026-10-26 a single row with `event: null` sat in a live
 * window and every `/api/search` request 500'd for the minutes it was there —
 * `Cannot read properties of null (reading 'flyerFront')`, straight from the
 * production runtime log. `collect` maps a whole page in one expression
 * outside the per-window catch, so one bad row was the whole search, whatever
 * the query. The day view runs the same map. Both call sites drop the null
 * and warn, so a bad row costs one listing and a log line.
 */
const isEvent = (event: RAEvent | null): event is RAEvent => event !== null;

function transformListing(listing: RAListing): RAEvent | null {
  const event = listing?.event;
  if (!event) {
    console.warn("[ra] listing with no event dropped", listing?.id ?? "?");
    return null;
  }

  // flyerFront is RA's dedicated flyer field and is present far more often than
  // images[0]. Preferring it is the difference between flyers loading and not.
  const rawImage = event.flyerFront ?? event.images?.[0]?.filename ?? null;

  return {
    id: event.id,
    title: event.title,
    date: event.date,
    startTime: event.startTime ?? "",
    endTime: event.endTime ?? "",
    url: `https://ra.co${event.contentUrl}`,
    imageUrl: rawImage ? normalizeImageUrl(rawImage) : null,
    // The id travels with the name so the venue sheet can ask RA for an
    // address. Nullable because a TBA listing has no venue at all.
    venue: {
      id: event.venue?.id ?? null,
      name: event.venue?.name ?? "TBA",
      area: "New York",
    },
    // Keep ids, not just names: the artist page and its Mixcloud lookup are
    // keyed on them, and RA reuses names across different artists.
    artists:
      event.artists?.map((a) => ({ id: a.id, name: a.name })) ?? [],
    attending: event.attending ?? 0,
    isPick: Boolean(event.pick),
    pickBlurb: event.pick?.blurb ?? null,
  };
}

export interface FetchEventsOptions {
  /** Day to list, as `YYYY-MM-DD`. */
  date: string;
  areaId?: number;
  pageSize?: number;
  /** Abort signal so a hung upstream cannot pin the function open. */
  signal?: AbortSignal;
}

/** One page of listings, and how many RA says exist across all pages. */
interface ListingsPage {
  rows: RAListing[];
  total: number;
}

/** One page of listings for a date range. The only place that talks to RA. */
async function fetchListings(options: {
  from: string;
  to: string;
  areaId: number;
  pageSize: number;
  page: number;
  signal?: AbortSignal;
}): Promise<ListingsPage> {
  const res = await fetch(RA_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // RA rejects requests that do not look like a browser.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://ra.co/events/us/newyork",
      Origin: "https://ra.co",
    },
    body: JSON.stringify({
      operationName: "GET_EVENT_LISTINGS",
      query: EVENT_LISTINGS_QUERY,
      variables: {
        filters: {
          areas: { eq: options.areaId },
          listingDate: { gte: options.from, lte: options.to },
        },
        pageSize: options.pageSize,
        page: options.page,
      },
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    throw new RAError(`Resident Advisor responded with ${res.status}`, 502);
  }

  const json = (await res.json()) as {
    data?: { eventListings?: { data?: RAListing[]; totalResults?: number } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new RAError(json.errors[0]?.message ?? "GraphQL error", 502);
  }

  const rows = json.data?.eventListings?.data ?? [];
  const total = json.data?.eventListings?.totalResults;
  // `totalResults` was in the query from the start and nothing ever read it.
  // When RA leaves it out the honest reading is "this page is all there is" —
  // guessing that there is more would spend requests on empty pages.
  return { rows, total: typeof total === "number" && total >= rows.length ? total : rows.length };
}

/**
 * Rows of a day RA lists in one page, and the most pages one day may take.
 *
 * Fifty rows was a cap with no pagination behind it, and a busy Saturday
 * overlaps more than fifty listings once residencies are counted — every day of
 * a multi-day run is its own row, and `startsOn` drops them only *after* they
 * have used up the page. The tail of the night was simply never fetched, and
 * because `attending` sorts the survivors, the tail is also where the small
 * rooms are. A page of 100 is the most RA accepts; `totalResults` says how many
 * more pages there are, and three of them (300 rows) is far past any real night
 * in this city while still bounding what one day view can cost RA.
 */
const DAY_PAGE_SIZE = 100;
const DAY_MAX_PAGES = 3;

/**
 * Every listing RA has for one day, following `totalResults` up to the page cap.
 *
 * `complete` is false when RA says there were more rows than the pages taken —
 * the one fact search needs to keep calling its answer partial.
 */
async function fetchDayListings(options: {
  date: string;
  areaId: number;
  pageSize: number;
  signal?: AbortSignal;
}): Promise<{ events: RAEvent[]; complete: boolean }> {
  const request = (page: number) =>
    fetchListings({
      from: options.date,
      to: options.date,
      areaId: options.areaId,
      pageSize: options.pageSize,
      page,
      signal: options.signal,
    });

  const first = await request(1);
  const pages = Math.min(DAY_MAX_PAGES, Math.ceil(first.total / options.pageSize));
  // The rest in parallel: the page count is known up front, so there is nothing
  // to wait for between them.
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => request(i + 2)),
  );

  const rows = [first, ...rest].flatMap((page) => page.rows);
  return {
    events: dedupeById(rows.map(transformListing).filter(isEvent))
      .filter((event) => startsOn(event, options.date))
      // Busiest first — popularity is a better ordering than whatever RA returns.
      .sort((a, b) => b.attending - a.attending),
    complete: rows.length >= first.total,
  };
}

export async function fetchRAEvents({
  date,
  areaId = NYC_AREA_ID,
  pageSize = DAY_PAGE_SIZE,
  signal,
}: FetchEventsOptions): Promise<RAEvent[]> {
  const { events } = await fetchDayListings({ date, areaId, pageSize, signal });
  return events;
}

/** The `YYYY-MM-DD` part of an RA timestamp, or null if there isn't one. */
function dayOf(value: string | undefined | null): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return DATE_RE.test(day) ? day : null;
}

/**
 * Does this event *begin* on the requested day?
 *
 * RA's `listingDate` filter is a range overlap, so anything whose run covers the
 * day comes back — and a residency listed once as Jul 30 → Aug 6 is therefore
 * returned on all eight days. "Bear Happy Hour at Rawhide" was showing up every
 * single day because of exactly this.
 *
 * An event belongs to the night it starts. That also keeps the case this must
 * not break: a club night starting 22:00 Saturday and ending 04:00 Sunday still
 * belongs to Saturday, which is how anyone would describe it.
 *
 * Deliberately string-compares the date prefix rather than parsing. RA sends
 * naive timestamps with no zone, so `new Date()` would read them in the
 * *server's* zone — UTC on Vercel — and silently shift evening events a day.
 *
 * Fails open: an event with no usable start date is kept. Showing one extra is
 * a far smaller failure than silently dropping a night because RA changed a
 * field.
 */
function startsOn(event: RAEvent, date: string): boolean {
  const start = dayOf(event.startTime) ?? dayOf(event.date);
  return start === null || start === date;
}

/**
 * Second failsafe, independent of the first: one event, one card.
 *
 * If RA ever returns two listing rows for the same event on one day — which is
 * what a multi-day run looks like from the other direction — the duplicate is
 * dropped here regardless of what its dates say.
 */
function dedupeById(events: RAEvent[]): RAEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How far either side of today a day view may reach, and so how much history
 * the durable index can come to hold.
 *
 * It was a year each way, measured in milliseconds from "now" in UTC, to keep
 * the cache key space bounded. The bound is still the point, but the index is
 * now meant to remember: every night someone browses is banked, and five years
 * of nights is what "when did they last play" and "what was that party called"
 * actually reach for. Ahead stays at a year, because RA has nothing useful
 * beyond it and an unannounced night is not worth a row.
 *
 * Nothing preloads this. The nightly cron still fills only the search window
 * (`SEARCH_BEHIND_DAYS` / `SEARCH_AHEAD_DAYS`); history beyond it exists only
 * where a person asked for that day, which is also why it costs RA nothing
 * until somebody does.
 */
export const HISTORY_BEHIND_DAYS = 1825;
export const HISTORY_AHEAD_DAYS = 365;

/** Is this a real calendar date written `YYYY-MM-DD`? Says nothing about range. */
export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  // Round-tripped, not just parsed: V8 reads some impossible dates by rolling
  // them over, and "2026-02-30" must not become a request for 2 March.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Is this day inside the range the app keeps?
 *
 * Compared as strings against New York's today. Both sides are bare calendar
 * dates, which sort correctly as text, so there is no instant to be a few hours
 * wrong about: the old version subtracted a UTC midnight from `Date.now()` and
 * so moved its edges by the time of day.
 */
export function isWithinHistory(value: string, today: string = newYorkDay()): boolean {
  return (
    value >= shiftDay(today, -HISTORY_BEHIND_DAYS) &&
    value <= shiftDay(today, HISTORY_AHEAD_DAYS)
  );
}

/** Guards against passing arbitrary user input into the upstream filter. */
export function isValidDate(value: string, today: string = newYorkDay()): boolean {
  return isCalendarDate(value) && isWithinHistory(value, today);
}

// ─── Search ─────────────────────────────────────────────────────────────────

/**
 * How far either side of today a search looks.
 *
 * Asymmetric, because the two directions answer different questions. Ahead, the
 * question is "is X playing soon", and six weeks is about as far as anyone plans
 * a night out — far enough to catch a tour announcement, not so far that most of
 * the window is empty listings. Behind, it is "when were they last on", and that
 * keeps being interesting far longer: four months covers a quarterly residency,
 * a season of a party, and a touring artist's last pass through.
 *
 * Widening the past is cheap in a way widening the future is not, because the
 * past does not change — once the index holds a day it never needs that day
 * again, so four months back costs a one-time backfill rather than ongoing
 * requests. The future is the opposite: every day in it will change as lineups
 * are announced, so those days have to be re-fetched rather than banked, which
 * is why this pair moved *in* at the back while moving out at the front.
 */
export const SEARCH_AHEAD_DAYS = 45;
export const SEARCH_BEHIND_DAYS = 120;

/** Requests per direction. Each is one call to RA; the edge cache absorbs repeats. */
const SEARCH_PAGES = 3;
const SEARCH_PAGE_SIZE = 100;

/**
 * How the recent past is covered: one request per day, for this many days back.
 *
 * RA returns a date range in ascending order, so paging a wide backward range
 * hands you its *oldest* listings — the opposite of "when did they last play".
 * Narrowing the range helps but is hard to size, because NYC generates roughly
 * a hundred listing *rows* a day: every day of a multi-day run is its own row,
 * the same quirk behind the repeating-event bug. A four-day window at 100 rows
 * a page reached back only as far as day two.
 *
 * A day per request is exact rather than estimated, and it covers the window
 * people actually ask about. Beyond it, coverage degrades to sampling — which
 * is what `truncated` exists to admit.
 *
 * Ten days, not four. Four was chosen when the sampled range behind it was
 * assumed good enough, and it is not: `[14, 4]` is a ten-day span fetched as a
 * single 100-row page, and NYC produces about a hundred rows a *day*, so that
 * range was roughly a ten-percent sample. "I played last Friday and search
 * cannot find me" is exactly what a ten-percent sample looks like from the
 * outside. Ten exact days covers "last week" — the thing people actually ask —
 * and pushes sampling out to where it is honestly a sample.
 */
const PAST_DAYS_EXACT = 10;

/**
 * Sampled ranges beyond the day-by-day window, as [from, to] days before today.
 *
 * The last entry is pinned to `SEARCH_BEHIND_DAYS` rather than written out, so
 * widening the window cannot leave the live path quietly stopping short of it —
 * which is exactly what happened when the window went from 60 days to two
 * months and these still reached only 40.
 *
 * These are samples, not coverage, and always were. The durable index is what
 * actually answers for these days once it has them; this is what a cold index,
 * or no database at all, degrades to.
 */
const PAST_SAMPLED: readonly (readonly [number, number])[] = [
  [21, PAST_DAYS_EXACT],
  [45, 21],
  [80, 45],
  [SEARCH_BEHIND_DAYS, 80],
];

/**
 * How many pages each sampled range gets, nearest first.
 *
 * The ranges are not equally interesting. Three weeks ago is a question people
 * ask; four months ago is one they almost never do, and the index is what
 * answers it properly anyway. Weighting the pages here buys depth where it is
 * read without paying for it across the whole window.
 */
const SAMPLED_PAGES: readonly number[] = [3, 2, 1, 1];

/** Most results anyone scrolls; also bounds the response size. */
export const SEARCH_LIMIT = 60;

export interface SearchResults {
  upcoming: RAEvent[];
  past: RAEvent[];
  /** True when the window was exhausted, so the UI can say the list is partial. */
  truncated: boolean;
  /** Days of the window the durable index holds, and how many it could. */
  coverage: { indexed: number; window: number };
  /**
   * What the index holds beyond the window, back to `HISTORY_BEHIND_DAYS`, or
   * null with no database. Reported separately so `coverage` and `truncated`
   * keep meaning the recent band they always described.
   */
  older: { days: number; oldest: string | null } | null;
}

/**
 * Fewer past hits than this in the recent band, and search reads the older one.
 *
 * Ten because that is a screenful, and a screenful of recent matches is an
 * answer to "when did they last play" — going further back would only push the
 * recent ones down a list nobody scrolls. Below it, the person is plausibly
 * asking about something older, and one extra indexed query is a small price.
 */
const OLDER_MIN_RECENT_HITS = 10;

/** Below this, an edit-distance match matches half the city. */
const FUZZY_MIN_LENGTH = 5;

/**
 * Does this event match a search term?
 *
 * Matches title, venue and lineup, which between them cover what people search
 * for: a DJ, a party, a promoter (whose name is nearly always in the title) or
 * a venue.
 *
 * Three passes, cheapest first:
 *
 * 1. **Substring** on the normalised text, so accents and punctuation never
 *    decide whether you find something — "bjork" finds "Björk".
 * 2. **Leet-folded substring**, which is what makes "holo" find **h0l0**. Real
 *    venue, and nobody types the zeroes.
 * 3. **Edit distance ≤ 1 per word**, for ordinary typos and the one-letter
 *    spelling differences this scene is full of. Only for terms of five
 *    characters or more — below that a single edit matches far too much.
 *
 * Substring rather than the strict `isPlausibleMatch` used for artist
 * resolution, and now fuzzier still. The asymmetry is deliberate: a wrong
 * *auto-resolved* set is presented as fact and is worse than nothing, whereas a
 * loose search hit is something the user is actively scanning past.
 */
function matchesTerm(event: RAEvent, term: string): boolean {
  const exact = normalizeName(term);
  if (!exact) return false;

  const fields = [event.title, event.venue.name, ...event.artists.map((a) => a.name)];

  if (fields.some((value) => normalizeName(value).includes(exact))) return true;

  const split = (value: string) => value.split(/[\s,&·/]+/).map(searchKey).filter(Boolean);

  // Every key the vocabulary offers, the term's own first. An unknown word
  // expands to itself alone, so this is the same single test it always was for
  // the common case — a DJ or a venue.
  //
  // The term's own key may match as a substring: that is the whole point of
  // typing "nowa" for Nowadays, and it was tested above. The *expansions* may
  // not. A vocabulary entry is a word, and several of them are short — "uk"
  // under bass, "av" under live, "unter" under queer — so as substrings they
  // matched L-uk-e Hess, D-av-e Clark and H-unter. Searching "live" returned
  // an unrelated night with Dave Clark on it. Expansions are compared against
  // the field's words, whole.
  const keys = expandTerm(term);
  const [own, ...expansions] = keys;
  if (own && fields.some((value) => searchKey(value).includes(own))) return true;
  if (
    expansions.length &&
    fields.some((value) => split(value).some((word) => expansions.includes(word)))
  ) {
    return true;
  }

  const folded = keys[0] ?? "";

  // Word by word on *both* sides.
  //
  // The haystack has to be split, or a title's length alone blows past the
  // distance budget. The query has to be split for a subtler reason: "reade
  // truthh" folds to one eleven-character key, which is within one edit of
  // nothing, so a typo in a two-word name — the overwhelmingly common shape of
  // a DJ name in this scene — could never be found at all. Splitting both and
  // requiring *every* query word to land somewhere fixes that without letting
  // a single matching word drag in half the city.

  const words = (value: string) =>
    split(value).filter((key) => key.length >= FUZZY_MIN_LENGTH);

  /**
   * Single words *and* adjacent pairs, both long enough to risk an edit.
   *
   * The pairs are what make short names reachable, and they close two misses
   * that a word-only pool could not:
   *
   * - **"bosa nova" found nothing.** Both query words are four letters, so both
   *   are dropped as too short to fuzzy-match, and the whole-term fallback then
   *   compared "bosanova" against the haystack's individual words — "bossa",
   *   "civic" — none of which is within an edit of it. The bigram "bossanova"
   *   is, exactly.
   * - **"dj kose" found nothing**, for the same reason from the other side:
   *   "DJ Koze" is two words of two and four letters, so it contributed *no*
   *   words to the pool at all and was unreachable by any typo whatsoever.
   *   Its bigram "djkoze" is one edit from "djkose".
   *
   * Pairs only, not every n-gram: a title's full key is far too long to be
   * within one edit of anything anyone types, and the cost is linear rather
   * than quadratic in the words of a field.
   */
  const pool = (value: string) => {
    const parts = split(value);
    const out: string[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i]!.length >= FUZZY_MIN_LENGTH) out.push(parts[i]!);
      if (i + 1 < parts.length) {
        const pair = parts[i]! + parts[i + 1]!;
        if (pair.length >= FUZZY_MIN_LENGTH) out.push(pair);
      }
    }
    return out;
  };

  const haystack = fields.flatMap(pool);
  if (haystack.length === 0) return false;

  const near = (needle: string) =>
    haystack.some((word) => withinEditDistance(word, needle, 1));

  const termWords = words(term);

  // A single-word query, or one whose words are all too short to risk an edit
  // (`dj`, `b2b`), falls back to comparing the whole folded term — which is
  // exactly what this did before it learned about multi-word queries.
  if (termWords.length === 0) {
    return folded.length >= FUZZY_MIN_LENGTH && near(folded);
  }

  return termWords.every(near);
}

/** What a group of live requests found, and whether RA had more than it took. */
interface Gathered {
  events: RAEvent[];
  full: boolean;
}

/**
 * One dead request must not fail the whole search, but swallowing it silently
 * is how a rejected pageSize looked exactly like "this artist has no past gigs"
 * for three rounds of debugging.
 */
function warnDead(label: string, cause: unknown): void {
  console.warn(
    `[search] window ${label} failed`,
    cause instanceof Error ? cause.message : cause,
  );
}

/** Runs a set of range/page requests in parallel and flattens the results. */
async function collect(
  requests: { from: string; to: string; page: number }[],
  areaId: number,
  signal?: AbortSignal,
): Promise<Gathered> {
  const pages = await Promise.all(
    requests.map((request) =>
      fetchListings({
        ...request,
        areaId,
        pageSize: SEARCH_PAGE_SIZE,
        signal,
      }).catch((cause: unknown) => {
        warnDead(`${request.from}..${request.to} p${request.page}`, cause);
        return { rows: [], total: 0 } as ListingsPage;
      }),
    ),
  );
  return {
    events: dedupeById(
      pages.flatMap((page) => page.rows).map(transformListing).filter(isEvent),
    ),
    // Any saturated request means RA had more in that window than we took.
    // `some`, not `every`: the trailing page of a window is usually short even
    // when earlier windows were cut off, and reporting "complete" then would be
    // a lie in the direction that matters.
    full: pages.some((page) => page.rows.length >= SEARCH_PAGE_SIZE),
  };
}

/**
 * Whole days, one at a time, through the same fetch the day view uses.
 *
 * A day is exactly what `fetchRAEvents` fetches, so search asks it rather than
 * keeping a second, weaker copy of the same request: one page of 100 silently
 * lost the tail of any night with more rows than that, and the day view had
 * already stopped doing so.
 */
async function collectDays(
  days: string[],
  areaId: number,
  signal?: AbortSignal,
): Promise<Gathered> {
  const fetched = await Promise.all(
    days.map((date) =>
      fetchDayListings({ date, areaId, pageSize: SEARCH_PAGE_SIZE, signal }).catch(
        (cause: unknown) => {
          warnDead(`${date}..${date}`, cause);
          return { events: [] as RAEvent[], complete: true };
        },
      ),
    ),
  );
  return {
    events: dedupeById(fetched.flatMap((day) => day.events)),
    full: fetched.some((day) => !day.complete),
  };
}

/**
 * Events matching a term, upcoming first and then past.
 *
 * Three sources, unioned:
 *
 * 1. **The durable index**, which is the only one that can actually cover the
 *    window. RA caps a page at 100 rows and NYC produces about a hundred
 *    listing rows a day, so a live search reaches roughly three days ahead no
 *    matter how it is paged. The index accumulates instead, filling as the app
 *    is used, and answers the whole ninety days once it has them.
 * 2. **Live windows**, unchanged, which keep the nearest days fresh — a party
 *    announced this morning is not in the index yet — and are the entire
 *    answer when there is no database at all.
 * 3. **A bounded in-memory scan** of the index, used only when the first two
 *    found nothing, so a typo'd term still gets the edit-distance pass that
 *    SQL cannot do.
 *
 * Everything the live windows fetch is written back, so searching warms the
 * index for the next person.
 *
 * Beyond the window there is a fourth, read-only source: the older band of the
 * index, five years deep, consulted only when the recent past has fewer than
 * ten hits. It is never fetched live and never preloaded — those days are there
 * because somebody browsed them — which is why `older` reports what it holds
 * and `coverage` / `truncated` keep describing the window alone.
 */
export async function searchRAEvents(options: {
  term: string;
  areaId?: number;
  signal?: AbortSignal;
}): Promise<SearchResults> {
  const areaId = options.areaId ?? NYC_AREA_ID;
  // One New York "today" for the whole request, and every edge of every window
  // measured from it. Reading the clock again per window would let a search that
  // straddles midnight disagree with itself about which day is which.
  const today = newYorkDay();
  const shiftDate = (days: number) => shiftDay(today, days);
  const windowFrom = shiftDate(-SEARCH_BEHIND_DAYS);
  const windowTo = shiftDate(SEARCH_AHEAD_DAYS);
  const windowDays = SEARCH_AHEAD_DAYS + SEARCH_BEHIND_DAYS + 1;
  // The band behind the window, up to the edge of what the app keeps. Starts the
  // day after the window ends so the two never overlap and never leave a gap.
  const olderFrom = shiftDate(-HISTORY_BEHIND_DAYS);
  const olderTo = shiftDate(-(SEARCH_BEHIND_DAYS + 1));

  // Forward and backward are paged differently, and the reason is not symmetry.
  //
  // RA returns a range in ascending date order, so paging one wide range gives
  // you its *earliest* listings. Ahead, that is exactly right — the soonest
  // events are the ones you want. Behind, it is precisely wrong: three pages of
  // a 60-day backward range returned events from two months ago while the gig
  // last week was never fetched, which is the opposite of "when did they last
  // play". So the backward direction is split into consecutive sub-windows and
  // the nearest one is fetched first.
  const [ahead, behind, cached, olderStats] = await Promise.all([
    collect(
      Array.from({ length: SEARCH_PAGES }, (_, i) => ({
        from: today,
        to: shiftDate(SEARCH_AHEAD_DAYS),
        page: i + 1,
      })),
      areaId,
      options.signal,
    ),
    Promise.all([
      // One request per day for the recent past: exact, not estimated.
      collectDays(
        Array.from({ length: PAST_DAYS_EXACT }, (_, i) => shiftDate(-(i + 1))),
        areaId,
        options.signal,
      ),
      collect(
        PAST_SAMPLED.flatMap(([from, to], i) =>
          Array.from({ length: SAMPLED_PAGES[i] ?? 1 }, (_, page) => ({
            from: shiftDate(-from),
            to: shiftDate(-to),
            page: page + 1,
          })),
        ),
        areaId,
        options.signal,
      ),
    ]).then(([exact, sampled]) => ({
      events: dedupeById([...exact.events, ...sampled.events]),
      full: exact.full || sampled.full,
    })),
    searchCachedEvents({
      term: options.term,
      areaId,
      from: windowFrom,
      to: windowTo,
      // Both buckets come out of one query, so it has to hold both.
      limit: SEARCH_LIMIT * 2,
      today,
    }),
    // Once per search, beside everything else, so the response can say how much
    // history exists even when it did not need to read any.
    olderCoverage({ areaId, from: olderFrom, to: olderTo }),
  ]);

  const live = dedupeById([...ahead.events, ...behind.events]);

  // Warm the index with whatever the live windows just pulled, so the next
  // search over these days does not need them. Not awaited against the
  // response — but see `cacheEvents`, which awaits internally under a timeout.
  await cacheEvents(live, areaId);

  const matching = (bucket: RAEvent[]) =>
    bucket.filter((event) => matchesTerm(event, options.term));

  // The index has already filtered on substring and leet-folding; the live
  // windows have not been filtered at all. Running the matcher over the union
  // is both correct and idempotent, and it is the only way the third pass —
  // edit distance — reaches indexed rows.
  // The widened in-memory scan runs **always**, not only when nothing matched.
  //
  // It used to be gated on `hits.length === 0`, and that gate was a real bug
  // with a genuinely confusing symptom: a *misspelt* term found gigs that the
  // correct spelling did not. The reason is that the two paths search different
  // corpora. SQL `like` sees the whole table but returns a capped, date-ordered
  // slice; the in-memory scan sees a bounded slice but applies all three passes
  // including edit distance. A typo produced zero hits and therefore got the
  // second, wider pass — while the correct spelling found one irrelevant hit
  // from a live window, cleared the gate, and never widened at all.
  //
  // So the exact-spelling path was strictly *weaker* than the typo path. That
  // is worth one extra bounded query on every search.
  const scanned = await recentCachedEvents({
    areaId,
    from: windowFrom,
    to: windowTo,
    today,
  });

  // `matching` over the indexed rows too — the comment above promised it and
  // the code did not do it. Two things got through unfiltered: the index's
  // haystack is one key with the spaces stripped, so "llanow" matched
  // *Vanilla / Nowadays* across the field boundary; and the SQL `like` has no
  // word boundaries, so the vocabulary's short expansions matched inside
  // names there just as they did live. Whether a row came from the index or a
  // live window should not change whether it matches.
  const hits = dedupeById([
    ...matching(live),
    ...matching(cached.events),
    ...matching(scanned),
  ]);

  const day = (event: RAEvent) => event.date.slice(0, 10);

  const upcoming = hits
    .filter((event) => day(event) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, SEARCH_LIMIT);

  // An event on today's date belongs to one list, not both.
  const upcomingIds = new Set(upcoming.map((event) => event.id));
  let pastHits = hits.filter(
    (event) => !upcomingIds.has(event.id) && day(event) < today,
  );

  // The older band is read only when the recent past is thin. A separate query
  // over days the window never fetched live — nothing here asks RA for them, and
  // nothing preloads them: they are in the index only because somebody once
  // browsed that day. Its rows get the same matcher as every other source.
  let olderCut = false;
  if (pastHits.length < OLDER_MIN_RECENT_HITS) {
    const older = await searchOlderCachedEvents({
      term: options.term,
      areaId,
      from: olderFrom,
      to: olderTo,
      // One more than is shown, so "there was more" can be told from "that was all".
      limit: SEARCH_LIMIT + 1,
    });
    olderCut = older.length > SEARCH_LIMIT;
    pastHits = dedupeById([...pastHits, ...matching(older)]);
  }

  const past = pastHits
    // Most recent first: the last time someone played is more interesting than
    // the first.
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, SEARCH_LIMIT);

  return {
    upcoming,
    past,
    // Saturated live windows still mean RA had more than we took — but only
    // matters where the index has not covered the day anyway.
    // Past the window, truncation means the list itself was cut: the older query
    // came back full, or the merge held more than a list shows.
    truncated:
      ((ahead.full || behind.full) && cached.daysCovered < windowDays) ||
      olderCut ||
      pastHits.length > SEARCH_LIMIT,
    coverage: { indexed: cached.daysCovered, window: windowDays },
    older: olderStats,
  };
}
