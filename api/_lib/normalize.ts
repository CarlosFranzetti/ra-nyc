/**
 * Name normalisation, shared by artist resolution and event search.
 *
 * Lives on its own rather than in artistLinks so `ra.ts` can use it without
 * pulling the database client — and everything artistLinks imports — into the
 * events and search functions.
 */

/**
 * Letters NFD cannot decompose.
 *
 * NFD splits `é` into `e` + a combining acute, which strips cleanly. But `ø`,
 * `æ` and friends are distinct letters, not letter-plus-accent, so they survive
 * normalisation untouched — "Bjørn" would never match "bjorn" without this.
 */
const TRANSLITERATIONS: Record<string, string> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ħ: "h",
  ı: "i",
};

/** Strips accents, punctuation and case so "Bjørn" ≈ "bjorn". */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    // RA suffixes disambiguators like "Cosmo (NY)" and "SRI (1)".
    .replace(/\([^)]*\)/g, "")
    .replace(/&/g, "and")
    .replace(/[øæœßłđðþħı]/g, (c) => TRANSLITERATIONS[c] ?? c)
    // Decompose, then drop the combining marks NFD produced.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
