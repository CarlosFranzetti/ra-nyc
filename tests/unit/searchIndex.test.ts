import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The index half of search, with the database stubbed.
 *
 * Every other test in this repo runs with no `DATABASE_URL`, which is the right
 * default — the index is a cache and the app has to work without it. But it
 * means those tests exercise exactly one of the two code paths, and the bug
 * this file exists for lives entirely in the other one.
 *
 * That is not a hypothetical. The first version of this regression test was
 * written against the normal harness, passed against the *unfixed* code, and
 * proved nothing at all: with no database both `searchCachedEvents` and
 * `recentCachedEvents` return empty, so the gate that was the whole bug could
 * never be reached. A test that cannot fail is worse than no test.
 */

const indexed: Record<string, unknown>[] = [];

vi.mock("../../api/_lib/eventCache.js", () => {
  // What SQL does with a window and a row limit, which the mock has to do too:
  // a limit applied *before* ordering, or a window that is ignored, would make
  // every test below pass for the wrong reason.
  const dayOf = (row: unknown) => String((row as { date: string }).date).slice(0, 10);
  const days = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
  const inWindow = (row: unknown, from: string, to: string) =>
    dayOf(row) >= from && dayOf(row) <= to;
  const stale = (row: unknown, term: string) =>
    String((row as { staleKey: string }).staleKey).includes(
      term.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );

  return {
    cacheEvents: vi.fn(async () => {}),
    searchCachedEvents: vi.fn(
      async ({ term, from, to, limit, today }: {
        term: string;
        from: string;
        to: string;
        limit: number;
        today: string;
      }) => {
        // Stands in for SQL `like '%search_key%'`, and models the two ways that
        // column falls behind the row it belongs to:
        //
        // 1. It is substring-only. No edit distance — SQL cannot do that.
        // 2. It is a *snapshot*. `search_key` is computed when a row is written,
        //    so an event indexed before its lineup was announced — which is most
        //    of them, RA adds DJs later — carries a key with no DJ names in it
        //    until something re-fetches that day. The `artists` column is right;
        //    the key is stale.
        //
        // Rows here therefore expose a `staleKey` built from title and venue
        // only, while `artists` holds the real lineup. That gap is exactly where
        // the gig this file is named for went missing.
        const events = indexed
          .filter((e) => inWindow(e, from, to) && stale(e, term))
          // `order by abs(event_date - today)`, then `limit`.
          .sort(
            (a, b) =>
              Math.abs(days(dayOf(a)) - days(today)) - Math.abs(days(dayOf(b)) - days(today)),
          )
          .slice(0, limit);
        return { events, daysCovered: 151 };
      },
    ),
    // `order by event_date desc limit n`.
    searchOlderCachedEvents: vi.fn(
      async ({ term, from, to, limit }: {
        term: string;
        from: string;
        to: string;
        limit: number;
      }) =>
        indexed
          .filter((e) => inWindow(e, from, to) && stale(e, term))
          .sort((a, b) => dayOf(b).localeCompare(dayOf(a)))
          .slice(0, limit),
    ),
    olderCoverage: vi.fn(async ({ from, to }: { from: string; to: string }) => {
      const held = indexed.map(dayOf).filter((d) => d >= from && d <= to).sort();
      return { days: new Set(held).size, oldest: held[0] ?? null };
    }),
    recentCachedEvents: vi.fn(async ({ from, to }: { from: string; to: string }) =>
      indexed.filter((e) => inWindow(e, from, to)),
    ),
  };
});

const cache = await import("../../api/_lib/eventCache.js");
const { searchRAEvents, SEARCH_AHEAD_DAYS, SEARCH_BEHIND_DAYS, SEARCH_LIMIT } = await import(
  "../../api/_lib/ra.js"
);

