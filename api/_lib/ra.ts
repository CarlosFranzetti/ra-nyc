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

export async function fetchRAEvents({
  date,
  areaId = NYC_AREA_ID,
  pageSize = 50,
  signal,
}: FetchEventsOptions): Promise<RAEvent[]> {
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
          areas: { eq: areaId },
          listingDate: { gte: date, lte: date },
        },
        pageSize,
        page: 1,
      },
    }),
    signal,
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

  return (
    dedupeById(
      (json.data?.eventListings?.data ?? []).map(transformListing),
    )
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
