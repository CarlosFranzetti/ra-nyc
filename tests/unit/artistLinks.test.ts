import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanBioText,
  evidenceQueries,
  getArtistLinks,
  indexEvidence,
  isBannedUrl,
  isCommonName,
  isPlausibleMatch,
  leadingCredit,
  userQueries,
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
  const state = {
    rows: [] as unknown[],
    writes: 0,
    /** What the lineup index returns for the artist: `{ title, venue_name }` rows. */
    index: [] as unknown[],
    /** The last row written, parsed back out of the insert's parameters. */
    written: [] as unknown[][],
  };
  const fn = vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
    const text = strings.join("?");
    if (/insert into artist_links/i.test(text)) {
      state.writes += 1;
      state.written.push([...args]);
      return [];
    }
    return state.rows;
  });
  const query = vi.fn(async () => state.index);
  return Object.assign(fn, { state, query });
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
  sql.query.mockClear();
  sql.state.rows = [];
  sql.state.writes = 0;
  sql.state.index = [];
  sql.state.written = [];
  vi.stubEnv("SOUNDCLOUD_CLIENT_ID", "test-client-id");
  vi.stubEnv("SOUNDCLOUD_CLIENT_SECRET", "");
  // Every resolve logs one line per RA field it guessed wrong; that is the
  // feature, and it is noise here. Tests that read the log spy on it again.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
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

// ─── Acceptance: Penelope, Hugo, and the doors that stay shut ───────────────

const MINUTE = 60_000;
/** The decoded `q` of a search URL, so a stub can answer by what was asked. */
const queryOf = (url: string): string => new URL(url).searchParams.get("q") ?? "";
const bioFrom = (text: string): Record<string, unknown> => ({
  "biography { blurb content }": { biography: { blurb: null, content: text } },
});
const scAccount = (id: number, username: string, permalink: string, extra: Record<string, unknown> = {}) => ({
  id,
  username,
  permalink,
  permalink_url: `https://soundcloud.com/${permalink}`,
  ...extra,
});
/** The `[sc] resolve` line a cold resolve logs, as production would show it. */
const scLog = (): Record<string, unknown> | undefined =>
  vi.mocked(console.info).mock.calls.find((call) => call[0] === "[sc] resolve")?.[1] as
    | Record<string, unknown>
    | undefined;

