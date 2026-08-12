import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRAEvents,
  isValidDate,
  normalizeImageUrl,
  searchRAEvents,
  SEARCH_AHEAD_DAYS,
  SEARCH_BEHIND_DAYS,
} from "../../api/_lib/ra.js";

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** One RA listing row, in the shape the real API returns. */
function listing(options: {
  id: string;
  title?: string;
  date: string;
  start?: string | null;
  end?: string | null;
  venue?: string;
  artists?: string[];
}) {
  return {
    id: `l-${options.id}`,
    listingDate: `${options.date}T00:00:00.000`,
    event: {
      id: options.id,
      title: options.title ?? "A night",
      attending: 10,
      date: `${options.date}T00:00:00.000`,
      startTime:
        options.start === undefined ? `${options.date}T22:00:00.000` : options.start,
      endTime: options.end ?? null,
      contentUrl: `/events/${options.id}`,
      flyerFront: null,
      images: null,
      venue: { id: "v", name: options.venue ?? "Nowadays", contentUrl: "/v" },
      artists: (options.artists ?? []).map((name, i) => ({ id: `${options.id}${i}`, name })),
      pick: null,
    },
  };
}

/** Stubs RA, honouring the date range and page window it is asked for. */
function stubRA(
  rows: ReturnType<typeof listing>[],
  opts: { pageCap?: number; onRequest?: (range: { from: string; to: string }) => void } = {},
) {
  const cap = opts.pageCap ?? 100;
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    const { gte, lte } = body.variables.filters.listingDate;
    opts.onRequest?.({ from: gte, to: lte });
    const size = body.variables.pageSize;
    const page = body.variables.page;
    // RA errors on an oversized page rather than truncating — the behaviour
    // that made a bad pageSize look like "this artist has no gigs".
    if (size > cap) return { ok: false, status: 400, json: async () => ({}) };
    const inRange = rows
      .filter((r) => {
        const d = r.event.date.slice(0, 10);
        return d >= gte && d <= lte;
      })
      .sort((a, b) => a.event.date.localeCompare(b.event.date));
    return {
      ok: true,
      json: async () => ({
        data: { eventListings: { data: inRange.slice((page - 1) * size, page * size) } },
      }),
    };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("normalizeImageUrl", () => {
  it("passes absolute URLs through", () => {
    expect(normalizeImageUrl("https://images.ra.co/a.jpg")).toBe(
      "https://images.ra.co/a.jpg",
    );
  });

  it("gives protocol-relative URLs a scheme", () => {
    expect(normalizeImageUrl("//images.ra.co/a.jpg")).toBe("https://images.ra.co/a.jpg");
  });

  it("prefixes a bare filename", () => {
    expect(normalizeImageUrl("a.jpg")).toBe("https://images.ra.co/a.jpg");
  });

  // The case that broke flyers: a value already containing the host but with no
  // scheme. Prefixing unconditionally produced images.ra.co/images.ra.co/…
  it("does not double the host when it is already there", () => {
    expect(normalizeImageUrl("images.ra.co/a.jpg")).toBe("https://images.ra.co/a.jpg");
  });
});

describe("isValidDate", () => {
  it("accepts a well-formed nearby date", () => {
    expect(isValidDate(day(0))).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isValidDate("2026-8-2")).toBe(false);
    expect(isValidDate("tomorrow")).toBe(false);
    expect(isValidDate("")).toBe(false);
  });

  it("rejects dates more than a year out, which bounds the cache key space", () => {
    expect(isValidDate(day(400))).toBe(false);
    expect(isValidDate(day(-400))).toBe(false);
  });
});

