import { describe, expect, it } from "vitest";
import { dedupeSets, previewSet, seededIndex } from "../../src/lib/preview.js";
import type { ArtistSet } from "../../src/types/artist.js";

function set(id: string, url = `https://sc/${id}`): ArtistSet {
  return {
    provider: "soundcloud",
    id,
    title: id,
    url,
    embedUrl: "e",
    duration: 3600,
    plays: null,
    createdAt: null,
    artwork: null,
  };
}

describe("seededIndex", () => {
  it("stays inside the range", () => {
    for (let length = 1; length <= 20; length += 1) {
      for (const seed of ["a", "event:artist", "", "🎧", "x".repeat(200)]) {
        const index = seededIndex(seed, length);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(length);
      }
    }
  });

  it("is stable for the same seed", () => {
    // The whole reason this is not Math.random(): re-opening a party must give
    // the same preview, or the night you sampled two minutes ago is a different
    // night now.
    expect(seededIndex("e1:a1", 8)).toBe(seededIndex("e1:a1", 8));
  });

  it("gives different artists at one event different picks", () => {
    const picks = new Set(
      ["a1", "a2", "a3", "a4", "a5", "a6"].map((a) => seededIndex(`e1:${a}`, 8)),
    );
    // Not a guarantee for any six specific seeds, but a hash that collapsed
    // them all onto one index is broken and this catches it.
    expect(picks.size).toBeGreaterThan(1);
  });

  it("gives the same artist a different pick at a different event", () => {
    const here = seededIndex("e1:a1", 8);
    const there = seededIndex("e2:a1", 8);
    const elsewhere = seededIndex("e3:a1", 8);
    expect(new Set([here, there, elsewhere]).size).toBeGreaterThan(1);
  });

  it("handles a single-element pool without arithmetic on zero", () => {
    expect(seededIndex("anything", 1)).toBe(0);
    expect(seededIndex("anything", 0)).toBe(0);
  });
});

describe("previewSet", () => {
  const catalogue = Array.from({ length: 20 }, (_, i) => set(`s${i}`));

  it("picks something from the catalogue", () => {
    const chosen = previewSet("e1", "a1", catalogue);
    expect(chosen).not.toBeNull();
    expect(catalogue).toContain(chosen);
  });

  it("only reaches into recent work", () => {
    // Sets are newest-first, so a preview drawn from a decade-old upload would
    // answer the wrong question about a party next Friday.
    const chosen = previewSet("e1", "a1", catalogue);
    expect(catalogue.indexOf(chosen!)).toBeLessThan(8);
  });

  it("returns null rather than throwing on an artist with nothing", () => {
    expect(previewSet("e1", "a1", [])).toBeNull();
  });

  it("is stable across calls", () => {
    expect(previewSet("e1", "a1", catalogue)).toBe(previewSet("e1", "a1", catalogue));
  });
});

describe("dedupeSets", () => {
  it("drops the same recording twice", () => {
    // Two DJs playing back to back often have the b2b on both profiles, and
    // hearing it twice in a five-track preview reads as broken.
    const out = dedupeSets([set("a"), set("b"), set("c", "https://sc/a")]);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("identifies by URL, not id — providers number the same set differently", () => {
    const one = { ...set("sc-1"), url: "https://x/mix" };
    const two = { ...set("mc-9"), url: "https://x/mix" };
    expect(dedupeSets([one, two])).toHaveLength(1);
  });

  it("falls back to id when a set has no URL", () => {
    const a = { ...set("a"), url: "" };
    const b = { ...set("b"), url: "" };
    expect(dedupeSets([a, b])).toHaveLength(2);
  });

  it("keeps order", () => {
    expect(dedupeSets([set("a"), set("b"), set("c")]).map((s) => s.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
