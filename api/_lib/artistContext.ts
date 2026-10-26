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

/** What RA says about where an artist is from. Every field is optional upstream. */
export interface RaOrigin {
  /** Two-letter code, only when RA's `urlCode` actually looks like one. */
  iso2: string | null;
  countryName: string | null;
}

export interface ArtistContext {
  /**
   * Profile handles. Decisive when present, but see `handleSource`: one lifted
   * out of free text is only as trustworthy as the sentence it came from.
   */
  handles: {
    soundcloud: string | null;
    mixcloud: string | null;
  };
  /**
   * Where the SoundCloud handle came from. A structured RA field is the
   * artist's own statement; a handle regexed out of a biography can as easily
   * be a collaborator, a label or a mix host.
   */
  handleSource: { soundcloud: "structured" | "bio" | null };
  /**
   * Normalised corroborating terms — places, labels, collectives, radio shows.
   * Ranking only.
   */
  terms: string[];
  /**
   * Where the artist is from, as far as anything says. Absent when nothing does,
   * so every consumer has to cope with it missing — which is the normal case
   * until RA's schema is confirmed.
   */
  origin?: { iso2: string | null; places: string[] };
}

export const EMPTY_CONTEXT: ArtistContext = {
  handles: { soundcloud: null, mixcloud: null },
  handleSource: { soundcloud: null },
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
  // US cities and states. The list above was Europe-heavy, so a bio saying
  // "Southwest Florida-based" never registered as the contradiction it is when
  // the artist is "(NY)" — and that exact bio was shown as a New York DJ's.
  "miami", "houston", "atlanta", "dallas", "austin", "seattle", "portland",
  "denver", "boston", "philadelphia", "baltimore", "washington", "new orleans",
  "las vegas", "phoenix", "san diego", "minneapolis", "pittsburgh", "cleveland",
  "columbus", "nashville", "charlotte", "oakland", "honolulu", "san jose",
  "sacramento", "st louis", "kansas city", "salt lake city", "providence",
  "hollywood", "florida", "california", "texas", "new jersey", "massachusetts",
  "illinois", "michigan", "ohio", "pennsylvania", "colorado", "oregon",
  "nevada", "arizona", "louisiana", "tennessee", "north carolina", "virginia",
  "maryland", "connecticut", "hawaii", "new mexico", "minnesota", "wisconsin",
];

/** Longest first, so "new york city" wins over "new york" over "york". */
const PLACES_BY_LENGTH = [...PLACES].sort((a, b) => b.length - a.length);

const PLACE_KEYS = new Set(PLACES.map((p) => compact(p)));

/**
 * Places that are countries rather than somewhere you could be "from" in the
 * sense that tells two same-named DJs apart. An artist whose only known origin
 * is "US" is not contradicted by a bio that says Miami — Miami is in the US.
 */
const COUNTRY_LEVEL = new Set(
  ["united states", "usa", "america", "us", "united kingdom", "uk", "england",
    "scotland", "wales", "great britain", "britain"].map((p) => compact(p)),
);

/**
 * Short region codes, and what a bio or a profile says instead of them.
 *
 * RA disambiguates with "Cosmo (NY)", but nobody writes "NY" in a SoundCloud
 * bio; they write Brooklyn, or New York, or NYC. Without this the one signal
 * that survives an artist having no biography matched "company" and missed
 * "Brooklyn / New York resident".
 *
 * `metro` regions are small enough that knowing one place means knowing the
 * rest: a Brooklyn DJ is a New York DJ. Country-sized ones are not — a London
 * DJ has not told us they are from Glasgow.
 *
 * `codeIsWord` marks codes that are also ordinary English or Romance words, so
 * the bare code only counts when written in capitals: "join us" is not a claim
 * about the United States, "LA-based" is a claim about Los Angeles.
 */