describe("fetchRAEvents — the repeating-event rule", () => {
  it("drops a multi-day residency from days it does not start on", async () => {
    stubRA([
      // "Bear Happy Hour at Rawhide": one event, listed 30 Jul → 6 Aug.
      listing({ id: "res", date: "2026-07-30", start: "2026-07-30T18:00:00.000", end: "2026-08-06T22:00:00.000" }),
      listing({ id: "tonight", date: "2026-08-02" }),
    ]);
    const ids = (await fetchRAEvents({ date: "2026-08-02" })).map((e) => e.id);
    expect(ids).toContain("tonight");
    expect(ids).not.toContain("res");
  });

  it("still shows the residency on its own start date", async () => {
    stubRA([
      listing({ id: "res", date: "2026-07-30", start: "2026-07-30T18:00:00.000", end: "2026-08-06T22:00:00.000" }),
    ]);
    const ids = (await fetchRAEvents({ date: "2026-07-30" })).map((e) => e.id);
    expect(ids).toContain("res");
  });

  // The case the rule must not break: a club night is Saturday's, not Sunday's.
  it("keeps a night that starts late and ends after midnight", async () => {
    stubRA([
      listing({ id: "club", date: "2026-08-01", start: "2026-08-01T22:00:00.000", end: "2026-08-02T04:00:00.000" }),
    ]);
    expect((await fetchRAEvents({ date: "2026-08-01" })).map((e) => e.id)).toContain("club");
    expect((await fetchRAEvents({ date: "2026-08-02" })).map((e) => e.id)).not.toContain("club");
  });

  it("fails open: an event with no start date is kept, not silently dropped", async () => {
    stubRA([listing({ id: "nostart", date: "2026-08-02", start: null })]);
    expect((await fetchRAEvents({ date: "2026-08-02" })).map((e) => e.id)).toContain("nostart");
  });

  it("collapses duplicate listing rows for one event", async () => {
    stubRA([
      listing({ id: "dupe", date: "2026-08-02" }),
      listing({ id: "dupe", date: "2026-08-02" }),
    ]);
    const ids = (await fetchRAEvents({ date: "2026-08-02" })).map((e) => e.id);
    expect(ids.filter((id) => id === "dupe")).toHaveLength(1);
  });

  it("sorts busiest first", async () => {
    stubRA([listing({ id: "a", date: "2026-08-02" }), listing({ id: "b", date: "2026-08-02" })]);
    const events = await fetchRAEvents({ date: "2026-08-02" });
    expect(events.every((e, i) => i === 0 || events[i - 1]!.attending >= e.attending)).toBe(true);
  });
});