describe("PENELOPE: an accepted account with nothing to play", () => {
  const BIO =
    "French-born, lived in Berlin, based in Lisbon since 2018. Founder of the oDYSea parties and a " +
    "regular on Kiosk Radio. Releases on Tresydos.";
  const kioskSet = (extra: Record<string, unknown> = {}) =>
    track(21, "heads up w penelope", {
      permalink_url: "https://soundcloud.com/kioskradio/heads-up-w-penelope",
      user: { id: 9, username: "Kiosk Radio", permalink: "kioskradio" },
      ...extra,
    });

  const penelope = (options: {
    evidenceHits?: unknown[];
    archive?: { identifier: string; title: string }[];
  }) =>
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/penelope" }, ...bioFrom(BIO) }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({ collection: [scAccount(1, "Penelope", "penelope_sound")] }),
      ],
      [
        "api-v2.soundcloud.com/users/1/tracks",
        () => ({ collection: [track(11, "Some single", { duration: 5 * MINUTE })] }),
      ],
      [
        "api-v2.soundcloud.com/search/tracks",
        (url) => ({
          collection: /kiosk|odysea/i.test(queryOf(url)) ? (options.evidenceHits ?? []) : [],
        }),
      ],
      ["api.mixcloud.com/search/", () => ({ data: [] })],
      ["archive.org", () => ({ response: { docs: options.archive ?? [] } })],
    ]);

  it("lists the radio set found by name plus evidence, and never asks the Archive", async () => {
    const calls = penelope({ evidenceHits: [kioskSet()] });
    const { links } = await getArtistLinks("74814", "Penelope (2)");

    expect(links.sets.map((s) => s.title)).toEqual(["heads up w penelope"]);
    expect(links.sets.every((s) => s.provider === "soundcloud")).toBe(true);
    expect(calls.some((u) => u.includes("archive.org"))).toBe(false);
    // The query is the name beside a thing the biography named.
    const asked = calls.filter((u) => u.includes("search/tracks")).map((u) => queryOf(u).toLowerCase());
    expect(asked).toContain("penelope odysea");
    expect(asked).toContain("penelope kiosk radio");
    // The account is still offered, as a link.
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/penelope_sound");
  });

  it("rejects the Archive's Penelope Moro and the entrevista when nothing else is found", async () => {
    penelope({
      archive: [
        { identifier: "a", title: "PENELOPE" },
        { identifier: "b", title: "Penelope Moro" },
        { identifier: "c", title: "Entrevista a Penélope Moro" },
        { identifier: "d", title: "CHRONOSDIG GĦAL PENELOPE Robert Young audiobook fantasija" },
      ],
    });
    const { links } = await getArtistLinks("74814", "Penelope (2)");
    expect(links.sets).toEqual([]);
  });

  it("takes an Archive item only with the name and an evidence term, or the credit form", async () => {
    penelope({
      archive: [
        { identifier: "ok1", title: "Penelope - Live at the oDYSea party" },
        { identifier: "ok2", title: "Penelope @ Kiosk Radio" },
        { identifier: "no", title: "Penelope Moro" },
      ],
    });
    const { links } = await getArtistLinks("74814", "Penelope (2)");
    expect(links.sets.map((s) => s.id).sort()).toEqual(["ia-ok1", "ia-ok2"]);
  });

  it("holds a 20 to 45 minute upload to the set-word rule, and refuses interviews", async () => {
    penelope({
      evidenceHits: [
        kioskSet({ id: 31, title: "penelope @ kiosk radio", duration: 25 * MINUTE }),
        kioskSet({ id: 32, title: "Penelope - oDYSea", duration: 25 * MINUTE }),
        kioskSet({ id: 33, title: "Interview with Penelope for Kiosk Radio", duration: 25 * MINUTE }),
        kioskSet({ id: 34, title: "Entrevista a Penelope, Kiosk Radio", duration: 2 * HOUR_MS }),
        kioskSet({ id: 35, title: "Penelope live mix, Kiosk Radio", duration: 2 * HOUR_MS }),
        kioskSet({ id: 36, title: "penelope @ kiosk radio", duration: 15 * MINUTE }),
      ],
    });
    const { links } = await getArtistLinks("74814", "Penelope (2)");
    expect(links.sets.map((s) => s.id).sort()).toEqual(["sc-31", "sc-35"]);
  });

  it("does not lower the floor for the artist's own account", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/penelope" }, ...bioFrom(BIO) }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scAccount(1, "Penelope", "penelope_sound")] })],
      ["api-v2.soundcloud.com/users/1/tracks", () => ({ collection: [] })],
      [
        "api-v2.soundcloud.com/search/tracks",
        () => ({
          collection: [
            track(41, "penelope @ kiosk radio", { duration: 25 * MINUTE, user: { id: 1, username: "Penelope" } }),
          ],
        }),
      ],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("74814", "Penelope (2)");
    expect(links.sets).toEqual([]);
  });

  it("logs one diagnostic line per cold resolve: account, counts, and why titles were rejected", async () => {
    penelope({ evidenceHits: [kioskSet({ id: 51, title: "Penelope lifestyle vlog", duration: 90 * MINUTE })] });
    await getArtistLinks("74814", "Penelope (2)");
    const infos = vi.mocked(console.info).mock.calls.filter((c) => c[0] === "[sc] resolve");
    expect(infos).toHaveLength(1);
    const line = scLog()!;
    expect(line).toMatchObject({ artist: "Penelope", account: 1, confirmed: false, common: true, own: 1, ownAtFloor: 0 });
    expect((line.rejected as string[]).length).toBeLessThanOrEqual(10);
    expect((line.rejected as string[]).join("|")).toMatch(/Some single \(name not in title\)/);
  });
});