const REGIONS: Record<string, { aliases: string[]; metro: boolean; codeIsWord?: boolean }> = {
  ny: {
    aliases: ["new york", "new york city", "nyc", "brooklyn", "queens", "manhattan", "bronx"],
    metro: true,
  },
  la: { aliases: ["los angeles", "hollywood"], metro: true, codeIsWord: true },
  sf: { aliases: ["san francisco", "oakland", "bay area"], metro: true },
  dc: { aliases: ["washington dc", "washington"], metro: true },
  us: { aliases: ["united states", "usa", "america"], metro: false, codeIsWord: true },
  uk: {
    aliases: [
      "united kingdom", "great britain", "britain", "england", "scotland", "wales",
      "london", "manchester", "glasgow", "bristol", "leeds",
    ],
    metro: false,
  },
};

const REGION_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(REGIONS).map(([code, r]) => [code, r.aliases.map(compact)]),
);

/** `normalizeName` for one phrase, hoisted so the tables above can use it. */
function compact(value: string): string {
  return normalizeName(value);
}

/**
 * Everything a region code stands for, itself included, or just `[place]` when
 * it is not one. Metro-level places pull in their whole region (see above).
 */
function expandPlace(place: string, viaCode: boolean): string[] {
  const key = compact(place);
  if (REGION_ALIASES[key]) return [key, ...REGION_ALIASES[key]!];
  for (const [code, region] of Object.entries(REGIONS)) {
    if (!viaCode && !region.metro) continue;
    const aliases = REGION_ALIASES[code]!;
    if (aliases.includes(key)) return [code, ...aliases];
  }
  return [key];
}

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

// ─── Word-boundary matching ─────────────────────────────────────────────────

/** Longest multi-word term we ever look for; PROPER_NOUN tops out at four words. */
const MAX_GRAM_WORDS = 5;

interface Haystack {
  /** Every run of 1..5 adjacent words, each joined with no separator. */
  grams: Set<string>;
  /** Two-letter tokens written in capitals, lowercased — see `codeIsWord`. */
  capitals: Set<string>;
}

/**
 * Terms are compared as whole words, never as substrings.
 *
 * The old test was `haystack.includes(term)` over a string with every space and
 * punctuation mark removed — which is how "ny" matched inside "company", "many",
 * "funny" and "sunny" (1 point each) while "Brooklyn / New York resident"
 * scored 0. Tokenising first and joining *runs of whole tokens* keeps the one
 * property the old approach had on purpose: the term `newyork` still finds
 * "New York", and `rapodcast` still finds "RA Podcast", because both normalise
 * to the same run of tokens. What it can no longer do is find a term in the
 * middle of a word.
 */
function haystackOf(texts: (string | null | undefined)[]): Haystack {
  const grams = new Set<string>();
  const capitals = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const tokens = text
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => normalizeName(t))
      .filter(Boolean);
    for (let i = 0; i < tokens.length; i += 1) {
      let gram = "";
      for (let n = 0; n < MAX_GRAM_WORDS && i + n < tokens.length; n += 1) {
        gram += tokens[i + n];
        grams.add(gram);
      }
    }
    for (const m of text.matchAll(/(?<![A-Za-z0-9])[A-Z]{2}(?![A-Za-z0-9])/g)) {
      capitals.add(m[0].toLowerCase());
    }
  }
  return { grams, capitals };
}

function termHit(term: string, hay: Haystack): boolean {
  const region = REGIONS[term];
  if (region?.codeIsWord ? hay.capitals.has(term) : hay.grams.has(term)) return true;
  return REGION_ALIASES[term]?.some((alias) => hay.grams.has(alias)) ?? false;
}

/** Which curated places a text names, as normalised terms. */
export function placesMentioned(...texts: (string | null | undefined)[]): string[] {
  const hay = haystackOf(texts);
  const found: string[] = [];
  for (const place of PLACES_BY_LENGTH) {
    const key = compact(place);
    if (hay.grams.has(key) && !found.includes(key)) found.push(key);
  }
  return found;
}

// ─── Building a context ─────────────────────────────────────────────────────

/**
 * Reads a SoundCloud handle out of whatever RA's structured `soundcloud` field
 * holds, which is not something we have seen: a URL, `@name` or a bare name are
 * all plausible, so all three are accepted and anything else is ignored.
 */