/** A New York calendar day, `offset` days from today — see ra.test.ts for why. */
const day = (offset: number) =>
  new Date(
    Date.parse(
      `${new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(Date.now())}T00:00:00Z`,
    ) +
      offset * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

const event = (id: string, title: string, offset: number, artists: string[] = []) => ({
  id,
  title,
  // What the index would have stored when this row was first written.
  staleKey: `${title} Bossa Nova Civic Club`.toLowerCase().replace(/[^a-z0-9]/g, ""),
  date: `${day(offset)}T00:00:00.000`,
  startTime: `${day(offset)}T22:00:00.000`,
  endTime: "",
  url: `https://ra.co/events/${id}`,
  imageUrl: null,
  venue: { name: "Bossa Nova Civic Club", area: "New York" },
  artists: artists.map((name, i) => ({ id: `${id}-a${i}`, name })),
  attending: 10,
  isPick: false,
  pickBlurb: null,
});

beforeEach(() => {
  // Frozen at midday New York so no test here depends on the hour it runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-28T16:00:00Z"));
  vi.clearAllMocks();
  indexed.length = 0;
  // RA itself answers with nothing, so every hit below comes from the index.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ data: { eventListings: { data: [], totalResults: 0 } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ids = (r: { upcoming: { id: string }[]; past: { id: string }[] }) =>
  new Set([...r.upcoming, ...r.past].map((e) => e.id));

describe("the exact spelling is never weaker than a typo", () => {
  it("finds an indexed gig that a decoy hit used to hide", async () => {
    // The reported symptom: a friend played last week, "sergio" found nothing,
    // and "aergio" found him. Both events are in the index; only the decoy is
    // reachable by SQL substring for the *correct* spelling, and the old code
    // stopped as soon as anything at all matched.
    indexed.push(
      // Announced as "Bossa Friday" with no lineup, so the stored key has no
      // "sergio" in it — but the row's artists column does.
      event("gig", "Bossa Friday", -6, ["Sergio", "Reade Truth"]),
      event("decoy", "Sergio Mendes tribute", 3),
    );

    const right = await searchRAEvents({ term: "sergio" });
    expect(ids(right)).toContain("gig");
    expect(ids(right)).toContain("decoy");
  });

  it("holds for any term: the typo can never reach more", async () => {
    indexed.push(
      event("gig", "Bossa Friday", -6, ["Sergio", "Reade Truth"]),
      event("decoy", "Sergio Mendes tribute", 3),
    );

    const right = ids(await searchRAEvents({ term: "sergio" }));
    const typo = ids(await searchRAEvents({ term: "sergioo" }));

    for (const id of typo) expect(right).toContain(id);
  });

  it("still reaches a gig only an edit-distance pass can match", async () => {
    indexed.push(event("gig", "Late one", -9, ["Reade Truth"]));
    const hits = ids(await searchRAEvents({ term: "reade truthh" }));
    expect(hits).toContain("gig");
  });
});

describe("an indexed past event is reported as past", () => {
  /**
   * The upcoming/past split, which is a *string* comparison against today.
   *
   * Worth stating what this does and does not cover, because the obvious
   * reading is wrong. It does not guard the `isoDay` bug that prompted it —
   * eventCache is mocked here, so `toEvent` never runs and these fixtures hand
   * over well-formed ISO dates that no version of that function could mangle.
   * Sabotaging `isoDay` leaves every test in this file green.
   *
   * What it guards is the split itself: that an event dated three months ago
   * is filed under past. `isoDay` is tested directly in eventCacheDates.test.ts,
   * where it bites.
   */
  it("does not file a gig from three months ago under upcoming", async () => {
    indexed.push(event("old", "Winter closing party", -90, ["Matias Jofre"]));

    const { upcoming, past } = await searchRAEvents({ term: "jofre" });

    expect(past.map((e) => e.id)).toContain("old");
    expect(upcoming.map((e) => e.id)).not.toContain("old");
  });

  it("finds a two-word name by either half", async () => {
    indexed.push(event("gig", "Winter closing party", -70, ["Matias Jofre"]));

    for (const term of ["matias", "jofre", "matias jofre"]) {
      const hits = await searchRAEvents({ term });
      expect(
        [...hits.upcoming, ...hits.past].map((e) => e.id),
        `searching "${term}"`,
      ).toContain("gig");
    }
  });

  it("finds it through a typo in the first letter", async () => {
    // The reported case: "natias" is one substitution from "Matias".
    indexed.push(event("gig", "Winter closing party", -70, ["Matias Jofre"]));

    const hits = await searchRAEvents({ term: "natias" });
    expect([...hits.upcoming, ...hits.past].map((e) => e.id)).toContain("gig");
  });
});

describe("vibe words reach the index", () => {
  it("finds an afterhours party from the word after", async () => {
    indexed.push(event("dawn", "Sunrise session", -2));  // vocabulary, not substring
    // "sunrise" shares no substring with "after"; only the vocabulary connects
    // them, and it has to survive the round trip through the index path.
    expect(ids(await searchRAEvents({ term: "after" }))).toContain("dawn");
  });
});

/**
 * The older band: five years of nights somebody once browsed, read only when the
 * recent past has too little to show.
 */
describe("search reads history when the recent past is thin", () => {
  const retro = (n: number, offset: number) =>
    event(`retro-${n}`, `Retro party ${n}`, offset);

  it("does not run the older query when the recent past already has ten hits", async () => {
    for (let i = 1; i <= 10; i += 1) indexed.push(retro(i, -i));
    indexed.push(retro(99, -500));

    const { past } = await searchRAEvents({ term: "retro" });

    expect(cache.searchOlderCachedEvents).not.toHaveBeenCalled();
    expect(past).toHaveLength(10);
    expect(past.map((e) => e.id)).not.toContain("retro-99");
  });

  it("runs it, from five years back, when the recent past has fewer than ten", async () => {
    for (let i = 1; i <= 9; i += 1) indexed.push(retro(i, -i));
    indexed.push(retro(99, -500));

    const { past } = await searchRAEvents({ term: "retro" });

    expect(cache.searchOlderCachedEvents).toHaveBeenCalledTimes(1);
    expect(cache.searchOlderCachedEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        from: day(-1825),
        // The day after the recent band ends, so the two never overlap.
        to: day(-(SEARCH_BEHIND_DAYS + 1)),
        limit: SEARCH_LIMIT + 1,
      }),
    );
    // Recent first, then the old one, in one newest-first list.
    expect(past.map((e) => e.id)).toEqual([
      ...Array.from({ length: 9 }, (_, i) => `retro-${i + 1}`),
      "retro-99",
    ]);
  });

  it("finds a gig from four years ago when nothing recent matches", async () => {
    indexed.push(retro(1, -1460));
    const { past, upcoming } = await searchRAEvents({ term: "retro" });
    expect(past.map((e) => e.id)).toEqual(["retro-1"]);
    expect(upcoming).toHaveLength(0);
  });

  it("keeps the recent-band queries on the recent band", async () => {
    await searchRAEvents({ term: "retro" });
    const band = expect.objectContaining({
      from: day(-SEARCH_BEHIND_DAYS),
      to: day(SEARCH_AHEAD_DAYS),
      today: day(0),
    });
    expect(cache.searchCachedEvents).toHaveBeenCalledWith(band);
    // The fuzzy scan reads rows into memory: five years of them per search is
    // exactly what must not happen.
    expect(cache.recentCachedEvents).toHaveBeenCalledWith(band);
  });

  it("returns the newest sixty of 300 matches spread over 1,800 days", async () => {
    for (let i = 0; i < 300; i += 1) indexed.push(retro(i, -(125 + Math.floor(i * 5.6))));

    const { past, truncated } = await searchRAEvents({ term: "retro" });

    expect(past).toHaveLength(SEARCH_LIMIT);
    const dates = past.map((e) => e.date.slice(0, 10));
    expect(dates).toEqual([...dates].sort().reverse());
    // The newest sixty, not any sixty: row i is dated by ascending age.
    expect(past.map((e) => e.id)).toEqual(
      Array.from({ length: SEARCH_LIMIT }, (_, i) => `retro-${i}`),
    );
    expect(truncated).toBe(true);
  });

  it("says the list was cut when the older query came back with 121 rows behind it", async () => {
    for (let i = 0; i < 121; i += 1) indexed.push(retro(i, -(125 + i)));
    const result = await searchRAEvents({ term: "retro" });
    expect(result.past).toHaveLength(SEARCH_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("does not claim a cut when the older band was read to the end", async () => {
    for (let i = 0; i < 30; i += 1) indexed.push(retro(i, -(125 + i)));
    const result = await searchRAEvents({ term: "retro" });
    expect(result.past).toHaveLength(30);
    expect(result.truncated).toBe(false);
  });

  it("reports what the older band holds, once, whether or not it was read", async () => {
    for (let i = 1; i <= 10; i += 1) indexed.push(retro(i, -i));
    indexed.push(retro(98, -400), retro(99, -900));

    const { older } = await searchRAEvents({ term: "retro" });

    expect(cache.olderCoverage).toHaveBeenCalledTimes(1);
    expect(older).toEqual({ days: 2, oldest: day(-900) });
  });

  it("reports null when there is no database to ask", async () => {
    vi.mocked(cache.olderCoverage).mockResolvedValueOnce(null);
    expect((await searchRAEvents({ term: "retro" })).older).toBeNull();
  });
});
