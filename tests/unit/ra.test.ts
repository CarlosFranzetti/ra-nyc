import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRAEvents,
  isValidDate,
  newYorkDay,
  normalizeImageUrl,
  searchRAEvents,
  SEARCH_AHEAD_DAYS,
  SEARCH_BEHIND_DAYS,
  type RAEvent,
} from "../../api/_lib/ra.js";

/**
 * A New York calendar day, `offset` days from today.
 *
 * Asks `Intl` for the zone directly (`en-CA` happens to print ISO order) rather
 * than going through `newYorkDay`, so these tests are not checking the helper
 * against itself. The offset is applied to the date, in UTC, where days have no
 * DST. Between about 20:00 and midnight ET the UTC date is tomorrow, and the old
 * helper here — UTC all the way down — quietly agreed with the server's matching
 * mistake, which is how the bug survived.
 */
const nyToday = (at: number = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(at);

const day = (offset: number) =>
  new Date(Date.parse(`${nyToday()}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

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
  opts: {
    pageCap?: number;
    onRequest?: (range: { from: string; to: string; page: number }) => void;
  } = {},
) {
  const cap = opts.pageCap ?? 100;
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    const { gte, lte } = body.variables.filters.listingDate;
    const size = body.variables.pageSize;
    const page = body.variables.page;
    opts.onRequest?.({ from: gte, to: lte, page });
    // RA errors on an oversized page rather than truncating — the behaviour
    // that made a bad pageSize look like "this artist has no gigs".
    if (size > cap) return { ok: false, status: 400, json: async () => ({}) };
    // `listingDate`, not `event.date`: a listing can arrive with `event: null`
    // (the null-event test), and the stub has to be able to serve that row
    // rather than throw inside the fetch and make the window look dead.
    const inRange = rows
      .filter((r) => {
        const d = r.listingDate.slice(0, 10);
        return d >= gte && d <= lte;
      })
      .sort((a, b) => a.listingDate.localeCompare(b.listingDate));
    return {
      ok: true,
      json: async () => ({
        data: {
          eventListings: {
            data: inRange.slice((page - 1) * size, page * size),
            // The whole range's count, as RA reports it, not this page's.
            totalResults: inRange.length,
          },
        },
      }),
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("newYorkDay", () => {
  it("is the New York date, not the UTC one, in the evening", () => {
    // 01:00 UTC on the 29th is 21:00 EDT on the 28th.
    expect(newYorkDay(Date.parse("2026-10-29T01:00:00Z"))).toBe("2026-10-28");
  });

  it("follows daylight saving rather than a fixed offset", () => {
    // EDT (UTC-4) until 06:00 UTC on 1 Nov 2026, EST (UTC-5) after: midnight in
    // New York is 04:00 UTC before the change and 05:00 UTC after it.
    expect(newYorkDay(Date.parse("2026-10-31T03:59:00Z"))).toBe("2026-10-30");
    expect(newYorkDay(Date.parse("2026-10-31T04:00:00Z"))).toBe("2026-10-31");
    expect(newYorkDay(Date.parse("2026-12-01T04:59:00Z"))).toBe("2026-11-30");
    expect(newYorkDay(Date.parse("2026-12-01T05:00:00Z"))).toBe("2026-12-01");
  });
});

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

  // The bound moved from a year each way to five years back and one ahead: the
  // index now remembers every night somebody browses. It is still a bound — it
  // is what keeps the cache key space finite.
  it("keeps five years back and one year ahead", () => {
    expect(isValidDate(day(-400))).toBe(true);
    expect(isValidDate(day(400))).toBe(false);
    expect(isValidDate(day(-1825))).toBe(true);
    expect(isValidDate(day(-1826))).toBe(false);
    expect(isValidDate(day(365))).toBe(true);
    expect(isValidDate(day(366))).toBe(false);
  });

  it("measures the edges from the New York day, not the UTC one", () => {
    // 01:00 UTC on 29 Oct is still the 28th in New York, so the oldest day kept
    // is 1825 days before the 28th. Measured from UTC it would be a day later.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-29T01:00:00Z"));
    expect(isValidDate("2021-10-29")).toBe(true);
    expect(isValidDate("2021-10-28")).toBe(false);
    expect(isValidDate("2027-10-28")).toBe(true);
    expect(isValidDate("2027-10-29")).toBe(false);
  });

  it("rejects a day that does not exist rather than rolling it over", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
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

describe("fetchRAEvents — a busy night is fetched whole", () => {
  const night = (count: number) =>
    Array.from({ length: count }, (_, i) => listing({ id: `n${i}`, date: "2026-08-02" }));

  // `totalResults` was queried and never read, so any night with more rows than
  // one page lost its tail.
  it("follows totalResults: 100 rows of 140 means a second request, and 140 events", async () => {
    const pages: number[] = [];
    stubRA(night(140), { onRequest: (r) => pages.push(r.page) });
    const events = await fetchRAEvents({ date: "2026-08-02" });
    expect(pages.sort()).toEqual([1, 2]);
    expect(events).toHaveLength(140);
  });

  it("makes exactly one request when everything fits in the first page", async () => {
    const pages: number[] = [];
    stubRA(night(50), { onRequest: (r) => pages.push(r.page) });
    const events = await fetchRAEvents({ date: "2026-08-02" });
    expect(pages).toEqual([1]);
    expect(events).toHaveLength(50);
  });

  it("stops at three pages however many rows RA claims", async () => {
    const pages: number[] = [];
    stubRA(night(350), { onRequest: (r) => pages.push(r.page) });
    const events = await fetchRAEvents({ date: "2026-08-02" });
    expect(pages.sort()).toEqual([1, 2, 3]);
    expect(events).toHaveLength(300);
  });

  it("still applies the start-day rule across pages", async () => {
    // 120 rows, the last 20 of them a residency that began the day before: they
    // arrive on page 2 and must still be dropped.
    stubRA([
      ...night(100),
      ...Array.from({ length: 20 }, (_, i) =>
        listing({ id: `r${i}`, date: "2026-08-02", start: "2026-08-01T18:00:00.000" }),
      ),
    ]);
    expect(await fetchRAEvents({ date: "2026-08-02" })).toHaveLength(100);
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

  // A single RA listing with `event: null` took the whole search endpoint down
  // in production on 2026-10-26 — every query, for the minutes the row sat in
  // a live window. The map that transforms a page ran outside the per-window
  // catch, so one bad row was a TypeError for the request.
  it("survives a listing with no event instead of failing the whole search", async () => {
    const corpse = { id: "l-null", listingDate: `${day(4)}T00:00:00.000`, event: null };
    stubRA([...corpus, corpse as unknown as ReturnType<typeof listing>]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ids = (await searchRAEvents({ term: "lakuti" })).upcoming.map((e) => e.id);
    expect(ids).toContain("f1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no event"), "l-null");
    warn.mockRestore();
  });

  // Vocabulary expansions are words, and some are short. As substrings, "uk"
  // (under bass) matched Luke, "av" (under live) matched Dave, "unter" (under
  // queer) matched Hunter — so "live" returned a night that was not live.
  it("matches vocabulary expansions as whole words, not substrings", async () => {
    stubRA([
      listing({ id: "luke", title: "Luke Hess all night", date: day(3) }),
      listing({ id: "dave", title: "Unrelated night", date: day(3), artists: ["Dave Clark"] }),
      listing({ id: "hunt", title: "Hunter b2b Gunter", date: day(3) }),
      listing({ id: "garage", title: "Garage night", date: day(3) }),
      listing({ id: "band", title: "Live band on the roof", date: day(3) }),
    ]);
    const ids = async (term: string) =>
      (await searchRAEvents({ term })).upcoming.map((e) => e.id);
    expect(await ids("bass")).toEqual(["garage"]);
    expect(await ids("live")).toEqual(["band"]);
    expect(await ids("queer")).toEqual([]);
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

  /**
   * Typos in names whose *words* are all too short to fuzzy-match on their own.
   *
   * Both of these returned nothing, and for the same reason from opposite
   * sides. A word has to be five characters before a single edit is allowed to
   * match it — below that an edit matches half the city — and that filter ran
   * on the haystack as well as the query. So "Bossa Nova Civic Club"
   * contributed only "bossa" and "civic" to the pool, and "DJ Koze"
   * contributed *nothing at all*, making it unreachable by any typo whatever.
   *
   * Adjacent word pairs are now in the pool alongside single words, which is
   * long enough to be matchable while still being short enough that one edit
   * means something: "bossanova" is one edit from "bosanova", "djkoze" is one
   * from "djkose".
   */
  it("finds a two-short-word venue through a typo", async () => {
    stubRA(corpus);
    const hits = (await searchRAEvents({ term: "bosa nova" })).upcoming.map((e) => e.id);
    expect(hits).toContain("f2");
  });

  it("finds a two-short-word artist through a typo", async () => {
    stubRA([
      ...corpus,
      listing({ id: "k1", title: "Something", date: day(4), artists: ["DJ Koze"] }),
    ]);
    const hits = (await searchRAEvents({ term: "dj kose" })).upcoming.map((e) => e.id);
    expect(hits).toContain("k1");
  });

  /**
   * The other half of widening the pool: it must not have become a sieve.
   *
   * Pairs are longer than the words they are built from, so they are *harder*
   * to match by accident, not easier — but that is an argument, and this is the
   * check. Two edits away stays two edits away.
   */
  it("still refuses a two-edit miss", async () => {
    stubRA(corpus);
    const hits = (await searchRAEvents({ term: "bxsa nxva" })).upcoming.map((e) => e.id);
    expect(hits).not.toContain("f2");
  });

  it("does not match an unrelated name at all", async () => {
    stubRA(corpus);
    const { upcoming, past } = await searchRAEvents({ term: "peggy gou" });
    expect([...upcoming, ...past]).toHaveLength(0);
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

  // The server used the UTC date, so from 20:00 ET tonight's listings were
  // filed under past and the window began a day early. 01:00 UTC on the 29th is
  // 21:00 on the 28th in New York: the 28th is still tonight.
  it("keeps tonight upcoming in the New York evening, when UTC is already tomorrow", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-29T01:00:00Z"));
    stubRA([
      listing({ id: "tonight", title: "Tonight", date: "2026-10-28", artists: ["Lakuti"] }),
      listing({ id: "last", title: "Last night", date: "2026-10-27", artists: ["Lakuti"] }),
    ]);
    const { upcoming, past } = await searchRAEvents({ term: "lakuti" });
    expect(upcoming.map((e) => e.id)).toEqual(["tonight"]);
    expect(past.map((e) => e.id)).toEqual(["last"]);
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

  it("looks six weeks ahead and four months back", async () => {
    const ranges: { from: string; to: string }[] = [];
    stubRA(corpus, { onRequest: (r) => ranges.push(r) });
    await searchRAEvents({ term: "lakuti" });

    const furthestAhead = ranges.map((r) => r.to).sort().at(-1)!;
    const furthestBack = ranges.map((r) => r.from).sort()[0]!;
    expect(furthestAhead).toBe(day(SEARCH_AHEAD_DAYS));
    expect(furthestBack).toBe(day(-SEARCH_BEHIND_DAYS));
  });

  // The no-preload rule, pinned. Nothing a search does may ask RA about the
  // history beyond the window: those days are in the index only because a person
  // once browsed them, and a search that fetched them live would turn every
  // query into a crawl of five years.
  it("never asks RA for anything older than the search window", async () => {
    const ranges: { from: string; to: string }[] = [];
    stubRA(corpus, { onRequest: (r) => ranges.push(r) });
    await searchRAEvents({ term: "nothing matches this at all" });

    expect(ranges.length).toBeGreaterThan(0);
    for (const range of ranges) {
      expect(range.from >= day(-SEARCH_BEHIND_DAYS), `${range.from}..${range.to}`).toBe(true);
    }
  });

  it("reports no older band at all when there is no database", async () => {
    stubRA(corpus);
    expect((await searchRAEvents({ term: "lakuti" })).older).toBeNull();
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
