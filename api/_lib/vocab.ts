import { searchKey } from "./normalize.js";

/**
 * Vibe and genre words, expanded into the words promoters actually use.
 *
 * RA's listing payload has **no genre field** — the searchable text is a title,
 * a venue and a lineup and nothing else. So "techno" can only ever find a party
 * with the word techno in its name, which is a small and slightly random subset
 * of the techno in this city.
 *
 * This closes some of that gap the only way the data allows: by knowing what
 * else those nights get called. "after" finds afterhours and sunrise sets;
 * "queer" finds the parties that never use the word because their *name* is the
 * signal. It is a vocabulary, not a classifier, and it is wrong sometimes in
 * both directions — which is fine for a search box you are scanning, and would
 * not be fine for a filter chip claiming a fact.
 *
 * Two rules for adding to this:
 *
 * - **Terms, not names.** A promoter or party name belongs in the listings, not
 *   here — the moment this file starts curating who counts as queer techno it is
 *   an editorial position maintained by hand and wrong within a season. The
 *   handful of long-running NYC institutions below are here because they are how
 *   people *search* for the scene, not as an endorsement.
 * - **Both directions.** Every entry is expanded on the query side only, never
 *   the haystack, so adding a word can widen results but can never change what
 *   an existing exact search returns.
 */
const VOCAB: Record<string, readonly string[]> = {
  techno: ["techno", "tekno", "industrial", "ebm", "hardgroove", "warehouse"],
  house: ["house", "disco", "garage", "lofi", "deephouse", "techhouse"],
  disco: ["disco", "italo", "nudisco", "boogie", "funk"],
  jungle: ["jungle", "dnb", "drumandbass", "breakbeat", "breaks", "hardcore"],
  bass: ["bass", "dubstep", "grime", "uk", "garage"],
  trance: ["trance", "psytrance", "hardstyle", "gabber"],
  ambient: ["ambient", "drone", "listening", "experimental", "sound bath"],
  dembow: ["dembow", "reggaeton", "perreo", "latin", "cumbia", "baile"],
  afro: ["afro", "afrohouse", "amapiano", "gqom", "highlife"],

  // Vibe rather than genre. These are the words people actually type when they
  // are choosing a night rather than a sound.
  after: ["after", "afters", "afterhours", "sunrise", "morning", "allnight", "late"],
  queer: ["queer", "gay", "lesbian", "trans", "femme", "drag", "pride", "unter", "papijuice"],
  lgbtq: ["queer", "gay", "lesbian", "trans", "femme", "drag", "pride", "unter", "papijuice"],
  heads: ["heads", "headsy", "deep", "nerd", "sound system", "soundsystem"],
  dirty: ["dirty", "filth", "raw", "grimy", "sweaty", "basement"],
  rooftop: ["rooftop", "roof", "terrace", "outdoor", "garden", "backyard", "daytime"],
  day: ["day", "daytime", "daytimedisco", "brunch", "afternoon", "outdoor"],
  loft: ["loft", "diy", "warehouse", "underground", "secret", "tba"],
  live: ["live", "liveset", "band", "performance", "av"],
};

/**
 * Every key a term should be tried against: the term itself, always first, plus
 * anything the vocabulary adds.
 *
 * The term's own key leads so that callers which only use the first entry — or
 * which weight results by position — behave exactly as they did before this
 * file existed. An unknown word expands to itself alone, which is the common
 * case: nearly every search is a DJ or a venue.
 */
export function expandTerm(term: string): string[] {
  const key = searchKey(term);
  if (!key) return [];

  const extra = VOCAB[key];
  if (!extra) return [key];

  // Deduped, and the term's own key is guaranteed to be present even when the
  // vocabulary entry does not repeat it.
  return [...new Set([key, ...extra.map(searchKey).filter(Boolean)])];
}

/** True when the term is one this vocabulary widens, for honest UI copy. */
export function isVocabTerm(term: string): boolean {
  return Boolean(VOCAB[searchKey(term)]);
}