describe("HUGO: an account named Hugo, and feedbk", () => {
  const FEEDBK = [
    { title: "feedbk with Borja S, Hugo", venue_name: "feedbk" },
    { title: "feedbk x subsurface", venue_name: "feedbk" },
  ];
  const hugo = (description: string | null, extra: Record<string, unknown> = {}) =>
    scAccount(5, "Hugo", "itshugo", { description, ...extra });

  const stubHugo = (account: unknown, ra: Record<string, unknown> = {}) =>
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/hugo-dj-usa" }, ...ra }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [account] })],
      [
        "api-v2.soundcloud.com/users/5/tracks",
        () => ({
          collection: [
            track(51, "Hugo - Song", { duration: 4 * MINUTE }),
            track(52, "Untitled mix", { duration: 2 * HOUR_MS }),
          ],
        }),
      ],
      [
        "api-v2.soundcloud.com/search/tracks",
        (url) => ({
          collection: /feedbk/i.test(queryOf(url))
            ? [
                track(61, "feedbk w/ Hugo", {
                  duration: 70 * MINUTE,
                  user: { id: 77, username: "feedbk", permalink: "feedbk" },
                }),
              ]
            : [],
        }),
      ],
      ["api.mixcloud.com/search/", () => ({ data: [] })],
      ["archive.org", () => ({ response: { docs: [] } })],
    ]);

  it("passes 'feedbk w/ Hugo' on the strength of the index, and rejects the four-minute song", async () => {
    sql.state.index = FEEDBK;
    const calls = stubHugo(hugo("https://www.instagram.com/__hugogb/"));
    const { links } = await getArtistLinks("106141", "Hugo (US)");

    expect(links.sets.map((s) => s.id)).toEqual(["sc-61"]);
    expect(calls.some((u) => /search\/tracks/.test(u) && queryOf(u) === "Hugo feedbk")).toBe(true);
    // Asked of the index once, for this RA id.
    expect(sql.query).toHaveBeenCalledTimes(1);
    expect(JSON.parse((sql.query.mock.calls[0] as unknown as [string, unknown[]])[1][1] as string)).toEqual([
      { id: "106141" },
    ]);
  });

  it("does not accept the account on its name alone: no bio from it, its own long upload not trusted", async () => {
    sql.state.index = FEEDBK;
    stubHugo(hugo("https://www.instagram.com/__hugogb/"));
    const { links } = await getArtistLinks("106141", "Hugo (US)");

    expect(links.bio).toBeNull();
    // "Untitled mix" is two hours long and on his own account, and still out.
    expect(links.sets.map((s) => s.title)).not.toContain("Untitled mix");
    // The profile is still offered, as a link.
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/itshugo");
    expect(scLog()).toMatchObject({ confirmed: false, common: true });
  });

  it("accepts the same account once its description names something we know", async () => {
    sql.state.index = FEEDBK;
    stubHugo(hugo("East Williamsburg. Resident at feedbk."));
    const { links } = await getArtistLinks("106141", "Hugo (US)");
    expect(links.sets.map((s) => s.id).sort()).toEqual(["sc-52", "sc-61"]);
    expect(links.bio).toMatchObject({ source: "SoundCloud" });
  });

  it("accepts it when the Instagram in RA's bio is the one in its description", async () => {
    stubHugo(hugo("ig: __hugogb"), bioFrom("https://www.instagram.com/__hugogb/ and nothing else"));
    const { links } = await getArtistLinks("106141", "Hugo (US)");
    expect(links.sets.map((s) => s.id)).toContain("sc-52");
    // The handle was evidence; it is not shown.
    expect(links.bio).toBeNull();
  });

  it("is not blocked by a lineup index that is empty, broken or slow", async () => {
    sql.state.index = [];
    stubHugo(hugo(null));
    expect((await getArtistLinks("106141", "Hugo (US)")).degraded).toBe(false);

    sql.query.mockRejectedValueOnce(new Error("relation does not exist"));
    stubHugo(hugo(null));
    expect((await getArtistLinks("106141", "Hugo (US)")).degraded).toBe(false);

    vi.useFakeTimers();
    try {
      sql.query.mockImplementationOnce(() => new Promise(() => {}));
      stubHugo(hugo(null));
      const pending = getArtistLinks("106141", "Hugo (US)");
      await vi.advanceTimersByTimeAsync(1_600);
      expect((await pending).degraded).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("NO SETS: the page is never left empty", () => {
  it("keeps the profile and adds a SoundCloud search for the bare name", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scAccount(5, "Hugo", "itshugo")] })],
      ["api-v2.soundcloud.com/users/5/tracks", () => ({ collection: [] })],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("106141", "Hugo (US)");
    expect(links.sets).toEqual([]);
    const soundcloud = links.links.find((l) => l.label === "SoundCloud");
    expect(soundcloud).toMatchObject({ resolved: true, url: "https://soundcloud.com/itshugo" });
    const search = links.links.find((l) => l.label === "SoundCloud search");
    expect(search).toMatchObject({
      url: "https://soundcloud.com/search?q=Hugo",
      detail: "Search SoundCloud for Hugo",
      resolved: false,
    });
  });

  it("stands in for a profile we do not have, once and not twice", async () => {
    stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/x" } }), ...NOTHING]);
    const { links } = await getArtistLinks("1", "Penelope (2)");
    expect(links.links.length).toBeGreaterThan(0);
    expect(links.links.filter((l) => /^SoundCloud/.test(l.label))).toEqual([
      expect.objectContaining({ label: "SoundCloud search", url: "https://soundcloud.com/search?q=Penelope" }),
    ]);
  });

  it("does not add the search when there are SoundCloud sets to play", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scAccount(7, "Test DJ", "testdj")] })],
      ["api-v2.soundcloud.com/users/7/tracks", () => ({ collection: [track(70, "A long set")] })],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.links.some((l) => l.label === "SoundCloud search")).toBe(false);
  });
});

