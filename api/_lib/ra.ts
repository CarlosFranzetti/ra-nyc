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
  recentCachedEvents,
  searchCachedEvents,
} from "./eventCache.js";
import { normalizeName, searchKey, withinEditDistance } from "./normalize.js";
import { expandTerm } from "./vocab.js";

export const RA_GRAPHQL_URL = "https://ra.co/graphql";

/** RA's internal area id for New York City. */
export const NYC_AREA_ID = 8;

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
  venue: { name: string; area: string };
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

function transformListing(listing: RAListing): RAEvent {
  const event = listing.event;

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
    venue: { name: event.venue?.name ?? "TBA", area: "New York" },
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

/** One page of listings for a date range. The only place that talks to RA. */
async function fetchListings(options: {
  from: string;
  to: string;
  areaId: number;
  pageSize: number;
  page: number;
  signal?: AbortSignal;
}): Promise<RAListing[]> {
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
    data?: { eventListings?: { data?: RAListing[] } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new RAError(json.errors[0]?.message ?? "GraphQL error", 502);
  }

  return json.data?.eventListings?.data ?? [];
}

export async function fetchRAEvents({
  date,
  areaId = NYC_AREA_ID,
  pageSize = 50,
  signal,
}: FetchEventsOptions): Promise<RAEvent[]> {
  const listings = await fetchListings({
    from: date,
    to: date,
    areaId,
    pageSize,
    page: 1,
    signal,
  });

  return (
    dedupeById(listings.map(transformListing))
      .filter((event) => startsOn(event, date))
      // Busiest first — with a 50-event cap and no pagination, popularity is a
      // better ordering than whatever RA returns.
      .sort((a, b) => b.attending - a.attending)
  );
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

/** Guards against passing arbitrary user input into the upstream filter. */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;

  // Reject anything more than a year out either way; RA has nothing useful
  // there and it keeps the cache key space bounded.
  const now = Date.now();
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  return Math.abs(parsed.getTime() - now) <= YEAR_MS;
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
}

function shiftDate(days: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return at.toISOString().slice(0, 10);
}

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

  // Every key the vocabulary offers, the term's own first. An unknown word
  // expands to itself alone, so this is the same single test it always was for
  // the common case — a DJ or a venue.
  const keys = expandTerm(term);
  if (keys.some((key) => fields.some((value) => searchKey(value).includes(key)))) {
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
    value.split(/[\s,&·/]+/).map(searchKey).filter((key) => key.length >= FUZZY_MIN_LENGTH);

  const fieldWords = fields.flatMap(words);
  if (fieldWords.length === 0) return false;

  const near = (needle: string) =>
    fieldWords.some((word) => withinEditDistance(word, needle, 1));

  const termWords = words(term);

  // A single-word query, or one whose words are all too short to risk an edit
  // (`dj`, `b2b`), falls back to comparing the whole folded term — which is
  // exactly what this did before it learned about multi-word queries.
  if (termWords.length === 0) {
    return folded.length >= FUZZY_MIN_LENGTH && near(folded);
  }

  return termWords.every(near);
}

/** Runs a set of range/page requests in parallel and flattens the results. */
async function collect(
  requests: { from: string; to: string; page: number }[],
  areaId: number,
  signal?: AbortSignal,
): Promise<{ events: RAEvent[]; full: boolean }> {
  const pages = await Promise.all(
    requests.map((request) =>
      fetchListings({
        ...request,
        areaId,
        pageSize: SEARCH_PAGE_SIZE,
        signal,
      }).catch((cause: unknown) => {
        // One dead window must not fail the whole search, but swallowing it
        // silently is how a rejected pageSize looked exactly like "this artist
        // has no past gigs" for three rounds of debugging.
        console.warn(
          `[search] window ${request.from}..${request.to} p${request.page} failed`,
          cause instanceof Error ? cause.message : cause,
        );
        return [] as RAListing[];
      }),
    ),
  );
  return {
    events: dedupeById(pages.flat().map(transformListing)),
    // Any saturated request means RA had more in that window than we took.
    // `some`, not `every`: the trailing page of a window is usually short even
    // when earlier windows were cut off, and reporting "complete" then would be
    // a lie in the direction that matters.
    full: pages.some((page) => page.length >= SEARCH_PAGE_SIZE),
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
 */
export async function searchRAEvents(options: {
  term: string;
  areaId?: number;
  signal?: AbortSignal;
}): Promise<SearchResults> {
  const areaId = options.areaId ?? NYC_AREA_ID;
  const today = shiftDate(0);
  const windowFrom = shiftDate(-SEARCH_BEHIND_DAYS);
  const windowTo = shiftDate(SEARCH_AHEAD_DAYS);
  const windowDays = SEARCH_AHEAD_DAYS + SEARCH_BEHIND_DAYS + 1;

  // Forward and backward are paged differently, and the reason is not symmetry.
  //
  // RA returns a range in ascending date order, so paging one wide range gives
  // you its *earliest* listings. Ahead, that is exactly right — the soonest
  // events are the ones you want. Behind, it is precisely wrong: three pages of
  // a 60-day backward range returned events from two months ago while the gig
  // last week was never fetched, which is the opposite of "when did they last
  // play". So the backward direction is split into consecutive sub-windows and
  // the nearest one is fetched first.
  const [ahead, behind, cached] = await Promise.all([
    collect(
      Array.from({ length: SEARCH_PAGES }, (_, i) => ({
        from: today,
        to: shiftDate(SEARCH_AHEAD_DAYS),
        page: i + 1,
      })),
      areaId,
      options.signal,
    ),
    collect(
      [
        // One request per day for the recent past: exact, not estimated.
        ...Array.from({ length: PAST_DAYS_EXACT }, (_, i) => {
          const day = shiftDate(-(i + 1));
          return { from: day, to: day, page: 1 };
        }),
        ...PAST_SAMPLED.flatMap(([from, to], i) =>
          Array.from({ length: SAMPLED_PAGES[i] ?? 1 }, (_, page) => ({
            from: shiftDate(-from),
            to: shiftDate(-to),
            page: page + 1,
          })),
        ),
      ],
      areaId,
      options.signal,
    ),
    searchCachedEvents({
      term: options.term,
      areaId,
      from: windowFrom,
      to: windowTo,
      // Both buckets come out of one query, so it has to hold both.
      limit: SEARCH_LIMIT * 2,
    }),
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
  const scanned = await recentCachedEvents({ areaId, from: windowFrom, to: windowTo });

  const hits = dedupeById([
    ...matching(live),
    ...cached.events,
    ...matching(scanned),
  ]);

  const day = (event: RAEvent) => event.date.slice(0, 10);

  const upcoming = hits
    .filter((event) => day(event) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, SEARCH_LIMIT);

  // An event on today's date belongs to one list, not both.
  const upcomingIds = new Set(upcoming.map((event) => event.id));
  const past = hits
    .filter((event) => !upcomingIds.has(event.id) && day(event) < today)
    // Most recent first: the last time someone played is more interesting than
    // the first.
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, SEARCH_LIMIT);

  return {
    upcoming,
    past,
    // Saturated live windows still mean RA had more than we took — but only
    // matters where the index has not covered the day anyway.
    truncated:
      (ahead.full || behind.full) && cached.daysCovered < windowDays,
    coverage: { indexed: cached.daysCovered, window: windowDays },
  };
}
