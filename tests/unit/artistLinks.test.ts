import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getArtistLinks,
  isPlausibleMatch,
  isStaleRow,
  isTransient,
  orderSets,
  resolveRa,
  searchName,
  titleMentions,
  MAX_SETS,
  type ArtistSet,
} from "../../api/_lib/artistLinks.js";

function set(options: Partial<ArtistSet> & { id: string }): ArtistSet {
  return {
    provider: "soundcloud",
    title: options.id,
    url: "u",
    embedUrl: "e",
    duration: 3600,
    plays: null,
    createdAt: null,
    artwork: null,
    ...options,
  };
}

describe("isPlausibleMatch", () => {
  it("accepts an exact normalised match", () => {
    expect(isPlausibleMatch("Nick Curly", "nick curly")).toBe(true);
    expect(isPlausibleMatch("Bjørn", "bjorn")).toBe(true);
  });

  it("ignores spacing and punctuation", () => {
    expect(isPlausibleMatch("Marcel Dettmann", "marceldettmann")).toBe(true);
    expect(isPlausibleMatch("Marcel Dettmann", "marcel_dettmann")).toBe(true);
  });

  it("accepts the decoration real accounts add to a name", () => {
    expect(isPlausibleMatch("Objekt", "objektsound")).toBe(true);
    expect(isPlausibleMatch("Avalon Emerson", "avalonemersonmusic")).toBe(true);
    expect(isPlausibleMatch("Anthony Naples", "anthonynaplesofficial")).toBe(true);
    // Symmetric, so a leading "dj" works the same as a trailing "music".
    expect(isPlausibleMatch("Stingray", "djstingray")).toBe(true);
    // Two stacked decorations, which is common and still says nothing new.
    expect(isPlausibleMatch("Objekt", "objektmusicofficial")).toBe(true);
  });

  it("treats every scene the same", () => {
    // The list used to stop at nyc and berlin, which quietly said a Chicago
    // handle was less legitimate than a Berlin one.
    expect(isPlausibleMatch("Objekt", "objektchicago")).toBe(true);
    expect(isPlausibleMatch("Objekt", "objektdetroit")).toBe(true);
    expect(isPlausibleMatch("Objekt", "objektberlin")).toBe(true);
  });

  it("does not accept a two-letter remainder", () => {
    // Two-letter country tags are indistinguishable from ordinary word
    // endings, and the word endings are far more common. `harmo` is a
    // different account from Harmony; `cosmola` is a different account from
    // Cosmo. The accepted cost is that a real `objektuk` no longer resolves —
    // an empty list rather than a wrong one.
    expect(isPlausibleMatch("Harmony", "harmo")).toBe(false);
    expect(isPlausibleMatch("Cosmo", "cosmola")).toBe(false);
    expect(isPlausibleMatch("Objekt", "objektuk")).toBe(false);
  });

  it("lets a four-letter name carry decoration too", () => {
    // The floor is on the *name*, and with a closed set of decorations it no
    // longer needs to be five: Or:la and DVS1 would otherwise match nothing
    // but themselves on every provider.
    expect(isPlausibleMatch("Or:la", "orlamusic")).toBe(true);
    expect(isPlausibleMatch("DVS1", "dvs1official")).toBe(true);
  });

  it("only accepts a leading decoration in the leading position", () => {
    // "dj" leads. A trailing "dj" is not something anyone writes, and allowing
    // it either way would put a two-letter remainder back in play.
    expect(isPlausibleMatch("Stingray", "stingraydj")).toBe(false);
  });

  it("rejects an unrelated name", () => {
    expect(isPlausibleMatch("Lakuti", "Tama Sumo")).toBe(false);
    expect(isPlausibleMatch("Ben Klock", "Marcel Dettmann")).toBe(false);
  });

  it("rejects a short name that is merely contained in a longer one", () => {
    // Below the five-character floor the prefix rule does not apply at all.
    expect(isPlausibleMatch("Bone", "DJ Bones")).toBe(false);
  });

  /**
   * The reason the rule tests *what* the remainder is rather than how long it
   * is. `cosmonaut` exceeds `cosmo` by four characters — fewer than the
   * legitimate `music` in `avalonemersonmusic` — so no length cap separates
   * them. These three all used to match.
   */
  it("rejects a longer name whose remainder carries meaning", () => {
    expect(isPlausibleMatch("Cosmo", "Cosmonaut")).toBe(false);
    expect(isPlausibleMatch("Lakuti", "Lakuti Fan Page")).toBe(false);
    expect(isPlausibleMatch("Objekt", "objekt edits archive")).toBe(false);
  });

  it("rejects an account that drops part of the artist's name", () => {
    // "marcel" alone is a different person, and short names collide constantly.
    expect(isPlausibleMatch("Marcel Dettmann", "marcel")).toBe(false);
  });

  it("rejects empty input on either side", () => {
    expect(isPlausibleMatch("", "someone")).toBe(false);
    expect(isPlausibleMatch("someone", "")).toBe(false);
  });
});

