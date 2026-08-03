import { describe, expect, it } from "vitest";
import {
  normalizeName,
  searchKey,
  withinEditDistance,
} from "../../api/_lib/normalize.js";

describe("normalizeName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeName("Nick Curly")).toBe("nickcurly");
    expect(normalizeName("J.N.R.")).toBe("jnr");
  });

  it("strips accents that NFD can decompose", () => {
    expect(normalizeName("Björk")).toBe("bjork");
    expect(normalizeName("Cécille")).toBe("cecille");
    expect(normalizeName("Spiñorita")).toBe("spinorita");
  });

  // NFD leaves these alone — they are distinct letters, not letter-plus-accent.
  // This is the assertion that would have caught the combining-mark regex being
  // written as literal characters when normalizeName moved to its own module.
  it("transliterates letters NFD cannot decompose", () => {
    expect(normalizeName("Bjørn")).toBe("bjorn");
    expect(normalizeName("Æther")).toBe("aether");
    expect(normalizeName("Straße")).toBe("strasse");
    expect(normalizeName("Łukasz")).toBe("lukasz");
  });

  it("drops RA's disambiguating suffixes", () => {
    expect(normalizeName("Cosmo (NY)")).toBe("cosmo");
    expect(normalizeName("SRI (1)")).toBe("sri");
    // Same artist, two RA spellings — they must collapse together.
    expect(normalizeName("Cosmo (NY)")).toBe(normalizeName("Cosmo"));
  });

  it("folds & to and, so 'Salar & Tammy' matches 'Salar and Tammy'", () => {
    expect(normalizeName("Salar & Tammy")).toBe(normalizeName("Salar and Tammy"));
  });

  it("survives input with nothing to keep", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName("???")).toBe("");
  });
});

describe("searchKey", () => {
  // The case this exists for: a real Ridgewood venue nobody types with zeroes.
  it("makes 'holo' and 'h0l0' the same key", () => {
    expect(searchKey("h0l0")).toBe(searchKey("holo"));
  });

  it("folds the usual digit-for-letter substitutions", () => {
    expect(searchKey("3l3ctr1c")).toBe(searchKey("electric"));
    expect(searchKey("b455")).toBe(searchKey("bass"));
    expect(searchKey("$un$et")).toBe(searchKey("sunset"));
  });

  it("still normalises accents and punctuation", () => {
    expect(searchKey("Björk")).toBe("bjork");
  });

  // Folding digits belongs to search only. normalizeName also backs artist
  // resolution, where mangling a name that legitimately contains digits would
  // quietly mismatch it.
  it("does not leak into normalizeName", () => {
    expect(normalizeName("320")).toBe("320");
    expect(normalizeName("8ULENTINA")).toBe("8ulentina");
  });
});

describe("withinEditDistance", () => {
  it("accepts an exact match", () => {
    expect(withinEditDistance("lakuti", "lakuti", 1)).toBe(true);
  });

  it("accepts one substitution, insertion or deletion", () => {
    expect(withinEditDistance("lakuti", "lakuki", 1)).toBe(true);
    expect(withinEditDistance("lakuti", "lakutii", 1)).toBe(true);
    expect(withinEditDistance("lakuti", "lakut", 1)).toBe(true);
  });

  it("rejects two edits", () => {
    expect(withinEditDistance("lakuti", "lakkk", 1)).toBe(false);
    expect(withinEditDistance("nowadays", "elsewhere", 1)).toBe(false);
  });

  it("rejects on length difference without doing the work", () => {
    expect(withinEditDistance("a", "abcdefghij", 1)).toBe(false);
  });

  it("handles empty strings", () => {
    expect(withinEditDistance("", "", 1)).toBe(true);
    expect(withinEditDistance("", "a", 1)).toBe(true);
    expect(withinEditDistance("", "ab", 1)).toBe(false);
  });
});