export function soundcloudHandleFrom(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/soundcloud\.com\//i.test(value)) {
    return firstHandle(value, HANDLE_PATTERNS.soundcloud);
  }
  const bare = value.replace(/^@/, "");
  if (!/^[a-zA-Z0-9_-]{2,40}$/.test(bare)) return null;
  return RESERVED_HANDLES.has(bare.toLowerCase()) ? null : bare;
}

export interface ArtistContextExtras {
  /** From RA's `country` / `residentCountry`, when RA exposes them. */
  origin?: RaOrigin | null;
  /** From RA's `soundcloud` field, when RA exposes it. */
  soundcloud?: string | null;
}

/**
 * Builds the corroborating context for one artist.
 *
 * `name` is the raw RA name, not a normalised one — RA disambiguates same-named
 * artists with a parenthetical, "Cosmo (NY)" and "SRI (1)", and `normalizeName`
 * throws that away before matching ever sees it. It is the only signal here
 * that survives an artist having no biography at all, which makes it worth
 * reading off the name before anything else.
 *
 * `extras` is everything RA might tell us that is not the name or the
 * biography. All of it is optional and none of it is required downstream: with
 * every field absent this behaves as it did before they existed.
 */
export function buildArtistContext(
  name: string,
  biography: string | null,
  extras: ArtistContextExtras = {},
): ArtistContext {
  const self = normalizeName(name);
  const terms = new Set<string>();
  const places = new Set<string>();

  for (const match of name.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1];
    // "(1)" and "(2)" are RA's tiebreakers, not facts about the artist.
    if (!inner || /^\s*\d+\s*$/.test(inner)) continue;
    // Exempt from the length floor: this parenthetical is almost always a
    // country or state code, and "NY" is both two characters and the single
    // most useful thing RA will ever tell us about which Cosmo this is.
    addTerm(terms, inner, self, 2);
    for (const place of expandPlace(inner, true)) places.add(place);
  }

  if (biography) {
    for (const place of placesMentioned(biography)) {
      if (terms.size >= MAX_TERMS) break;
      // Exempt from the length floor, which exists to throw out *accidental*
      // short tokens from the proper-noun sweep below. Nothing arrives here by
      // accident — every entry is on a curated list. Applying the floor here
      // silently dropped "nyc" and "usa", so a bio reading "based in NYC"
      // contributed nothing at all on an app named ra-nyc.
      addTerm(terms, place, self, 2);
      for (const p of expandPlace(place, false)) places.add(p);
    }

    for (const match of biography.matchAll(PROPER_NOUN)) {
      if (terms.size >= MAX_TERMS) break;
      if (match[1]) addRun(terms, match[1], self);
    }
  }

  const countryName = extras.origin?.countryName ? compact(extras.origin.countryName) : "";
  if (countryName) places.add(countryName);
  const iso2 = extras.origin?.iso2 ? extras.origin.iso2.toUpperCase() : null;

  const structured = soundcloudHandleFrom(extras.soundcloud);
  const fromBio = biography ? firstHandle(biography, HANDLE_PATTERNS.soundcloud) : null;

  return {
    handles: {
      // A structured field is the artist's own statement and outranks anything
      // regexed out of prose.
      soundcloud: structured ?? fromBio,
      mixcloud: biography ? firstHandle(biography, HANDLE_PATTERNS.mixcloud) : null,
    },
    handleSource: { soundcloud: structured ? "structured" : fromBio ? "bio" : null },
    terms: [...terms],
    ...(iso2 || places.size > 0 ? { origin: { iso2, places: [...places] } } : {}),
  };
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * How much of the artist's context a candidate account echoes back.
 *
 * Whole words only (see `haystackOf`). Cheap enough at a handful of candidates
 * times a couple of dozen terms; nowhere near hot.
 *
 * Zero is the common answer and carries no information: most SoundCloud bios
 * say nothing useful. It is a tie-break, not a gate.
 */
export function contextScore(
  context: ArtistContext,
  ...texts: (string | null | undefined)[]
): number {
  if (context.terms.length === 0) return 0;
  const hay = haystackOf(texts);
  if (hay.grams.size === 0) return 0;
  return context.terms.reduce((score, term) => (termHit(term, hay) ? score + 1 : score), 0);
}

