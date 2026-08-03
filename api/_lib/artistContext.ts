/**
 * Everything RA tells us about an artist beyond their name, turned into signals
 * that can pick between same-named accounts.
 *
 * Name matching alone cannot separate two people called Cosmo. It never will:
 * the strings are identical, so no amount of tightening `isPlausibleMatch`
 * helps. What separates them is context — one is from New York and plays
 * Resolute parties, the other is not — and RA already publishes that in the
 * biography we fetch for the artist sheet and then use for nothing else.
 *
 * Two kinds of signal come out of here, and they are not equally strong:
 *
 * - **Handles.** A bio containing `soundcloud.com/objekt` is not corroboration,
 *   it is the answer. Nothing else in this file can outrank it.
 * - **Terms.** Places, labels, collectives and residencies. These only ever
 *   *rank* candidates that already passed the name test — never rescue one that
 *   failed it. Loosening matching in exchange for a keyword overlap would trade
 *   a rare wrong answer for a common one.
 *
 * The bio is often missing (RA's `biography` field is a guess at their schema,
 * and plenty of artists have no prose). With no bio this yields an empty
 * context and resolution behaves exactly as it did before — the parenthetical
 * signal below is the one part that always works.
 */

import { normalizeName } from "./normalize.js";

export interface ArtistContext {
  /** Profile handles stated outright in the biography. Decisive when present. */
  handles: {
    soundcloud: string | null;
    mixcloud: string | null;
  };
  /**
   * Normalised corroborating terms — places, labels, collectives, radio shows.
   * Ranking only.
   */
  terms: string[];
}

export const EMPTY_CONTEXT: ArtistContext = {
  handles: { soundcloud: null, mixcloud: null },
  terms: [],
};

/**
 * Paths on those hosts that are site furniture rather than someone's account.
 * `soundcloud.com/search?q=…` in a bio would otherwise resolve the artist to a
 * user called "search".
 */
const RESERVED_HANDLES = new Set([
  "search", "discover", "stream", "upload", "settings", "you", "pages", "tags",
  "charts", "popular", "categories", "people", "terms", "privacy", "imprint",
  "jobs", "mobile", "premium", "pro", "signin", "login", "logout", "about",
]);

/**
 * The leading group is doing real work in both directions: `(?:[\w-]+\.)*`
 * admits the `www.` a bio is far more likely to contain than a bare host, while
 * requiring a literal dot in front of the host keeps `notsoundcloud.com` — and
 * every other lookalike domain — out.
 */
const HANDLE_PATTERNS = {
  soundcloud: /(?:^|[^\w.-])(?:[\w-]+\.)*soundcloud\.com\/([a-zA-Z0-9_-]{2,40})/g,
  mixcloud: /(?:^|[^\w.-])(?:[\w-]+\.)*mixcloud\.com\/([a-zA-Z0-9_-]{2,40})/g,
} as const;

function firstHandle(text: string, pattern: RegExp): string | null {
  // Fresh lastIndex per call: these are module-level /g regexes and would
  // otherwise resume mid-string on the second artist resolved by an instance.
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const handle = match[1];
    if (handle && !RESERVED_HANDLES.has(handle.toLowerCase())) return handle;
  }
  return null;
}

/**
 * Words that get a capital because a sentence started, not because they name
 * anything. Without this the proper-noun sweep below returns "Since", "After"
 * and "Born" for half the bios on RA.
 */
const SENTENCE_WORDS = new Set([
  "the", "this", "that", "these", "those", "his", "her", "their", "its",
  "he", "she", "they", "it", "one", "two", "both", "after", "since", "while",
  "with", "from", "for", "and", "but", "als", "now", "today", "born", "based",
  "having", "over", "under", "before", "during", "through", "between", "when",
  "where", "what", "who", "why", "how", "there", "here", "then", "than",
  "also", "however", "although", "though", "despite", "across", "alongside",
  "his", "not", "such", "much", "many", "most", "more", "less", "first",
  "second", "third", "next", "last", "early", "late", "new", "old", "own",
  "music", "musician", "artist", "producer", "label", "records", "record",
  "dj", "set", "sets", "album", "ep", "release", "releases", "track", "tracks",
  "club", "night", "nights", "party", "parties", "sound", "sounds", "style",
]);

/**
 * Places worth corroborating on.
 *
 * Not an attempt at a gazetteer — these are the scenes whose names actually
 * recur in RA bios, and a location is the single most discriminating fact about
 * two DJs with the same name. Multi-word entries are matched before the sweep
 * runs so "New York" survives as one term.
 */
const PLACES: readonly string[] = [
  "new york", "new york city", "nyc", "brooklyn", "queens", "manhattan",
  "bronx", "ridgewood", "bushwick", "united states", "america", "usa",
  "berlin", "london", "paris", "amsterdam", "rotterdam", "detroit", "chicago",
  "los angeles", "san francisco", "montreal", "toronto", "mexico city",
  "bogota", "tokyo", "osaka", "seoul", "shanghai", "melbourne", "sydney",
  "glasgow", "manchester", "bristol", "leeds", "dublin", "lisbon", "madrid",
  "barcelona", "milan", "rome", "naples", "athens", "istanbul", "tel aviv",
  "johannesburg", "cape town", "lagos", "nairobi", "kampala", "durban",
  "copenhagen", "stockholm", "oslo", "helsinki", "reykjavik", "warsaw",
  "krakow", "prague", "budapest", "vienna", "zurich", "geneva", "brussels",
  "antwerp", "hamburg", "cologne", "frankfurt", "leipzig", "munich",
  "buenos aires", "sao paulo", "rio de janeiro", "santiago", "lima",
];