describe("searchRAEvents", () => {
  const corpus = [
    listing({ id: "f1", title: "Uzuri presents", date: day(5), artists: ["Lakuti", "Tama Sumo"] }),
    listing({ id: "f2", title: "Techno Tuesday", date: day(30), venue: "Bossa Nova Civic Club" }),
    listing({ id: "f3", title: "Björk DJ set", date: day(9), venue: "Elsewhere", artists: ["Björk"] }),
    listing({ id: "f4", title: "Basement rave", date: day(6), venue: "h0l0" }),
    listing({ id: "t1", title: "Tonight", date: day(0), artists: ["Lakuti"] }),
    listing({ id: "p1", title: "Old Uzuri", date: day(-2), artists: ["Lakuti"] }),
    listing({ id: "p2", title: "Ancient", date: day(-30), artists: ["Lakuti"] }),
  ];

  it("matches a lineup, a venue and a promoter in the title", async () => {
    stubRA(corpus);
    expect((await searchRAEvents({ term: "lakuti" })).upcoming.map((e) => e.id)).toContain("f1");
    expect((await searchRAEvents({ term: "bossa nova" })).upcoming.map((e) => e.id)).toContain("f2");
    expect((await searchRAEvents({ term: "uzuri" })).upcoming.map((e) => e.id)).toContain("f1");
  });

  it("is accent-insensitive", async () => {
    stubRA(corpus);
    expect((await searchRAEvents({ term: "bjork" })).upcoming.map((e) => e.id)).toContain("f3");
  });

  // The requested case: nobody types h0l0 with zeroes.
  it("finds h0l0 when you type holo", async () => {
    stubRA(corpus);
    expect((await searchRAEvents({ term: "holo" })).upcoming.map((e) => e.id)).toContain("f4");
  });

  it("tolerates a one-letter typo", async () => {
    stubRA(corpus);
    expect((await searchRAEvents({ term: "lakuki" })).upcoming.map((e) => e.id)).toContain("f1");
  });

  it("does not fuzzy-match short terms into everything", async () => {
    stubRA(corpus);
    const { upcoming, past } = await searchRAEvents({ term: "abcd" });
    expect(upcoming).toHaveLength(0);
    expect(past).toHaveLength(0);
  });

  it("orders upcoming soonest-first and past most-recent-first", async () => {
    stubRA(corpus);
    const { upcoming, past } = await searchRAEvents({ term: "lakuti" });
    expect(upcoming.map((e) => e.id)).toEqual(["t1", "f1"]);
    expect(past.map((e) => e.id)).toEqual(["p1", "p2"]);
  });

  it("counts today as upcoming and never lists an event twice", async () => {
    stubRA(corpus);
    const { upcoming, past } = await searchRAEvents({ term: "lakuti" });
    expect(upcoming.map((e) => e.id)).toContain("t1");
    expect(past.map((e) => e.id)).not.toContain("t1");
    expect(upcoming.every((e) => !past.some((p) => p.id === e.id))).toBe(true);
  });

  it("returns nothing rather than everything when there is no match", async () => {
    stubRA(corpus);
    const { upcoming, past } = await searchRAEvents({ term: "qqqqzzz" });
    expect(upcoming).toHaveLength(0);
    expect(past).toHaveLength(0);
  });

  // RA rejects an oversized page rather than truncating it. Asking for one
  // emptied every window while looking exactly like "no results".
  it("never requests a page size RA rejects", async () => {
    stubRA(corpus, { pageCap: 100 });
    const { upcoming } = await searchRAEvents({ term: "lakuti" });
    expect(upcoming.length).toBeGreaterThan(0);
  });

  // The bug this guards: the widened in-memory pass used to be gated on
  // "nothing matched yet", so a term that found one irrelevant hit never got
  // it — while a *misspelt* term, finding nothing, did. The exact spelling was
  // strictly weaker than the typo, which is how "search cannot find my friend
  // but finds him if I spell it wrong" happens.
  it("does not let a typo out-search the correct spelling", async () => {
    const gig = listing({ id: "sergio-1", title: "Sergio b2b Reade Truth", date: day(-6) });
    // A decoy the correct spelling also matches, so the old gate would clear.
    const decoy = listing({ id: "decoy", title: "Sergio Mendes tribute", date: day(2) });
    stubRA([...corpus, gig, decoy]);

    const right = await searchRAEvents({ term: "sergio" });
    const wrong = await searchRAEvents({ term: "sergioo" });

    const ids = (r: { upcoming: RAEvent[]; past: RAEvent[] }) =>
      new Set([...r.upcoming, ...r.past].map((e) => e.id));

    expect(ids(right)).toContain("sergio-1");
    // Whatever the typo can reach, the correct spelling must reach too.
    for (const id of ids(wrong)) expect(ids(right)).toContain(id);
  });

  it("fetches the last ten days one at a time, not as a sample", async () => {
    // Ten percent of a ten-day range is what "I played last Friday and search
    // cannot find me" looks like from the outside.
    const ranges: { from: string; to: string }[] = [];
    stubRA(corpus, { onRequest: (r) => ranges.push(r) });
    await searchRAEvents({ term: "lakuti" });

    for (let d = 1; d <= 10; d += 1) {
      const single = day(-d);
      expect(
        ranges.some((r) => r.from === single && r.to === single),
        `day -${d} fetched exactly`,
      ).toBe(true);
    }
  });

  it("looks a month ahead and four months back", async () => {
    const ranges: { from: string; to: string }[] = [];
    stubRA(corpus, { onRequest: (r) => ranges.push(r) });
    await searchRAEvents({ term: "lakuti" });

    const furthestAhead = ranges.map((r) => r.to).sort().at(-1)!;
    const furthestBack = ranges.map((r) => r.from).sort()[0]!;
    expect(furthestAhead).toBe(day(SEARCH_AHEAD_DAYS));
    expect(furthestBack).toBe(day(-SEARCH_BEHIND_DAYS));
  });

  it("reports how much of the window the index actually holds", async () => {
    // Without a database the index holds nothing, and saying so is the point:
    // a ninety-day search answered from three days of live listings is not a
    // complete answer and must not read like one.
    stubRA(corpus);
    const { coverage } = await searchRAEvents({ term: "lakuti" });
    expect(coverage.window).toBe(SEARCH_AHEAD_DAYS + SEARCH_BEHIND_DAYS + 1);
    expect(coverage.indexed).toBe(0);
  });

  it("still works with no database at all", async () => {
    // The index is a cache, not a dependency. DATABASE_URL is unset in tests,
    // so every assertion in this file already runs on the fallback path — this
    // one just says so out loud.
    stubRA(corpus);
    const { upcoming, past } = await searchRAEvents({ term: "lakuti" });
    expect(upcoming.length).toBeGreaterThan(0);
    expect(past.length).toBeGreaterThan(0);
  });

  // NYC generates ~100 listing rows a day. Paging one wide backward range hands
  // back its oldest listings, so "when did they last play" answered with June.
  it("reaches the last few days in a city with a hundred listings a day", async () => {
    const busy = [];
    for (let d = -60; d <= 0; d += 1) {
      for (let i = 0; i < 100; i += 1) {
        busy.push(
          listing({ id: `b${d}_${i}`, title: i === 0 ? "Lakuti night" : `Filler ${i}`, date: day(d) }),
        );
      }
    }
    stubRA(busy);
    const { past } = await searchRAEvents({ term: "lakuti" });
    expect(past[0]!.date.slice(0, 10)).toBe(day(-1));
  });
});
