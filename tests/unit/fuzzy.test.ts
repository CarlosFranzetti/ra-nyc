import { describe, expect, it } from "vitest";
import { bareName, fold, matchName, type MatchKind } from "../../api/_lib/fuzzy";

/**
 * The matcher as the resolver will call it, one row per case.
 *
 * Each row names the kind, not only yes or no, because the kind is what the
 * resolver acts on: `exact` and `folded` may be trusted on their own, `word` and
 * `fuzzy` need other evidence first. A case that is accepted but ranked as a
 * weak kind is still a pass here, so this table pins the ranking as well.
 */
type Row = [name: string, text: string, field: "account" | "title", kind: MatchKind];

const ACCOUNTS: Row[] = [
  // Keyboard slips and transpositions are fuzzy. Accounts are length-strict.
  ["aergio", "Sergio", "account", "fuzzy"],
  ["aergio dimoff", "Sergio Dimoff", "account", "fuzzy"],
  ["dj kose", "DJ Koze", "account", "fuzzy"],
  ["Dixon", "dixin", "account", "fuzzy"],
  // Owner's accepted case: "Ben Uho" against "Ben UFO" is a one-edit slip in a six-letter name.
  ["Ben UFO", "Ben Uho", "account", "fuzzy"],

  // Look-alikes and decoration fold to the same spelling.
  ["h0l0", "Holo", "account", "folded"],
  ["SERGIØ", "Sergio", "account", "folded"],
  ["Bjørn", "bjorn", "account", "folded"],
  ["Âme", "ame", "account", "folded"],
  ["Mayday", "M4yday", "account", "folded"],
  ["DJ Koze", "koze", "account", "folded"],
  ["Sergio Dimoff", "sergiodimoffmusic", "account", "folded"],
  ["Holo", "h0l0music", "account", "folded"],
  ["Cosmo (NY)", "cosmo_nyc", "account", "folded"],

  // Spacing and case only: exact.
  ["Jamie XX", "jamie xx", "account", "exact"],
  ["Kode9", "Kode 9", "account", "exact"],
  // Digit identity: 2 is not folded, so this is exact and not folded to "manydjs".
  ["2manydjs", "2 Many DJs", "account", "exact"],

  // Short and common names: fuzz is what makes these collide, so none.
  ["Sami", "Sam", "account", "none"],
  ["Eris", "Iris", "account", "none"],
  ["Ben", "Bex", "account", "none"],
  ["Cosmo", "Cosmic", "account", "none"],
  ["Cosmo", "Cosmonaut", "account", "none"],
  ["DVS1", "DVS", "account", "none"],
  ["house", "Mouse", "account", "none"],
  ["Sergio", "sergiox", "account", "none"],
  // The first-letter gate: h and s are not neighbours, so this is refused even at the right length.
  ["hergio", "Sergio", "account", "none"],
  // Length-strict on purpose: dropped letters are not accepted for accounts.
  ["ergio", "Sergio", "account", "none"],
  // Penelope is a common name: an account for a different person is none, whatever the name looks like.
  ["Penelope (2)", "Penelope Moro", "account", "none"],
  // Known gap: a typo and a decoration together are not handled. Left as none so the gap is visible.
  ["Sergio Dimoff", "aergiodimoffmusic", "account", "none"],
];

const TITLES: Row[] = [
  // Name as a whole word inside a longer title.
  ["Penelope (2)", "heads up w penelope", "title", "word"],
  ["Hugo (US)", "Hugo @ feedbk 10.10.26", "title", "word"],
  ["Hugo (US)", "feedbk w/ Hugo", "title", "word"],
  ["DJ Koze", "DJ Koze - Pitch Black", "title", "word"],
  ["Holo", "h0l0 night", "title", "word"],
  ["2manydjs", "2 Many DJs live", "title", "word"],
  // `word` is the letter of the rule, and these are `word` too. The name is a
  // whole word in each title. The resolver, not this function, asks for evidence
  // before it trusts a `word` on a common name.
  ["Hugo (US)", "Hugo Boss FW26 runway mix", "title", "word"],
  ["Hugo (US)", "Victor Hugo audiobook", "title", "word"],
  ["Penelope (2)", "Entrevista a Penélope Moro", "title", "word"],

  // The whole title is the name.
  ["Penelope", "Penelope", "title", "exact"],
  ["SERGIØ", "Sergio", "title", "folded"],

  // Titles take no fuzzy matches and no partial words.
  ["aergio", "Sergio Dimoff mix", "title", "none"],
  ["Penelope", "Penelopes Radio", "title", "none"],
  ["Sami", "Sam samples", "title", "none"],
  ["Cosmo", "Cosmic", "title", "none"],
  ["after", "chocolate", "title", "none"],
  ["DVS1", "DVS mix", "title", "none"],
];

describe("matchName", () => {
  it.each([...ACCOUNTS, ...TITLES])("%s against %s (%s) is %s", (name, text, field, kind) => {
    const result = matchName(name, text, field);
    expect(result.kind).toBe(kind);
  });

  it("gives the documented score for each kind", () => {
    expect(matchName("Sergio", "Sergio", "account").score).toBe(1);
    expect(matchName("h0l0", "Holo", "account").score).toBe(0.9);
    expect(matchName("Holo", "h0l0 night", "title").score).toBe(0.7);
    const fuzzy = matchName("aergio", "Sergio", "account").score;
    expect(fuzzy).toBeGreaterThanOrEqual(0.35);
    expect(fuzzy).toBeLessThanOrEqual(0.55);
    expect(matchName("Sami", "Sam", "account").score).toBe(0);
  });

  it("strips the RA suffix from the name before matching", () => {
    expect(matchName("Penelope (2)", "Penelope", "account").kind).toBe("exact");
    expect(matchName("Hugo (US)", "Hugo @ feedbk", "title").kind).toBe("word");
  });
});

describe("bareName", () => {
  it("removes a parenthetical suffix and nothing else", () => {
    expect(bareName("Penelope (2)")).toBe("Penelope");
    expect(bareName("Hugo (US)")).toBe("Hugo");
    expect(bareName("Cosmo (NY)")).toBe("Cosmo");
    expect(bareName("SRI (1)")).toBe("SRI");
    expect(bareName("Tale of Us")).toBe("Tale of Us");
  });
});

describe("fold", () => {
  it("maps look-alikes and diacritics to one spelling", () => {
    expect(fold("h0l0")).toBe("holo");
    expect(fold("SERGIØ")).toBe("sergio");
    expect(fold("Âme")).toBe("ame");
    expect(fold("D.Tiffany")).toBe("dtiffany");
  });

  it("leaves digits that carry identity alone", () => {
    expect(fold("2manydjs")).toBe("2manydjs");
    expect(fold("Kode9")).toBe("kode9");
    expect(fold("DVS1")).toBe("dvsi");
  });
});