/**
 * Picks the candidate an artist's context best supports.
 *
 * `candidates` must already have passed the name test — this only re-orders
 * them. Ties keep the upstream provider's own relevance ranking, which is what
 * the previous `.find()` did for every case and is still the right answer when
 * there is nothing to go on.
 *
 * No longer used by artist resolution, which ranks with `scoreCandidate`;
 * kept because it is the simple form of the same idea.
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

/** What a provider's search result says about an account. Every field optional. */
export interface CandidateProfile {
  /** The account's real handle, as opposed to its freely-chosen display name. */
  permalink?: string | null;
  description?: string | null;
  city?: string | null;
  countryCode?: string | null;
  followers?: number | null;
  trackCount?: number | null;
  verified?: boolean | null;
}

/**
 * Whether a candidate describes itself somewhere the artist is not from.
 *
 * Only fires when the artist's origin is *specific* (a city or a state, not
 * just a country), and only when *every* place the candidate names is outside
 * it: a New York DJ whose bio says "NYC / Berlin" has not contradicted
 * anything. Nothing named, nothing known → not contradicted, because absence
 * of evidence is the common case and must not count against anyone.
 */
export function contradictsOrigin(
  context: ArtistContext,
  candidate: Pick<CandidateProfile, "description" | "city">,
): boolean {
  const origin = context.origin?.places ?? [];
  if (!origin.some((p) => !COUNTRY_LEVEL.has(p) && PLACE_KEYS.has(p))) {
    return false;
  }
  const mentioned = placesMentioned(candidate.description, candidate.city);
  if (mentioned.length === 0) return false;
  return mentioned.every((p) => !origin.includes(p));
}

function countryAgrees(context: ArtistContext, candidate: CandidateProfile): boolean | null {
  const mine = context.origin?.iso2;
  const theirs = candidate.countryCode?.trim().toUpperCase();
  if (!mine || !theirs) return null;
  return mine === theirs;
}

/**
 * Scores an account that has already passed the name test.
 *
 * Every term applies only when the field it reads is present, because none of
 * these fields has been confirmed against a live response from this sandbox: an
 * absent field must score as "no information", never as a penalty.
 *
 * | Signal | Score |
 * | --- | --- |
 * | country matches RA's | +6 |
 * | country conflicts (soft — DJs relocate) | -4 |
 * | city is one of the artist's places | +5 |
 * | context terms echoed, capped | +min(hits, 4) |
 * | names only places outside the artist's origin | -4 |
 * | permalink is exactly the artist's name | +3 |
 * | follower count, log-scaled | up to +3 |
 * | verified | +2 |
 * | no uploads and under ten followers | -8 |
 */
export function scoreCandidate(
  artistName: string,
  context: ArtistContext,
  candidate: CandidateProfile,
): number {
  let score = 0;

  const agrees = countryAgrees(context, candidate);
  if (agrees === true) score += 6;
  if (agrees === false) score -= 4;

  const places = context.origin?.places ?? [];
  if (candidate.city && places.length > 0) {
    const city = compact(candidate.city);
    const named = placesMentioned(candidate.city);
    if (places.includes(city) || named.some((p) => places.includes(p))) score += 5;
  }

  score += Math.min(contextScore(context, candidate.description, candidate.city), 4);
  if (contradictsOrigin(context, candidate)) score -= 4;

  const self = normalizeName(artistName);
  if (self && candidate.permalink && normalizeName(candidate.permalink) === self) score += 3;

  const followers = typeof candidate.followers === "number" ? candidate.followers : null;
  if (followers !== null) score += Math.min(3, Math.log10(Math.max(followers, 0) + 1));
  if (candidate.verified) score += 2;
  if (candidate.trackCount === 0 && followers !== null && followers < 10) score -= 8;

  return score;
}

/**
 * Whether a candidate should be dropped on the evidence even when it is the
 * only one left: it names somewhere else and nothing corroborates it. This is
 * what separates "Cosmo (NY)" from a Southwest Florida DJ called Cosmo when
 * the Florida account is the sole name match and there is nothing to out-rank.
 */
export function isContradicted(context: ArtistContext, candidate: CandidateProfile): boolean {
  return countryAgrees(context, candidate) !== true && contradictsOrigin(context, candidate);
}