describe("orderSets", () => {
  it("puts the newest first, across providers", () => {
    const ordered = orderSets([
      set({ id: "old-sc", createdAt: "2014-01-01T00:00:00Z", plays: 500_000 }),
      set({ id: "new-mc", provider: "mixcloud", createdAt: "2026-07-01T00:00:00Z", plays: 10 }),
      set({ id: "newest", createdAt: "2026-07-20T00:00:00Z", plays: 5 }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["newest", "new-mc", "old-sc"]);
  });

  // Ordering used to be provider-then-plays, which ranked a decade-old
  // favourite above last weekend's set.
  it("prefers a recent set over an old one with far more plays", () => {
    const [first] = orderSets([
      set({ id: "old", createdAt: "2015-01-01T00:00:00Z", plays: 999_999 }),
      set({ id: "recent", createdAt: "2026-06-01T00:00:00Z", plays: 3 }),
    ]);
    expect(first!.id).toBe("recent");
  });

  // Undated sets sort last, which lands the Archive fallback after the real
  // catalogue without needing a rule that says so.
  it("sorts undated sets last despite high play counts", () => {
    const ordered = orderSets([
      set({ id: "archive", provider: "archive", createdAt: null, plays: 99_999 }),
      set({ id: "dated", createdAt: "2020-01-01T00:00:00Z", plays: 1 }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["dated", "archive"]);
  });

  it("breaks undated ties by provider rank, not plays", () => {
    const ordered = orderSets([
      set({ id: "ar", provider: "archive", createdAt: null, plays: 900 }),
      set({ id: "mc", provider: "mixcloud", createdAt: null, plays: 10 }),
      set({ id: "sc", provider: "soundcloud", createdAt: null, plays: 5 }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["sc", "mc", "ar"]);
  });

  it("caps at MAX_SETS and keeps the newest, not the oldest", () => {
    const many = Array.from({ length: MAX_SETS + 30 }, (_, i) =>
      set({ id: `n${i}`, createdAt: new Date(2020, 0, 1 + i).toISOString() }),
    );
    const ordered = orderSets(many);
    expect(ordered).toHaveLength(MAX_SETS);
    expect(ordered[0]!.id).toBe(`n${many.length - 1}`);
  });

  it("does not mutate its input", () => {
    const input = [
      set({ id: "a", createdAt: "2020-01-01T00:00:00Z" }),
      set({ id: "b", createdAt: "2026-01-01T00:00:00Z" }),
    ];
    orderSets(input);
    expect(input.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("survives an empty list and unparseable dates", () => {
    expect(orderSets([])).toEqual([]);
    expect(orderSets([set({ id: "junk", createdAt: "not a date" })])).toHaveLength(1);
  });
});

// ─── Fixtures for the resolver tests ────────────────────────────────────────

const sql = vi.hoisted(() => {
  const state = { rows: [] as unknown[], writes: 0 };
  const fn = vi.fn(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (/insert into artist_links/i.test(text)) {
      state.writes += 1;
      return [];
    }
    return state.rows;
  });
  return Object.assign(fn, { state });
});

vi.mock("../../api/_lib/db.js", () => ({ getSql: () => sql, isDbEnabled: () => true }));

type Handler = (url: string, init?: { body?: string }) => unknown;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Routes by URL substring, first match wins; anything unrouted is a 404. */
function stubUpstream(routes: [string, Handler][]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string, init?: { body?: string }) => {
    const url = String(input);
    calls.push(url);
    for (const [needle, handler] of routes) {
      if (url.includes(needle)) {
        const out = handler(url, init);
        return out instanceof Response ? out : jsonResponse(out);
      }
    }
    return jsonResponse({}, 404);
  });
  return calls;
}

/** The selection part of one of resolveRa's small queries. */
function raSelection(init?: { body?: string }): string {
  const query = JSON.parse(init?.body ?? "{}").query as string;
  return query.match(/artist\(id: \$id\) \{ (.*) \} \}$/)?.[1] ?? "";
}

/** RA stub: answers each selection from `fields`, or errors if it is absent. */
function raRoute(fields: Record<string, unknown>): [string, Handler] {
  return [
    "ra.co/graphql",
    (_url, init) => {
      const selection = raSelection(init);
      if (selection in fields) {
        const value = fields[selection];
        // A function stands for a whole response (e.g. a 429).
        return typeof value === "function"
          ? (value as () => unknown)()
          : { data: { artist: value } };
      }
      return jsonResponse(
        { errors: [{ message: `Cannot query field "${selection}" on type "Artist".` }] },
        400,
      );
    },
  ];
}

const HOUR_MS = 3_600_000;
const track = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  permalink_url: `https://soundcloud.com/x/${id}`,
  duration: 2 * HOUR_MS,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

beforeEach(() => {
  sql.mockClear();
  sql.state.rows = [];
  sql.state.writes = 0;
  vi.stubEnv("SOUNDCLOUD_CLIENT_ID", "test-client-id");
  vi.stubEnv("SOUNDCLOUD_CLIENT_SECRET", "");
  // Every resolve logs one line per RA field it guessed wrong; that is the
  // feature, and it is noise here. Tests that read the log spy on it again.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const NOTHING: [string, Handler][] = [
  ["api-v2.soundcloud.com/search/users", () => ({ collection: [] })],
  ["api-v2.soundcloud.com/search/tracks", () => ({ collection: [] })],
  ["api.mixcloud.com/search/", () => ({ data: [] })],
  ["archive.org", () => ({ response: { docs: [] } })],
];

describe("failures are not remembered (B2)", () => {
  it("tells an outage from an answer", () => {
    expect(isTransient({ ok: false, reason: "http", status: 429 })).toBe(true);
    expect(isTransient({ ok: false, reason: "http", status: 503 })).toBe(true);
    expect(isTransient({ ok: false, reason: "timeout" })).toBe(true);
    expect(isTransient({ ok: false, reason: "network" })).toBe(true);
    // A dead handle in a bio is an answer, and must not leave the artist uncached.
    expect(isTransient({ ok: false, reason: "http", status: 404 })).toBe(false);
    expect(isTransient({ ok: true, data: [] })).toBe(false);
  });

  it("does not cache a lookup where SoundCloud answered 429", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api-v2.soundcloud.com/search/users", () => jsonResponse({}, 429)],
      ...NOTHING,
    ]);
    const { links, degraded } = await getArtistLinks("1", "Test DJ");
    expect(degraded).toBe(true);
    expect(sql.state.writes).toBe(0);
    // The response is still usable: search links, not an error.
    expect(links.soundcloudUrl).toContain("soundcloud.com/search");
  });

  it("caches a genuinely empty answer, because empty is an answer", async () => {
    stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/x" } }), ...NOTHING]);
    const { degraded, links } = await getArtistLinks("1", "Test DJ");
    expect(degraded).toBe(false);
    expect(sql.state.writes).toBe(1);
    expect(links.linkSource).toBe("none");
  });

  it("does not cache when RA itself is rate limited", async () => {
    stubUpstream([raRoute({ contentUrl: () => jsonResponse({}, 429) }), ...NOTHING]);
    const { degraded } = await getArtistLinks("1", "Test DJ");
    expect(degraded).toBe(true);
    expect(sql.state.writes).toBe(0);
  });

  it("does not count RA rejecting a field it does not have as an outage", async () => {
    // Every guessed field answers 400: that is the schema talking, not RA down.
    stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/x" } }), ...NOTHING]);
    const { degraded } = await getArtistLinks("1", "Test DJ");
    expect(degraded).toBe(false);
  });
});

describe("isStaleRow (B2)", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const DAY = 86_400_000;
  const some = [{ id: "a" }] as never;

  it("expires an empty or `none` row after a day", () => {
    expect(isStaleRow({ link_source: "none", sets: [], resolved_at: ago(2 * DAY) })).toBe(true);
    expect(isStaleRow({ link_source: "none", sets: [], resolved_at: ago(DAY / 2) })).toBe(false);
    expect(isStaleRow({ link_source: "auto", sets: [], resolved_at: ago(2 * DAY) })).toBe(true);
  });

  it("expires a resolved row after ninety days, not before", () => {
    expect(isStaleRow({ link_source: "auto", sets: some, resolved_at: ago(30 * DAY) })).toBe(false);
    expect(isStaleRow({ link_source: "auto", sets: some, resolved_at: ago(91 * DAY) })).toBe(true);
  });

  it("never expires a human's correction", () => {
    expect(isStaleRow({ link_source: "manual", sets: [], resolved_at: ago(900 * DAY) })).toBe(false);
  });

  it("reads a Date as well as a string, and tolerates a missing timestamp", () => {
    expect(isStaleRow({ link_source: "none", sets: [], resolved_at: new Date(Date.now() - 2 * DAY) })).toBe(true);
    expect(isStaleRow({ link_source: "none", sets: [], resolved_at: null })).toBe(false);
  });

  it("is applied when reading: a stale row is a miss, a fresh one is served", async () => {
    stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/x" } }), ...NOTHING]);
    const row = (resolvedAt: string) => ({
      ra_artist_id: "1", name: "Test DJ", mixcloud_user: null, mixcloud_url: null,
      soundcloud_user: null, soundcloud_url: null, ra_url: null, bio: null, sets: [],
      links: [], link_source: "none", resolved_at: resolvedAt,
    });

    sql.state.rows = [row(ago(5 * DAY))];
    expect((await getArtistLinks("1", "Test DJ")).links.cached).toBe(false);

    sql.state.rows = [row(ago(1000))];
    expect((await getArtistLinks("1", "Test DJ")).links.cached).toBe(true);
  });
});

describe("searchName and titleMentions (B4)", () => {
  it("strips RA's parenthetical for searching", () => {
    expect(searchName("Cosmo (NY)")).toBe("Cosmo");
    expect(searchName("SRI (1)")).toBe("SRI");
    expect(searchName("Plain Name")).toBe("Plain Name");
    // Never searches for the empty string.
    expect(searchName("(NY)")).toBe("(NY)");
  });

  it("rejects the titles that are not about this Cosmo", () => {
    for (const title of [
      "Cosmos Radio Hour 14",
      "Cosmopolitan Brunch Mix",
      "Lepota Luba Cosmo - Lowest Edge",
      "Blackpool NY Podcast#3: Cosmo Hamada, Cassius Luber, and Miles Wachsteter.",
    ]) {
      expect(titleMentions("Cosmo (NY)", title), title).toBe(false);
    }
  });

  it("accepts the title that is", () => {
    expect(titleMentions("Cosmo (NY)", "Cosmo @ Nowadays")).toBe(true);
    expect(titleMentions("Cosmo (NY)", "cosmo @ The Lot Radio 08-29-2026")).toBe(true);
    expect(titleMentions("Cosmo", "DJ Cosmo - Live in Brooklyn")).toBe(true);
  });

  it("is looser for a longer name, which is less likely to be a word", () => {
    expect(titleMentions("Marcel Dettmann", "Boiler Room Berlin: Marcel Dettmann")).toBe(true);
    expect(titleMentions("Marcel Dettmann", "Marcel Dettmanns Greatest Hits")).toBe(false);
  });

  it("still refuses names too short to mean anything", () => {
    expect(titleMentions("Jo", "Jo @ somewhere")).toBe(false);
  });
});

describe("provider hygiene (B4)", () => {
  const scUser = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    username: "Test DJ",
    permalink: "testdj",
    permalink_url: "https://soundcloud.com/testdj",
    ...extra,
  });

  it("searches with the parenthetical stripped on all three providers", async () => {
    const calls = stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/x" } }), ...NOTHING]);
    await getArtistLinks("1", "Cosmo (NY)");
    const searches = calls.filter((u) => /search\/users|search\/\?q|advancedsearch/.test(u));
    expect(searches).toHaveLength(3);
    for (const url of searches) {
      expect(decodeURIComponent(url)).not.toContain("(NY)");
      expect(decodeURIComponent(url)).toContain("Cosmo");
    }
  });

  it("does not ask the Archive when SoundCloud found sets", async () => {
    const calls = stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scUser(7)] })],
      ["api-v2.soundcloud.com/users/7/tracks", () => ({ collection: [track(1, "A set")] })],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.sets.map((s) => s.provider)).toEqual(["soundcloud"]);
    expect(calls.some((u) => u.includes("archive.org"))).toBe(false);
  });

  it("does ask the Archive when the other two found nothing", async () => {
    const calls = stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      [
        "archive.org",
        () => ({
          response: {
            docs: [
              { identifier: "good", title: "Test DJ - Live at Somewhere" },
              { identifier: "bad", title: "Test DJs Anonymous Meeting" },
            ],
          },
        }),
      ],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(calls.some((u) => u.includes("archive.org"))).toBe(true);
    expect(links.sets.map((s) => s.id)).toEqual(["ia-good"]);
  });

  it("falls back to the scoped search when a matched profile has only short tracks", async () => {
    // Fifty four-minute singles: the raw count is non-zero, the playable count is zero.
    const singles = Array.from({ length: 3 }, (_, i) =>
      track(100 + i, `Single ${i}`, { duration: 4 * 60_000 }),
    );
    const calls = stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scUser(7)] })],
      ["api-v2.soundcloud.com/users/7/tracks", () => ({ collection: singles })],
      [
        "api-v2.soundcloud.com/search/tracks",
        () => ({ collection: [track(9, "Test DJ @ The Lot Radio")] }),
      ],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(calls.some((u) => u.includes("search/tracks"))).toBe(true);
    expect(links.sets.map((s) => s.id)).toEqual(["sc-9"]);
  });

  it("holds scoped search hits to the strict title rule, not the artist's own uploads", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scUser(7)] })],
      ["api-v2.soundcloud.com/users/7/tracks", () => ({ collection: [] })],
      [
        "api-v2.soundcloud.com/search/tracks",
        () => ({
          collection: [
            track(1, "Totally unrelated mix", { user: { username: "someone else" } }),
            track(2, "Test DJ @ Nowadays"),
          ],
        }),
      ],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.sets.map((s) => s.id)).toEqual(["sc-2"]);
  });

  it("drops a two-minute Mixcloud upload and keeps one with no stated length", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      [
        "api.mixcloud.com/search/",
        () => ({ data: [{ username: "testdj", name: "Test DJ", url: "https://www.mixcloud.com/testdj/" }] }),
      ],
      [
        "/cloudcasts/",
        () => ({
          data: [
            { key: "/testdj/remix/", name: "Remix", audio_length: 142, created_time: "2026-03-01T00:00:00Z" },
            { key: "/testdj/set/", name: "A set", audio_length: 3600, created_time: "2026-02-01T00:00:00Z" },
            { key: "/testdj/unknown/", name: "No length", created_time: "2026-01-01T00:00:00Z" },
          ],
        }),
      ],
      ["api.mixcloud.com/testdj/", () => ({ biog: "hi" })],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.sets.map((s) => s.id)).toEqual(["mc-/testdj/set/", "mc-/testdj/unknown/"]);
  });
});