/** Longest first, so "new york city" wins over "new york" over "york". */
const PLACES_BY_LENGTH = [...PLACES].sort((a, b) => b.length - a.length);

/** Bounds the work done per candidate later; bios can be several paragraphs. */
const MAX_TERMS = 24;

/** Below this a "term" is too generic to corroborate anything. */
const MIN_TERM_LENGTH = 4;

/**
 * Runs of adjacent capitalised words — how labels, collectives, venues and
 * radio shows appear in prose. "Underground Resistance", "RA Podcast",
 * "Tresor", "Resolute" all come out of this without being listed anywhere.
 *
 * Deliberately broken by lowercase words. An earlier version stepped over
 * "and" to catch names like "Rush Hour", and "played Tresor and Berghain"
 * became the single term `tresorandberghain` — matching nothing, and losing
 * both real ones.
 */
const PROPER_NOUN = /\b([A-Z][\w&'’-]+(?:\s+[A-Z][\w&'’-]+){0,3})\b/g;

function addTerm(
  into: Set<string>,
  raw: string,
  exclude: string,
  minLength = MIN_TERM_LENGTH,
): void {
  const term = normalizeName(raw);
  if (term.length < minLength) return;
  if (term === exclude) return;
  if (SENTENCE_WORDS.has(term)) return;
  into.add(term);
}

/**
 * A multi-word run contributes both itself and its parts: "The Bunker New York"
 * is worth having whole, but a candidate that only says "Bunker" should still
 * score. Single words add nothing extra, so they skip the second pass.
 */
function addRun(into: Set<string>, run: string, exclude: string): void {
  addTerm(into, run, exclude);
  const words = run.split(/\s+/);
  if (words.length < 2) return;
  for (const word of words) addTerm(into, word, exclude);
}

/**
 * Builds the corroborating context for one artist.
 *
 * `name` is the raw RA name, not a normalised one — RA disambiguates same-named
 * artists with a parenthetical, "Cosmo (NY)" and "SRI (1)", and `normalizeName`
 * throws that away before matching ever sees it. It is the only signal here
 * that survives an artist having no biography at all, which makes it worth
 * reading off the name before anything else.
 */
export function buildArtistContext(
  name: string,
  biography: string | null,
): ArtistContext {
  const self = normalizeName(name);
  const terms = new Set<string>();

  for (const match of name.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1];
    // "(1)" and "(2)" are RA's tiebreakers, not facts about the artist.
    if (!inner || /^\s*\d+\s*$/.test(inner)) continue;
    // Exempt from the length floor: this parenthetical is almost always a
    // country or state code, and "NY" is both two characters and the single
    // most useful thing RA will ever tell us about which Cosmo this is.
    addTerm(terms, inner, self, 2);
  }

  if (!biography) {
    return { handles: { soundcloud: null, mixcloud: null }, terms: [...terms] };
  }

  const lower = biography.toLowerCase();
  for (const place of PLACES_BY_LENGTH) {
    if (terms.size >= MAX_TERMS) break;
    if (lower.includes(place)) addTerm(terms, place, self);
  }

  for (const match of biography.matchAll(PROPER_NOUN)) {
    if (terms.size >= MAX_TERMS) break;
    if (match[1]) addRun(terms, match[1], self);
  }

  return {
    handles: {
      soundcloud: firstHandle(biography, HANDLE_PATTERNS.soundcloud),
      mixcloud: firstHandle(biography, HANDLE_PATTERNS.mixcloud),
    },
    terms: [...terms],
  };
}

/**
 * How much of the artist's context a candidate account echoes back.
 *
 * Substring rather than token equality, because both sides are normalised down
 * to bare letters — "undergroundresistance" has to be found inside a run-on
 * profile blurb. Cheap enough at a handful of candidates times a couple of
 * dozen terms; nowhere near hot.
 *
 * Zero is the common answer and carries no information: most SoundCloud bios
 * say nothing useful. It is a tie-break, not a gate.
 */
export function contextScore(
  context: ArtistContext,
  ...texts: (string | null | undefined)[]
): number {
  if (context.terms.length === 0) return 0;
  const haystack = normalizeName(texts.filter(Boolean).join(" "));
  if (!haystack) return 0;
  return context.terms.reduce(
    (score, term) => (haystack.includes(term) ? score + 1 : score),
    0,
  );
}

/**
 * Picks the candidate an artist's context best supports.
 *
 * `candidates` must already have passed the name test — this only re-orders
 * them. Ties keep the upstream provider's own relevance ranking, which is what
 * the previous `.find()` did for every case and is still the right answer when
 * there is nothing to go on.
 */
export function pickByContext<T>(
  candidates: T[],
  context: ArtistContext,
  describe: (candidate: T) => (string | null | undefined)[],
): T | undefined {
  if (candidates.length <= 1) return candidates[0];

  let best = candidates[0];
  let bestScore = contextScore(context, ...describe(candidates[0]!));
  for (let i = 1; i < candidates.length; i += 1) {
    const score = contextScore(context, ...describe(candidates[i]!));
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }
  return best;
}
