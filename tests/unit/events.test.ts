import type { IncomingMessage, ServerResponse } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/events` called as Vercel calls it: a Node request in, a Node response
 * out, with the index and RA both stubbed.
 *
 * The validation here is what keeps the durable index from growing in directions
 * nobody reads — a city that is not served, a date outside the five years kept —
 * so the property worth testing is not only the status code but that nothing was
 * fetched and nothing was written when the answer was no.
 */

vi.mock("../../api/_lib/eventCache.js", () => ({
  cacheEvents: vi.fn(async () => {}),
  cachedEventsForDay: vi.fn(async () => []),
}));

const cache = await import("../../api/_lib/eventCache.js");
const { default: handler } = await import("../../api/events.js");

const NOW = "2026-10-28T16:00:00Z"; // midday in New York, 28 October
const TODAY = "2026-10-28";

const dayFrom = (offset: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** A distinct client each call, so the per-IP limiter never gets involved. */
let caller = 0;

async function get(query: string, ip = `10.0.0.${(caller += 1)}`) {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = String(value);
    },
    end: (chunk?: string) => {
      res.body = chunk ?? "";
    },
    body: "",
  };
  const req = {
    method: "GET",
    url: `/api/events?${query}`,
    headers: { "x-forwarded-for": ip },
    socket: {},
  };
  await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  return {
    status: res.statusCode,
    headers,
    json: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : {},
  };
}

/** RA answering with one event on the requested day. */
function stubRA() {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const { gte } = JSON.parse(init.body).variables.filters.listingDate;
    return {
      ok: true,
      json: async () => ({
        data: {
          eventListings: {
            totalResults: 1,
            data: [
              {
                id: "l-1",
                listingDate: `${gte}T00:00:00.000`,
                event: {
                  id: "e-1",
                  title: "A night",
                  attending: 10,
                  date: `${gte}T00:00:00.000`,
                  startTime: `${gte}T22:00:00.000`,
                  endTime: null,
                  contentUrl: "/events/1",
                  flyerFront: null,
                  images: null,
                  venue: { id: "v", name: "Nowadays", contentUrl: "/v" },
                  artists: [],
                  pick: null,
                },
              },
            ],
          },
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(NOW));
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("area allowlist", () => {
  it("serves New York, named or by default", async () => {
    stubRA();
    expect((await get(`date=${TODAY}`)).status).toBe(200);
    expect((await get(`date=${TODAY}&area=8`)).status).toBe(200);
  });

  it("refuses any other area before RA is asked or the index is written", async () => {
    const fetchMock = stubRA();
    const { status, json } = await get(`date=${TODAY}&area=9`);

    expect(status).toBe(400);
    expect(String(json.error)).toContain("area");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.cacheEvents).not.toHaveBeenCalled();
  });

  it("still refuses a value that is not a positive integer", async () => {
    const fetchMock = stubRA();
    for (const area of ["abc", "0", "-8", "8.5"]) {
      const { status, json } = await get(`date=${TODAY}&area=${area}`);
      expect(status, `area=${area}`).toBe(400);
      expect(json.error).toBe("Query param `area` must be a positive integer");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.cacheEvents).not.toHaveBeenCalled();
  });
});

describe("date validation", () => {
  it("names a malformed date as malformed", async () => {
    stubRA();
    for (const date of ["2026-8-2", "tomorrow", "2026-02-30"]) {
      const { status, json } = await get(`date=${date}`);
      expect(status, date).toBe(400);
      expect(json.error).toBe("Query param `date` must be YYYY-MM-DD");
    }
    expect((await get("")).json.error).toBe("Query param `date` must be YYYY-MM-DD");
  });

  it("names a date outside the kept range as out of range, and writes nothing", async () => {
    const fetchMock = stubRA();
    for (const offset of [-1826, 366]) {
      const { status, json } = await get(`date=${dayFrom(offset)}`);
      expect(status, `offset ${offset}`).toBe(400);
      expect(json.error).toBe(
        "Query param `date` is outside the range this app keeps (five years back, one year ahead)",
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.cacheEvents).not.toHaveBeenCalled();
  });

  it("accepts both edges of the kept range", async () => {
    stubRA();
    expect((await get(`date=${dayFrom(-1825)}`)).status).toBe(200);
    expect((await get(`date=${dayFrom(365)}`)).status).toBe(200);
  });

  it("indexes a day it fetched", async () => {
    stubRA();
    await get(`date=${dayFrom(-900)}`);
    expect(cache.cacheEvents).toHaveBeenCalledTimes(1);
  });
});

describe("edge cache header", () => {
  const SETTLED = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000";
  const LIVE = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

  it("keeps a settled night for a week at the edge", async () => {
    stubRA();
    expect((await get(`date=${dayFrom(-8)}`)).headers["cache-control"]).toBe(SETTLED);
    expect((await get(`date=${dayFrom(-1825)}`)).headers["cache-control"]).toBe(SETTLED);
  });

  it("leaves the last week and everything ahead on the short header", async () => {
    stubRA();
    // Exactly seven days back is not "more than seven".
    for (const offset of [-7, -1, 0, 1, 365]) {
      expect(
        (await get(`date=${dayFrom(offset)}`)).headers["cache-control"],
        `offset ${offset}`,
      ).toBe(LIVE);
    }
  });

  it("decides 'a week ago' by the New York day, not the UTC one", async () => {
    // 01:00 UTC on the 29th is the evening of the 28th in New York: the 21st is
    // exactly seven days back there, not eight.
    vi.setSystemTime(Date.parse("2026-10-29T01:00:00Z"));
    stubRA();
    expect((await get("date=2026-10-21")).headers["cache-control"]).toBe(LIVE);
    expect((await get("date=2026-10-20")).headers["cache-control"]).toBe(SETTLED);
  });

  it("does not let a degraded answer for an old day sit at the edge for a week", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.mocked(cache.cachedEventsForDay).mockResolvedValueOnce([
      {
        id: "e-1",
        title: "Old",
        date: dayFrom(-900),
        startTime: "",
        endTime: "",
        url: "",
        imageUrl: null,
        venue: { id: null, name: "Nowadays", area: "New York" },
        artists: [],
        attending: 0,
        isPick: false,
        pickBlurb: null,
      },
    ]);
    const { status, headers, json } = await get(`date=${dayFrom(-900)}`);
    expect(status).toBe(200);
    expect(json.stale).toBe(true);
    expect(headers["cache-control"]).toBe("public, max-age=30, s-maxage=60");
  });

  it("keeps a rate-limited answer out of every cache", async () => {
    stubRA();
    const ip = "203.0.113.9";
    let last = await get(`date=${dayFrom(-900)}`, ip);
    for (let i = 0; i < 30; i += 1) last = await get(`date=${dayFrom(-900)}`, ip);
    expect(last.status).toBe(429);
    expect(last.headers["cache-control"]).toBe("no-store");
  });
});