describe("orderSets provider mix (B4)", () => {
  it("does not let one prolific show crowd out another provider", () => {
    const mixcloud = Array.from({ length: 50 }, (_, i) =>
      set({ id: `mc${i}`, provider: "mixcloud", createdAt: new Date(2026, 5, 1 + i % 28, i).toISOString() }),
    );
    // Older than every Mixcloud episode: date-first, cut at 50, would drop them all.
    const soundcloud = Array.from({ length: 5 }, (_, i) =>
      set({ id: `sc${i}`, createdAt: new Date(2018, 0, 1 + i).toISOString() }),
    );
    const ordered = orderSets([...mixcloud, ...soundcloud]);
    expect(ordered).toHaveLength(MAX_SETS);
    expect(ordered.filter((s) => s.provider === "soundcloud")).toHaveLength(5);
    expect(ordered.filter((s) => s.provider === "mixcloud")).toHaveLength(45);
  });

  it("hands unused slots back, so a one-provider artist keeps the full list", () => {
    const only = Array.from({ length: 45 }, (_, i) =>
      set({ id: `n${i}`, createdAt: new Date(2020, 0, 1 + i).toISOString() }),
    );
    expect(orderSets(only)).toHaveLength(45);
  });
});

describe("RA artist queries (B5)", () => {
  it("survives RA rejecting every guessed field, and says why", async () => {
    const warn = vi.mocked(console.warn);
    stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } })]);
    const ra = await resolveRa("103962");
    expect(ra.url).toBe("https://ra.co/dj/cosmo");
    expect(ra.biography).toBeNull();
    expect(ra.origin).toBeUndefined();
    expect(ra.socials).toBeUndefined();
    expect(ra.degraded).toBe(false);

    const logged = warn.mock.calls.filter((c) => c[0] === "[ra] artist query");
    // One line per rejected field, each carrying RA's own message.
    expect(logged.map((c) => c[1])).toEqual(
      expect.arrayContaining(["country { name urlCode }", "biography", "soundcloud"]),
    );
    expect(String(logged[0]![2])).toContain("Cannot query field");
  });

  it("keeps a country when the other fields are rejected", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/x" },
        "country { name urlCode }": { country: { name: "United States", urlCode: "US" } },
      }),
    ]);
    const ra = await resolveRa("1");
    expect(ra.origin).toEqual({ iso2: "US", countryName: "United States" });
  });

  it("prefers where someone lives over where they are from", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/x" },
        "country { name urlCode }": { country: { name: "Italy", urlCode: "it" } },
        "residentCountry { name urlCode }": { residentCountry: { name: "Germany", urlCode: "de" } },
      }),
    ]);
    expect((await resolveRa("1")).origin).toEqual({ iso2: "DE", countryName: "Germany" });
  });

  it("does not take a non-ISO urlCode for an ISO code", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/x" },
        "country { name urlCode }": { country: { name: "United States", urlCode: "united-states" } },
      }),
    ]);
    expect((await resolveRa("1")).origin).toEqual({ iso2: null, countryName: "United States" });
  });

  it("reads the biography as an object", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/x" },
        "biography { blurb content }": {
          biography: { blurb: "Short.", content: "<p>Brooklyn-based &amp; busy.</p><p>Resident at Nowadays.</p>" },
        },
      }),
    ]);
    const bio = (await resolveRa("1")).biography;
    expect(bio).toContain("Brooklyn-based & busy.");
    expect(bio).not.toContain("<p>");
  });

  it("reads the biography as a plain string", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/x" },
        biography: { biography: "  A scalar bio.  " },
      }),
    ]);
    expect((await resolveRa("1")).biography).toBe("A scalar bio.");
  });

  it("falls back to the blurb when there is no content", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/x" },
        "biography { blurb content }": { biography: { blurb: "Just a blurb.", content: null } },
      }),
    ]);
    expect((await resolveRa("1")).biography).toBe("Just a blurb.");
  });

  it("returns the soundcloud field when RA has one", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/x" },
        soundcloud: { soundcloud: "https://soundcloud.com/cosmo-nyc" },
      }),
    ]);
    expect((await resolveRa("1")).socials).toEqual({ soundcloud: "https://soundcloud.com/cosmo-nyc" });
  });
});