describe("YOUTUBE: three doors shut", () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("recognises every YouTube host and none of their lookalikes", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=x",
      "https://youtube.com/watch?v=x",
      "https://m.youtube.com/x",
      "https://music.youtube.com/watch?v=x",
      "https://youtu.be/x",
      "https://www.youtube-nocookie.com/embed/x",
    ]) {
      expect(isBannedUrl(url), url).toBe(true);
    }
    for (const url of ["https://soundcloud.com/notyoutube", "https://notyoutube.com/x", "https://archive.org/details/y"]) {
      expect(isBannedUrl(url), url).toBe(false);
    }
  });

  it("cleans a cached row at read: sets, links and the address in the bio", async () => {
    stubUpstream([raRoute({ contentUrl: { contentUrl: "/dj/x" } }), ...NOTHING]);
    const goodSet = set({ id: "sc-1", url: "https://soundcloud.com/x/1", embedUrl: "https://w.soundcloud.com/player/?url=x" });
    sql.state.rows = [
      {
        ra_artist_id: "1", name: "Test DJ", mixcloud_user: null, mixcloud_url: null,
        soundcloud_user: null, soundcloud_url: null, ra_url: null,
        bio: { text: "Berlin-based selector. Watch https://www.youtube.com/watch?v=abc for more.", source: "SoundCloud", url: null },
        sets: [
          goodSet,
          set({ id: "yt-1", url: "https://www.youtube.com/watch?v=abc", embedUrl: "https://www.youtube-nocookie.com/embed/abc" }),
          set({ id: "yt-2", url: "https://youtu.be/abc", embedUrl: "https://w.soundcloud.com/player/?url=y" }),
        ],
        links: [
          { label: "YouTube", url: "https://www.youtube.com/@testdj", detail: "x", resolved: true },
          { label: "SoundCloud", url: "https://soundcloud.com/testdj", detail: "@testdj", resolved: true },
        ],
        link_source: "auto",
        resolved_at: ago(1000),
      },
    ];
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.cached).toBe(true);
    expect(links.sets.map((s) => s.id)).toEqual(["sc-1"]);
    expect(links.links.map((l) => l.label)).toEqual(["SoundCloud"]);
    expect(JSON.stringify(links)).not.toMatch(/youtu/i);
  });

  it("writes nothing banned, whatever a provider hands back", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" } }),
      ["api.mixcloud.com/search/", () => ({ data: [{ username: "testdj", name: "Test DJ", url: "https://www.mixcloud.com/testdj/" }] })],
      [
        "api.mixcloud.com/testdj/cloudcasts",
        () => ({
          data: [
            { key: "/testdj/yt/", name: "Test DJ yt", url: "https://youtu.be/abc", audio_length: 3600 },
            { key: "/testdj/ok/", name: "Test DJ ok", url: "https://www.mixcloud.com/testdj/ok/", audio_length: 3600 },
          ],
        }),
      ],
      ["api.mixcloud.com/testdj/", () => ({ biog: "Bio that links https://www.youtube.com/@testdj and says something real." })],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.sets.map((s) => s.id)).toEqual(["mc-/testdj/ok/"]);
    expect(links.bio?.text).not.toMatch(/youtu|http/i);
    expect(sql.state.writes).toBe(1);
    expect(JSON.stringify(sql.state.written)).not.toMatch(/youtu/i);
  });
});

