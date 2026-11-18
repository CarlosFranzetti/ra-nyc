/**
 * Forgiving name matching for accounts and titles.
 *
 * This is the one place that decides whether a SoundCloud or Mixcloud account,
 * or a set title, is the artist named on the RA listing. It imports nothing from
 * the rest of `api/_lib`: the artist resolver imports it, so anything it pulled
 * in would be a cycle. The decoration lists below are therefore copied from
 * `artistLinks.ts` rather than shared, and the two must be kept in step by hand.
 *
 * Two questions are asked, and they are kept apart on purpose:
 *
 * - **Accounts** (`field: "account"`) are strict. An account is adopted as the
 *   artist's own, and a wrong one is worse than none, so a near miss is only
 *   accepted when it is a keyboard slip of the same length, or the same name
 *   with decoration on it. `Cosmo` is not `Cosmic`, and `Cosmo` is not
 *   `cosmonaut`.
 * - **Titles** (`field: "title"`) are looser. A title is evidence, not an
 *   adoption: a `word` match says the name is written in the title, and the
 *   resolver decides whether that is enough. There is no fuzzy matching inside a
 *   title at all, because a title is a sentence and a one-letter edit inside a
 *   sentence finds nothing it means.
 *
 * Folding is the same on both sides: `fold` turns look-alikes into one spelling,
 * so `h0l0`, `Holo` and `SERGIØ` each reach a common form. Digits 2, 6 and 9 are
 * left alone, because they carry identity in names such as `2manydjs` and `Kode9`.
 */

export type MatchKind = "exact" | "folded" | "word" | "fuzzy" | "none";

export interface NameMatch {
  score: number;
  kind: MatchKind;
}

const NONE: NameMatch = { score: 0, kind: "none" };

/** Letters NFD cannot split, folded to the letters they sit nearest. */
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

/**
 * Digits and symbols that stand in for letters, the way promoters and handle
 * owners type them. `2`, `6` and `9` are absent on purpose: no common letter
 * looks like them closely enough to fold, and folding them would merge names
 * that are distinct.
 */
const LOOK_ALIKE: Record<string, string> = {
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

/** Canonical look-alike form: case, diacritics, look-alike digits and symbols, punctuation and spacing removed. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[øæœßłđðþħı]/g, (c) => TRANSLITERATIONS[c] ?? c)
    .replace(/[0134578@$!]/g, (c) => LOOK_ALIKE[c] ?? c)
    .normalize("NFD")
    // NFD split accented letters into a letter and a combining mark; the mark goes, the letter stays.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Case and punctuation removed, but no look-alike or diacritic folding: the tier above `folded`. */
function plain(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The RA name without its disambiguating suffix: "Penelope (2)" -> "Penelope",
 * "Hugo (US)" -> "Hugo", "Cosmo (NY)" -> "Cosmo". RA adds these to tell two
 * artists apart; no account or title carries them.
 */
export function bareName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim() || name.trim();
}

/** A name shorter than this is never fuzzy and never decorated: too many ordinary words are this short. */
const MIN_CORE_LENGTH = 4;

/** Shorter than this, the name is exact or nothing: one edit matches far too much. */
const MIN_FUZZY_LENGTH = 5;

/** Words that come before a name in an account: `djkoze`, `theobjekt`. */
const LEADING_AFFIXES: readonly string[] = ["dj", "the", "iam", "itsme", "real", "official"];

/** Words that come after a name in an account: `objektsound`, `avalonemersonmusic`. */
const TRAILING_AFFIXES: readonly string[] = [
  "official", "music", "musik", "sound", "sounds", "audio", "live", "real", "world", "online",
  "nyc", "usa", "brooklyn", "chicago", "detroit", "berlin", "london", "paris",
  "amsterdam", "rotterdam", "tokyo", "osaka", "glasgow", "manchester", "bristol",
  "leeds", "dublin", "lisbon", "madrid", "barcelona", "milan", "vienna", "warsaw",
  "prague", "budapest", "montreal", "toronto", "melbourne", "sydney", "oslo",
  "stockholm", "copenhagen", "helsinki", "hamburg", "cologne", "leipzig", "munich",
  "zurich", "brussels",
];

/** Whether `rest` is nothing but stacked decoration: "", "music", or "musicofficial". */
function isDecoration(rest: string, affixes: readonly string[]): boolean {
  if (!rest) return true;
  for (const affix of affixes) {
    if (rest === affix) return true;
    // Two stacked decorations at most. A third is more likely a different word.
    if (rest.startsWith(affix) && affixes.includes(rest.slice(affix.length))) return true;
  }
  return false;
}

/** Whether `whole` is `core` with only decoration around it, on either side. */
function decorated(core: string, whole: string): boolean {
  if (core.length < MIN_CORE_LENGTH || whole.length < core.length) return false;
  if (whole.startsWith(core)) return isDecoration(whole.slice(core.length), TRAILING_AFFIXES);
  if (whole.endsWith(core)) return isDecoration(whole.slice(0, whole.length - core.length), LEADING_AFFIXES);
  return false;
}

/**
 * Keyboard neighbours on a QWERTY layout, as (column, row) positions. Rows are
 * offset to match the stagger of the physical keys, so a key one row down is a
 * neighbour only when it sits within about one key's width of the one above.
 */
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const ROW_OFFSET = [0, 0.25, 0.75];
const POSITION = new Map<string, { x: number; y: number }>();
ROWS.forEach((row, y) => {
  [...row].forEach((key, i) => POSITION.set(key, { x: i + ROW_OFFSET[y]!, y }));
});

function neighbours(a: string, b: string): boolean {
  const p = POSITION.get(a);
  const q = POSITION.get(b);
  if (!p || !q || a === b) return false;
  return Math.abs(p.y - q.y) <= 1 && Math.abs(p.x - q.x) <= 1.25;
}

/**
 * Edit cost, optimal-string-alignment Damerau: a transposition is one edit, a
 * substitution between neighbouring keys is half an edit, anything else is one.
 *
 * Returns Infinity when the first letters differ and are not neighbouring keys.
 * That gate is the first-letter rule: the first letter of a name is the one a
 * typist is least likely to get wrong by accident, so a change there has to be
 * a fat-finger slip, not a different word.
 */
function editCost(a: string, b: string): number {
  if (a === b) return 0;
  if (a[0] !== b[0] && !neighbours(a[0]!, b[0]!)) return Infinity;
  const n = a.length;
  const m = b.length;
  // Two rows is all the recurrence needs; the transposition check reads two back.
  let twoBack = new Array<number>(m + 1).fill(0);
  let previous = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i += 1) {
    const current = new Array<number>(m + 1).fill(0);
    current[0] = i;
    for (let j = 1; j <= m; j += 1) {
      const x = a[i - 1]!;
      const y = b[j - 1]!;
      const sub = x === y ? 0 : neighbours(x, y) ? 0.5 : 1;
      let v = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + sub);
      if (i > 1 && j > 1 && x === b[j - 2] && a[i - 2] === y) {
        v = Math.min(v, twoBack[j - 2]! + 1);
      }
      current[j] = v;
    }
    twoBack = previous;
    previous = current;
  }
  return previous[m]!;
}