describe("origin-aware account choice (B6)", () => {
  const sc = (id: number, permalink: string, extra: Record<string, unknown> = {}) => ({
    id,
    username: "Cosmo",
    permalink,
    permalink_url: `https://soundcloud.com/${permalink}`,
    ...extra,
  });
  const withTracks = (ids: number[]): [string, Handler][] =>
    ids.map((id) => [
      `api-v2.soundcloud.com/users/${id}/tracks`,
      () => ({ collection: [track(id * 10, `Set by ${id}`)] }),
    ]);

  it("picks the New York Cosmo over the Florida one on the bios alone", async () => {
    // The production case: RA's Cosmo (NY) was shown a Southwest Florida bio.
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({
          collection: [
            sc(1, "cosmobandz", { description: "DJ Cosmo is a Southwest Florida-based DJ" }),
            sc(2, "cosmo-nyc", { description: "Brooklyn. Resident at Public Records." }),
          ],
        }),
      ],
      ...withTracks([1, 2]),
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("103962", "Cosmo (NY)");
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/cosmo-nyc");
    expect(links.sets[0]!.id).toBe("sc-20");
  });

  it("uses RA's country when SoundCloud gives one", async () => {
    stubUpstream([
      raRoute({
        contentUrl: { contentUrl: "/dj/cosmo" },
        "country { name urlCode }": { country: { name: "United States", urlCode: "US" } },
      }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({ collection: [sc(1, "cosmo-au", { country_code: "AU" }), sc(2, "cosmo-us", { country_code: "US" })] }),
      ],
      ...withTracks([1, 2]),
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Cosmo (NY)");
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/cosmo-us");
  });

  it("refuses to choose between two identical accounts, and says it is unsure", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({ collection: [sc(1, "cosmo1"), sc(2, "cosmo2")] }),
      ],
      ...withTracks([1, 2]),
      ...NOTHING,
    ]);
    const { links, degraded } = await getArtistLinks("1", "Cosmo");
    expect(links.soundcloudUser).toBeNull();
    expect(links.sets).toEqual([]);
    // Not remembered: a better signal arriving later should get to break the tie.
    expect(degraded).toBe(true);
    expect(sql.state.writes).toBe(0);
  });

  it("does not run the scoped track search after refusing, which would adopt someone's uploads", async () => {
    const calls = stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [sc(1, "cosmo1"), sc(2, "cosmo2")] })],
      ...NOTHING,
    ]);
    await getArtistLinks("1", "Cosmo");
    expect(calls.some((u) => u.includes("/tracks"))).toBe(false);
  });

  it("lets a clearly bigger account win a tie that has no other evidence", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({
          collection: [
            sc(1, "cosmo1", { followers_count: 2, track_count: 1 }),
            sc(2, "cosmo2", { followers_count: 5000, track_count: 80 }),
          ],
        }),
      ],
      ...withTracks([1, 2]),
      ...NOTHING,
    ]);
    const { links, degraded } = await getArtistLinks("1", "Cosmo");
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/cosmo2");
    expect(degraded).toBe(false);
  });

  it("drops a lone same-name account whose bio is somewhere else entirely", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({ collection: [sc(1, "cosmobandz", { description: "Southwest Florida-based DJ" })] }),
      ],
      ...withTracks([1]),
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Cosmo (NY)");
    expect(links.soundcloudUser).toBeNull();
    expect(links.sets).toEqual([]);
  });

  it("still takes a lone account that says nothing", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [sc(1, "cosmobandz")] })],
      ...withTracks([1]),
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Cosmo (NY)");
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/cosmobandz");
  });

  it("matches on the permalink when the display name is unrelated", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" } }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({ collection: [{ id: 3, username: "x_x", permalink: "cosmo_nyc", permalink_url: "https://soundcloud.com/cosmo_nyc" }] }),
      ],
      ...withTracks([3]),
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Cosmo (NY)");
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/cosmo_nyc");
  });

  it("asks SoundCloud for twenty candidates, not five", async () => {
    const calls = stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/x" } }), ...NOTHING]);
    await getArtistLinks("1", "Test DJ");
    expect(calls.find((u) => u.includes("search/users"))).toContain("limit=20");
  });

  it("tolerates a null in the user list", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [null] })],
      ...NOTHING,
    ]);
    await expect(getArtistLinks("1", "Test DJ")).resolves.toBeTruthy();
  });

  describe("handles", () => {
    it("trusts a structured RA soundcloud field outright", async () => {
      const calls = stubUpstream([
        raRoute({
          contentUrl: { contentUrl: "/dj/x" },
          soundcloud: { soundcloud: "https://soundcloud.com/the-real-one" },
        }),
        [
          "api-v2.soundcloud.com/resolve",
          () => ({ kind: "user", id: 9, username: "A Totally Different Display Name", permalink: "the-real-one", permalink_url: "https://soundcloud.com/the-real-one" }),
        ],
        ...withTracks([9]),
        ...NOTHING,
      ]);
        const { links } = await getArtistLinks("1", "Cosmo");
      expect(links.soundcloudUrl).toBe("https://soundcloud.com/the-real-one");
      expect(calls.some((u) => u.includes("search/users"))).toBe(false);
    });

    it("does not let a handle found in a bio override the name test", async () => {
      // The first soundcloud.com link in prose is as likely a label as the artist.
      const calls = stubUpstream([
        raRoute({
          contentUrl: { contentUrl: "/dj/x" },
          biography: { biography: "Releases on soundcloud.com/some-label and more." },
        }),
        [
          "api-v2.soundcloud.com/resolve",
          () => ({ kind: "user", id: 9, username: "Some Label", permalink: "some-label", permalink_url: "https://soundcloud.com/some-label" }),
        ],
        ["api-v2.soundcloud.com/search/users", () => ({ collection: [sc(2, "cosmo-real")] })],
        ...withTracks([2, 9]),
        ...NOTHING,
      ]);
        const { links } = await getArtistLinks("1", "Cosmo");
      expect(links.soundcloudUrl).toBe("https://soundcloud.com/cosmo-real");
      expect(calls.some((u) => u.includes("search/users"))).toBe(true);
    });

    it("still takes a bio handle that passes the name test", async () => {
      const calls = stubUpstream([
        raRoute({
          contentUrl: { contentUrl: "/dj/x" },
          biography: { biography: "More at soundcloud.com/cosmo-official" },
        }),
        [
          "api-v2.soundcloud.com/resolve",
          () => ({ kind: "user", id: 9, username: "Cosmo", permalink: "cosmo-official", permalink_url: "https://soundcloud.com/cosmo-official" }),
        ],
        ...withTracks([9]),
        ...NOTHING,
      ]);
        const { links } = await getArtistLinks("1", "Cosmo");
      expect(links.soundcloudUrl).toBe("https://soundcloud.com/cosmo-official");
      expect(calls.some((u) => u.includes("search/users"))).toBe(false);
    });
  });

  describe("link detail", () => {
    it("shows the real handle with an @", async () => {
      stubUpstream([
        raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
        ["api-v2.soundcloud.com/search/users", () => ({ collection: [sc(1, "cosmo-nyc")] })],
        ...withTracks([1]),
        ...NOTHING,
      ]);
      const { links } = await getArtistLinks("1", "Cosmo (NY)");
      expect(links.links.find((l) => l.label === "SoundCloud")?.detail).toBe("@cosmo-nyc");
    });

    it("shows a display name as a plain label when the handle is unknown", async () => {
      stubUpstream([
        raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
        [
          "api-v2.soundcloud.com/search/users",
          () => ({ collection: [{ id: 1, username: "Colleen Cosmo Murphy", permalink_url: "" }] }),
        ],
        ...NOTHING,
      ]);
      const { links } = await getArtistLinks("1", "Colleen Cosmo Murphy");
      const detail = links.links.find((l) => l.label === "SoundCloud")?.detail;
      expect(detail).toBe("Colleen Cosmo Murphy");
      expect(detail).not.toContain("@");
    });
  });
});