describe("BIO: web addresses are removed, handles are kept as evidence", () => {
  it("omits a bio that is only an address, or an address with a label", () => {
    expect(cleanBioText("https://www.instagram.com/__hugogb/")).toBeNull();
    expect(cleanBioText("Instagram: https://instagram.com/hugogb")).toBeNull();
    expect(cleanBioText("Follow me on www.example.com/mix, mail hi@example.com")).toBeNull();
    expect(cleanBioText("   ")).toBeNull();
    expect(cleanBioText(null)).toBeNull();
  });

  it("removes addresses from a real bio and leaves the prose", () => {
    const text = cleanBioText(
      "Berlin-based selector and label owner. Mixes at https://soundcloud.com/x/y, more at www.linktr.ee/x or ra.co/dj/x.",
    )!;
    expect(text).toContain("Berlin-based selector and label owner.");
    expect(text).not.toMatch(/http|www\.|\.co|linktr|@/);
    expect(cleanBioText("Mari.te and St.Louis are places, not links, in a long enough sentence.")).toContain("Mari.te");
  });

  it("returns no bio for a URL-only RA biography, and falls through to the next source", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" }, ...bioFrom("https://www.instagram.com/testdj/") }),
      ["api.mixcloud.com/search/", () => ({ data: [{ username: "testdj", name: "Test DJ", url: "https://www.mixcloud.com/testdj/" }] })],
      ["api.mixcloud.com/testdj/cloudcasts", () => ({ data: [] })],
      ["api.mixcloud.com/testdj/", () => ({ biog: "Brooklyn selector with a monthly residency." })],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.bio).toMatchObject({ source: "Mixcloud", text: "Brooklyn selector with a monthly residency." });
  });

  it("strips addresses from a stored bio on the way in", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" }, ...bioFrom("Berlin selector. Tickets at https://example.com/tix today.") }),
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "Test DJ");
    expect(links.bio?.text).toBe("Berlin selector. Tickets at today.");
    expect(JSON.stringify(sql.state.written)).not.toContain("example.com");
  });
});

describe("BUDGET: no upstream is allowed to hold the function past its bounds", () => {
  it("returns within 3 + 7 + 4 seconds when every upstream hangs, degraded and uncached", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            // A real fetch rejects at once on a signal that has already fired.
            const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort);
          }),
      );
      sql.query.mockImplementationOnce(() => new Promise(() => {}));
      const started = Date.now();
      const pending = getArtistLinks("74814", "Penelope (2)", { refresh: true });
      await vi.advanceTimersByTimeAsync(14_000);
      const { links, degraded } = await pending;

      expect(Date.now() - started).toBeLessThanOrEqual(14_000);
      expect(degraded).toBe(true);
      expect(sql.state.writes).toBe(0);
      expect(links.links.some((l) => l.label === "SoundCloud search")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spends at most eight SoundCloud requests on a cold resolve, all in the one window", async () => {
    sql.state.index = [
      { title: "A party", venue_name: "Nowadays" },
      { title: "Another", venue_name: "Elsewhere" },
      { title: "Third", venue_name: "Basement" },
    ];
    const calls = stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/x" }, ...bioFrom("Founder of the oDYSea parties.") }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scAccount(7, "H0l0", "h0l0")] })],
      ["api-v2.soundcloud.com/users/7/tracks", () => ({ collection: [] })],
      ...NOTHING,
    ]);
    await getArtistLinks("1", "h0l0");
    expect(calls.filter((u) => u.includes("soundcloud.com")).length).toBeLessThanOrEqual(8);
  });
});

