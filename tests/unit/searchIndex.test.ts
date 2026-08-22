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

vi.mock("../../api/_lib/eventCache.js", () => ({
  cacheEvents: vi.fn(async () => {}),
  searchCachedEvents: vi.fn(async ({ term }: { term: string }) => {
    // Stands in for SQL `like '%search_key%'`, and models the two ways that
    // column falls behind the row it belongs to:
    //
    // 1. It is substring-only. No edit distance — SQL cannot do that.
    // 2. It is a *snapshot*. `search_key` is computed when a row is written, so
    //    an event indexed before its lineup was announced — which is most of
    //    them, RA adds DJs later — carries a key with no DJ names in it until
    //    something re-fetches that day. The `artists` column is right; the key
    //    is stale.
    //
    // Rows here therefore expose a `staleKey` built from title and venue only,
    // while `artists` holds the real lineup. That gap is exactly where the gig
    // this file is named for went missing.
    const key = term.toLowerCase().replace(/[^a-z0-9]/g, "");
    return {
      events: indexed.filter((e) =>
        String((e as { staleKey: string }).staleKey).includes(key),
      ),
      daysCovered: 151,
    };
  }),
  recentCachedEvents: vi.fn(async () => indexed),
}));

const { searchRAEvents } = await import("../../api/_lib/ra.js");

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
