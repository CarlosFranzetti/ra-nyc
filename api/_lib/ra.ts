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

import { normalizeName } from "./normalize.js";

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
 * RA's filter input has no text predicate that this client can rely on, so
 * search means pulling a window of listings and matching them here. That makes
 * the window a direct trade against upstream load, and 60 days each way covers
 * the question people actually ask — "is X playing soon, and when were they
 * last on?" — without paging through a year of listings for every query.
 */
export const SEARCH_WINDOW_DAYS = 60;


/** Requests per direction. Each is one call to RA; the edge cache absorbs repeats. */
const SEARCH_PAGES = 3;
const SEARCH_PAGE_SIZE = 100;

/**
 * Backward sub-windows, in days before today, each fetched with one request.
 *
 * Deliberately not equal spans. A page is 100 listings and NYC runs ~25 events
 * a day, so a request only covers about four days — split the window evenly and
 * the "nearest" slice is still 20 days wide, of which you see the oldest four.
 * That is how a search for someone who played last week answered with a gig
 * from two months ago.
 *
 * Doubling spans instead: the last four days are covered completely, and
 * coverage thins out as the results get less interesting. It is still sampling
 * rather than exhaustive — without a real search API on RA's side it cannot be
 * anything else — but it samples the end people are actually asking about, and
 * `truncated` tells the UI to say so.
 */
const PAST_BOUNDARIES = [0, 4, 12, 28, 60] as const;

/** Most results anyone scrolls; also bounds the response size. */
export const SEARCH_LIMIT = 60;

export interface SearchResults {
  upcoming: RAEvent[];
  past: RAEvent[];
  /** True when the window was exhausted, so the UI can say the list is partial. */
  truncated: boolean;
}

function shiftDate(days: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return at.toISOString().slice(0, 10);
}

/**
 * Does this event match a search term?
 *
 * Matches title, venue and lineup, which between them cover what people search
 * for: a DJ, a party, a promoter (whose name is nearly always in the title) or
 * a venue. Runs on the same normaliser the artist matcher uses, so accents and
 * punctuation don't decide whether you find something — searching "bjork"
 * finds "Björk", and "bossa nova" finds "Bossa Nova Civic Club".
 *
 * Substring, not the strict `isPlausibleMatch` used for artist resolution. The
 * asymmetry is deliberate: a wrong *auto-resolved* set is presented as fact and
 * is worse than nothing, whereas a loose search hit is something the user is
 * actively scanning and can dismiss at a glance.
 */
function matchesTerm(event: RAEvent, normalizedTerm: string): boolean {
  if (!normalizedTerm) return false;
  const haystacks = [
    event.title,
    event.venue.name,
    ...event.artists.map((a) => a.name),
  ];
  return haystacks.some((value) => normalizeName(value).includes(normalizedTerm));
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
      }).catch(() => [] as RAListing[]),
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
 * Both directions are fetched in parallel — a search is one user action and
 * should not cost two round trips in series.
 */
export async function searchRAEvents(options: {
  term: string;
  areaId?: number;
  signal?: AbortSignal;
}): Promise<SearchResults> {
  const areaId = options.areaId ?? NYC_AREA_ID;
  const today = shiftDate(0);
  const normalized = normalizeName(options.term);

  // Forward and backward are paged differently, and the reason is not symmetry.
  //
  // RA returns a range in ascending date order, so paging one wide range gives
  // you its *earliest* listings. Ahead, that is exactly right — the soonest
  // events are the ones you want. Behind, it is precisely wrong: three pages of
  // a 60-day backward range returned events from two months ago while the gig
  // last week was never fetched, which is the opposite of "when did they last
  // play". So the backward direction is split into consecutive sub-windows and
  // the nearest one is fetched first.
  const [ahead, behind] = await Promise.all([
    collect(
      Array.from({ length: SEARCH_PAGES }, (_, i) => ({
        from: today,
        to: shiftDate(SEARCH_WINDOW_DAYS),
        page: i + 1,
      })),
      areaId,
      options.signal,
    ),
    collect(
      PAST_BOUNDARIES.slice(1).flatMap((edge, i) => {
        const range = { from: shiftDate(-edge), to: shiftDate(-PAST_BOUNDARIES[i]!) };
        // Two pages for the nearest window, one for the rest. Four days of NYC
        // is ~125 listings against a 100-row page, so a single page stopped a
        // day or two short — which is exactly the day or two anyone searching
        // for a past gig cares about most.
        return i === 0
          ? [{ ...range, page: 1 }, { ...range, page: 2 }]
          : [{ ...range, page: 1 }];
      }),
      areaId,
      options.signal,
    ),
  ]);

  const matching = (bucket: RAEvent[]) =>
    bucket.filter((event) => matchesTerm(event, normalized));

  // An event on today's date can arrive from both windows; treat it as upcoming
  // and keep it out of the past list rather than showing it twice.
  const upcoming = matching(ahead.events)
    .filter((event) => (event.date.slice(0, 10) ?? "") >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, SEARCH_LIMIT);

  const upcomingIds = new Set(upcoming.map((event) => event.id));
  const past = matching(behind.events)
    .filter((event) => !upcomingIds.has(event.id) && event.date.slice(0, 10) < today)
    // Most recent first: the last time someone played is more interesting than
    // the first.
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, SEARCH_LIMIT);

  return { upcoming, past, truncated: ahead.full || behind.full };
}
