import { describe, expect, it } from "vitest";
import {
  isPlausibleMatch,
  orderSets,
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
