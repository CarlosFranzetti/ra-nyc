import { describe, expect, it } from "vitest";
import { expandTerm, isVocabTerm } from "../../api/_lib/vocab";

describe("expandTerm", () => {
  it("leaves an ordinary term alone", () => {
    // The common case by a long way: nearly every search is a DJ or a venue,
    // and widening those would be actively wrong.
    expect(expandTerm("sergio")).toEqual(["sergio"]);
    expect(expandTerm("Bossa Nova Civic Club")).toEqual(["bossanovacivicclub"]);
  });

  it("still folds accents and leet the way a plain search does", () => {
    expect(expandTerm("Björk")).toEqual(["bjork"]);
    expect(expandTerm("h0l0")).toEqual(["holo"]);
  });

  it("widens a vibe word into what promoters actually call it", () => {
    const after = expandTerm("after");
    expect(after).toContain("after");
    expect(after).toContain("afterhours");
    expect(after).toContain("sunrise");
  });

  it("keeps the term's own key first", () => {
    // Callers that only take the first entry, or weight by position, must
    // behave exactly as they did before this file existed.
    expect(expandTerm("techno")[0]).toBe("techno");
    expect(expandTerm("queer")[0]).toBe("queer");
  });

  it("gives lgbtq and queer the same expansion", () => {
    expect(new Set(expandTerm("lgbtq"))).toEqual(
      new Set(["lgbtq", ...expandTerm("queer").filter((k) => k !== "queer"), "queer"]),
    );
  });

  it("never returns duplicates", () => {
    for (const term of ["techno", "house", "queer", "after", "heads"]) {
      const keys = expandTerm(term);
      expect(new Set(keys).size, term).toBe(keys.length);
    }
  });

  it("returns nothing for a term with no searchable characters", () => {
    expect(expandTerm("")).toEqual([]);
    expect(expandTerm("---")).toEqual([]);
  });

  it("but keeps punctuation the leet table maps to letters", () => {
    // `!` folds to `i`, so "!!!" becomes "iii" rather than nothing — which is
    // the right answer, because !!! is a band that plays this city.
    expect(expandTerm("!!!")).toEqual(["iii"]);
  });
});

describe("isVocabTerm", () => {
  it("knows which terms it widens", () => {
    expect(isVocabTerm("techno")).toBe(true);
    expect(isVocabTerm("Queer")).toBe(true);
    expect(isVocabTerm("sergio")).toBe(false);
  });
});
