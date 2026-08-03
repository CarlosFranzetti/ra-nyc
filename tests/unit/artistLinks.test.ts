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

  it("accepts a clean prefix on a long enough name", () => {
    expect(isPlausibleMatch("Marcel Dettmann", "marceldettmann")).toBe(true);
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
   * Documents current behaviour rather than desired behaviour.
   *
   * The prefix rule is unbounded on the right, so *anything* beginning with the
   * artist's name matches once the name is five characters or more. That is what
   * lets "Marcel Dettmann" find `marceldettmann`, but it also accepts a fan
   * account and, more worryingly, a different artist whose name merely starts
   * the same way. Asserted so the looseness is visible and a deliberate
   * tightening shows up here as a change, not a surprise.
   */
  it("currently accepts any longer name sharing the prefix (see comment)", () => {
    expect(isPlausibleMatch("Marcel Dettmann", "marceldettmann")).toBe(true);
    expect(isPlausibleMatch("Lakuti", "Lakuti Fan Page Uploads")).toBe(true);
    expect(isPlausibleMatch("Cosmo", "Cosmonaut")).toBe(true);
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

  // Undated sets sort last, which lands the Archive/YouTube fallbacks after the
  // real catalogue without needing a rule that says so.
  it("sorts undated sets last despite high play counts", () => {
    const ordered = orderSets([
      set({ id: "archive", provider: "archive", createdAt: null, plays: 99_999 }),
      set({ id: "dated", createdAt: "2020-01-01T00:00:00Z", plays: 1 }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["dated", "archive"]);
  });

  it("breaks undated ties by provider rank, not plays", () => {
    const ordered = orderSets([
      set({ id: "yt", provider: "youtube", createdAt: null, plays: 900 }),
      set({ id: "mc", provider: "mixcloud", createdAt: null, plays: 10 }),
      set({ id: "sc", provider: "soundcloud", createdAt: null, plays: 5 }),
    ]);
    expect(ordered.map((s) => s.id)).toEqual(["sc", "mc", "yt"]);
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
