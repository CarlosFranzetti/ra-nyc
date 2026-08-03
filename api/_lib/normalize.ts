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

/**
 * Digit-for-letter substitutions, for search only.
 *
 * Club and artist names in this scene are full of them — h0l0 is a real Ridgewood
 * venue, and nobody types the zeroes. Folding both the query and the haystack
 * through the same table makes "holo" find "h0l0" without either side having to
 * know the other's spelling.
 *
 * Deliberately *not* part of `normalizeName`: that one also backs artist
 * resolution, where folding digits would corrupt names that legitimately contain
 * them — "320", "8ULENTINA", "Tommy Four Seven" — and quietly mismatch them.
 */
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
  "!": "i",
};

/** Search-only key: `normalizeName`, then digits folded to the letters they ape. */
export function searchKey(value: string): string {
  return normalizeName(value.replace(/[0134578@$!]/g, (c) => LEET[c] ?? c));
}

/**
 * Levenshtein distance, abandoned once it exceeds `max`.
 *
 * Bounded because the only question ever asked is "within one edit?", and the
 * early exit keeps a search over a few hundred events from doing real work.
 */
export function withinEditDistance(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  if (a === b) return true;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
      current.push(value);
      if (value < best) best = value;
    }
    // Every path through this row already costs more than we allow.
    if (best > max) return false;
    previous = current;
  }
  return previous[b.length]! <= max;
}