describe("VARIANTS: our own spellings, before SoundCloud's", () => {
  it("finds the account named Holo for the RA name h0l0", async () => {
    const calls = stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/h0l0" } }),
      [
        "api-v2.soundcloud.com/search/users",
        (url) => ({
          collection: queryOf(url) === "holo" ? [scAccount(3, "Holo", "holo")] : [],
        }),
      ],
      ["api-v2.soundcloud.com/users/3/tracks", () => ({ collection: [track(30, "Holo @ Nowadays")] })],
      ...NOTHING,
    ]);
    const { links } = await getArtistLinks("1", "h0l0");
    expect(calls.filter((u) => u.includes("search/users")).map(queryOf)).toEqual(["h0l0", "holo"]);
    expect(links.soundcloudUrl).toBe("https://soundcloud.com/holo");
    expect(links.sets.map((s) => s.id)).toEqual(["sc-30"]);
  });

  it("merges two user searches by account id", async () => {
    stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/h0l0" } }),
      ["api-v2.soundcloud.com/search/users", () => ({ collection: [scAccount(3, "Holo", "holo")] })],
      ["api-v2.soundcloud.com/users/3/tracks", () => ({ collection: [track(30, "Holo @ Nowadays")] })],
      ...NOTHING,
    ]);
    // The same account from both queries is one candidate, so there is nothing to refuse.
    const { degraded } = await getArtistLinks("1", "h0l0");
    expect(degraded).toBe(false);
  });

  it("still refuses between two identical Cosmos when evidence searches are running", async () => {
    const calls = stubUpstream([
      raRoute({ contentUrl: { contentUrl: "/dj/cosmo" }, ...bioFrom("Resident at Nowadays and Public Records.") }),
      [
        "api-v2.soundcloud.com/search/users",
        () => ({ collection: [scAccount(1, "Cosmo", "cosmo1"), scAccount(2, "Cosmo", "cosmo2")] }),
      ],
      ...NOTHING,
    ]);
    const { links, degraded } = await getArtistLinks("1", "Cosmo");
    expect(links.soundcloudUser).toBeNull();
    expect(degraded).toBe(true);
    // No account tracks and no bare-name scoped search; only the evidence queries ran.
    expect(calls.filter((u) => u.includes("search/tracks")).every((u) => /Nowadays|Public/i.test(queryOf(u)))).toBe(true);
  });

  it("builds query variants and evidence queries from what we know", () => {
    expect(userQueries("Cosmo (NY)")).toEqual(["Cosmo"]);
    expect(userQueries("h0l0")).toEqual(["h0l0", "holo"]);
    expect(userQueries("DVS1")).toEqual(["DVS1"]);
    expect(userQueries("DJ Holo")).toEqual(["DJ Holo", "Holo"]);
    expect(evidenceQueries("Penelope (2)", ["oDYSea", "Kiosk Radio", "ab", "Tresydos", "Fourth"])).toEqual([
      "Penelope oDYSea",
      "Penelope Kiosk Radio",
      "Penelope Tresydos",
    ]);
    expect(evidenceQueries("Hugo", [])).toEqual([]);
  });

  it("turns the lineup history into venues and party names, most frequent first", () => {
    expect(
      indexEvidence("Hugo (US)", [
        { title: "feedbk with Borja S, Hugo", venue: "feedbk" },
        { title: "feedbk x subsurface", venue: "feedbk" },
        { title: "Hugo All Night", venue: "TBA - Secret Location" },
        { title: "Opening", venue: "Nowadays" },
      ]),
    ).toEqual(["feedbk", "Nowadays", "Opening"]);
  });
});

describe("name rules the new paths rely on", () => {
  it("knows a common name from a distinctive one", () => {
    for (const name of ["Hugo (US)", "Holo", "Cosmo (NY)", "Penelope (2)"]) expect(isCommonName(name), name).toBe(true);
    for (const name of ["Marcel Dettmann", "Test DJ", "Indira Paganotto", "KlangKuenstler"]) {
      expect(isCommonName(name), name).toBe(false);
    }
  });

  it("reads a credit only at the start of an Archive title", () => {
    expect(leadingCredit("Penelope (2)", "Penelope @ Kiosk Radio")).toBe(true);
    expect(leadingCredit("Penelope (2)", "DJ Penelope - Live")).toBe(true);
    for (const title of ["PENELOPE", "Penelope Moro", "Entrevista a Penélope Moro", "Live with Penelope - 2026"]) {
      expect(leadingCredit("Penelope (2)", title), title).toBe(false);
    }
  });
});