/**
 * How many edits a name of this length may take. Four letters or fewer take
 * none: at that size one edit reaches half the names in the city. Five to eight
 * take one; nine and up take two.
 */
function budget(shorter: number): number {
  if (shorter < MIN_FUZZY_LENGTH) return 0;
  if (shorter <= 8) return 1;
  return 2;
}

/** Lowercased words of a title, each folded, with the position each one ends at. */
function words(text: string): { f: string; end: number }[] {
  const out: { f: string; end: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const f = fold(m[0]);
    if (f) out.push({ f, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/** Score for an account's display name, permalink or full name against the artist. */
function matchAccount(name: string, text: string): NameMatch {
  if (plain(name) === plain(text)) return { score: 1, kind: "exact" };
  const f = fold(name);
  const g = fold(text);
  if (!f || !g) return NONE;
  if (f === g) return { score: 0.9, kind: "folded" };
  if (decorated(f, g) || decorated(g, f)) return { score: 0.9, kind: "folded" };

  // Same length only. An account that is longer or shorter than the name is a
  // different handle with extra words, and that is what the length check rules out.
  if (f.length !== g.length || f.length < MIN_FUZZY_LENGTH) return NONE;
  const cost = editCost(f, g);
  if (cost > budget(f.length)) return NONE;
  return { score: 0.55 - 0.1 * cost, kind: "fuzzy" };
}

/**
 * Score for a title against the artist. The name must appear as whole words, in
 * order, after folding each word. The whole title equal to the name is an exact
 * match; anything longer is a `word` match and is weaker evidence.
 */
function matchTitle(name: string, text: string): NameMatch {
  const wanted = words(name).map((w) => w.f);
  if (!wanted.length) return NONE;
  const found = words(text);
  if (!found.length) return NONE;

  if (plain(name) === plain(text)) return { score: 1, kind: "exact" };
  if (wanted.join("") === found.map((w) => w.f).join("")) return { score: 0.9, kind: "folded" };

  // Compared joined, so "2 Many DJs" carries the name "2manydjs" and a title
  // that spells a name with a space still counts. Each run starts and ends on a
  // word boundary, so "Ben" is not found inside "Bent".
  const target = wanted.join("");
  for (let i = 0; i < found.length; i += 1) {
    let joined = "";
    for (let k = i; k < found.length && joined.length < target.length; k += 1) {
      joined += found[k]!.f;
      if (joined === target) return { score: 0.7, kind: "word" };
    }
  }
  return NONE;
}

/**
 * How well `text` names the artist `name`.
 *
 * `name` is the RA name as it is; its parenthetical suffix is stripped here.
 * `field: "account"`: `text` is a whole display name, permalink or full name.
 * `field: "title"`: `text` is a track or item title.
 *
 * A `word` match is only as strong as the title it sits in. A title such as
 * "Hugo Boss FW26 runway mix" contains the name as a word and gets `word`, the
 * same as "Hugo @ feedbk 10.10.26" does: this function does not tell a credit
 * from a coincidence. The resolver must ask for other evidence before it trusts
 * a `word`, and it must do the same for an `exact` match on a common single word.
 */
export function matchName(name: string, text: string, field: "account" | "title"): NameMatch {
  const n = bareName(name);
  if (!n || !text) return NONE;
  return field === "account" ? matchAccount(n, text) : matchTitle(n, text);
}
