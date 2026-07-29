/**
 * Server-side client for the Resident Advisor GraphQL endpoint.
 *
 * This runs on Vercel (or in the Vite dev middleware), never in the browser:
 * ra.co does not send CORS headers, and the `User-Agent` / `Referer` headers it
 * expects are forbidden headers that browsers silently strip from fetch().
 */

export const RA_GRAPHQL_URL = "https://ra.co/graphql";

/** RA's internal area id for New York City. */
export const NYC_AREA_ID = 8;

export interface RAEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  contentUrl: string;
  images: { filename: string }[];
  venue: { name: string; area: { name: string } | null } | null;
  artists: { id: string; name: string }[];
  pick: { blurb: string } | null;
}

const EVENT_LISTINGS_QUERY = `
  query GET_DEFAULT_EVENTS_LISTING(
    $filters: FilterInputDtoInput
    $pageSize: Int
  ) {
    eventListings(filters: $filters, pageSize: $pageSize, page: 1) {
      data {
        event {
          id
          title
          date
          startTime
          endTime
          contentUrl
          images {
            filename
          }
          venue {
            name
            area {
              name
            }
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
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Referer: "https://ra.co/events/us/newyorkcity",
      Origin: "https://ra.co",
    },
    body: JSON.stringify({
      operationName: "GET_DEFAULT_EVENTS_LISTING",
      query: EVENT_LISTINGS_QUERY,
      variables: {
        filters: {
          areas: { eq: areaId },
          listingDate: { gte: date, lte: date },
        },
        pageSize,
      },
    }),
    signal,
  });

  if (!res.ok) {
    throw new RAError(`Resident Advisor responded with ${res.status}`, 502);
  }

  const json = (await res.json()) as {
    data?: { eventListings?: { data?: { event: RAEvent }[] } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new RAError(json.errors[0]?.message ?? "GraphQL error", 502);
  }

  return (json.data?.eventListings?.data ?? []).map((listing) => listing.event);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Guards against passing arbitrary user input into the upstream filter. */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}
