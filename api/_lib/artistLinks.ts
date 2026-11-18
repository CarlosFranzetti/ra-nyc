import {
  buildArtistContext,
  isContradicted,
  isCorroborated,
  scoreCandidate,
  type ArtistContext,
  type CandidateProfile,
  type RaOrigin,
} from "./artistContext.js";
import { getSql } from "./db.js";
import { artistAppearances, type ArtistAppearance } from "./eventCache.js";
import { bareName, fold, matchName } from "./fuzzy.js";
import { normalizeName } from "./normalize.js";
import { NYC_AREA_ID } from "./ra.js";

/**
 * Resolves a DJ to playable sets, a bio, and profile links.
 *
 * RA gives us a name and an id and nothing else — no social handles. So every
 * result here is either *searched for* (and therefore occasionally wrong) or a
 * search URL we hand to the user.
 *
 * ## Sources, in the order sets are preferred
 *
 * | Provider | Search | Embed | Needs a key? |
 * | --- | --- | --- | --- |
 * | SoundCloud | official API or api-v2 | widget, keyless | **yes** — see `soundcloudMode` |
 * | Mixcloud | public API | widget | no |
 * | Internet Archive | advancedsearch | `/embed/` | no |
 *
 * SoundCloud is first because it has the most DJ sets, but it is also the only
 * provider here that needs credentials, and it issues two incompatible kinds —
 * see `soundcloudMode` for how we tell them apart. We do not scrape a
 * `client_id` out of their web bundle: that works around an access control they
 * put up on purpose, and breaks whenever they rebuild. Without a key SoundCloud
 * degrades to a search link and Mixcloud + Archive still fill the list.
 *
 * Embedding a *known* SoundCloud URL needs no key, so once a track is resolved
 * playback works the same either way.
 */

export { normalizeName };

export type SetProvider = "soundcloud" | "mixcloud" | "archive";

/**
 * How many sets an artist's queue can hold.
 *
 * This used to be 3, back when a set was a taster embedded in the artist sheet.
 * With a persistent transport, `next` is expected to keep going — so the queue
 * is the artist's catalogue, not a sample of it. The sheet still shows a short
 * list by default; the cap here only bounds the payload and the upstream calls.
 */
export const MAX_SETS = 50;

export interface ArtistSet {
  provider: SetProvider;
  /** Stable per-provider identifier, used as a React key. */
  id: string;
  title: string;
  /** Canonical page for the set. */
  url: string;
  /** Iframe src for in-app playback. */
  embedUrl: string;
  /** Seconds. */
  duration: number | null;
  plays: number | null;
  createdAt: string | null;
  /**
   * Square-ish cover art. Only consumer is the OS lock screen / notification
   * shade via the Media Session API, which is also why it is worth carrying:
   * without it a locked phone shows a generic placeholder next to the title.
   */
  artwork: string | null;
}

export interface ArtistBio {
  text: string;
  /** Where the prose came from, so the UI can attribute it. */
  source: "Resident Advisor" | "SoundCloud" | "Mixcloud";
  url: string | null;
}

/** An outbound profile link shown under the bio. */
export interface ArtistLink {
  label: string;
  url: string;
  /** Sub-label; distinguishes a real profile from a name search. */
  detail: string;
  /** True when we matched an actual profile rather than building a search URL. */
  resolved: boolean;
}

/** Links shown under the bio. RA is excluded — it *is* the bio. */
const MAX_LINKS = 5;

export interface ArtistLinks {
  id: string;
  name: string;
  mixcloudUser: string | null;
  mixcloudUrl: string | null;
  soundcloudUser: string | null;
  soundcloudUrl: string | null;
  raUrl: string | null;
  bio: ArtistBio | null;
  sets: ArtistSet[];
  /** Ranked and capped at MAX_LINKS, resolved profiles before searches. */
  links: ArtistLink[];
  linkSource: "auto" | "manual" | "none";
  cached: boolean;
}

const UPSTREAM_TIMEOUT_MS = 7_000;

/**
 * Tighter budget for RA, because it is the one blocking call.
 *
 * Everything else races its own deadline concurrently; RA sits in front of
 * SoundCloud and Mixcloud, so every second it spends is a second they do not
 * get. Three is enough for two sequential GraphQL round trips on a good day and
 * short enough that a bad one costs the context, not the catalogue.
 */
const RA_TIMEOUT_MS = 3_000;

/**
 * SoundCloud and Mixcloud are where a DJ actually posts, so we pull their
 * catalogue rather than a sample — that is what makes `next` keep working.
 */
const CATALOGUE_LIMIT = 50;

/**
 * The Archive is the fallback for artists the first two don't cover, and its
 * matching is the loosest of the three. Pulling fifty guesses would bury a real
 * catalogue under near-misses, so it stays small.
 */
const FALLBACK_LIMIT = 4;

/**
 * Shortest thing SoundCloud can offer that is plausibly a DJ set.
 *
 * SoundCloud is a track host as much as a mix host, so an artist's uploads are
 * usually a mix of both — and a four-minute single is not what "play a set"
 * means. Forty-five minutes is the floor: long enough to exclude singles, edits
 * and IDs, short enough to keep a one-hour radio slot.
 *
 * Applied to SoundCloud only. Mixcloud is mixes by construction, and the
 * Archive fallback is already filtered hard on title.
 */
const MIN_SOUNDCLOUD_SECONDS = 45 * 60;

/**
 * Shortest Mixcloud upload that is plausibly a set.
 *
 * "Mixcloud is mixes by construction" was wrong in practice: Cosmo (NY)'s
 * catalogue held eight uploads of 135-262 seconds ("Not Like Us ... Remix"), and
 * with a persistent queue the next one up would simply play. Twenty minutes
 * rather than SoundCloud's forty-five because radio shows on Mixcloud
 * legitimately run short. An upload with no reported length is kept, as the
 * API omitting it says nothing about the audio.
 */
const MIN_MIXCLOUD_SECONDS = 20 * 60;

/**
 * Most sets one provider may contribute before the merge sort.
 *
 * Colleen Murphy's fifty Mixcloud uploads are all weekly "Balearic Breakfast"
 * episodes; sorted newest-first across providers and cut at MAX_SETS, they left
 * no room for anything else. See `orderSets` for how the leftover slots are
 * handed back.
 */
const PER_PROVIDER_CAP = 30;

/**
 * The Archive's own budget when it runs as a fallback, after the other two.
 *
 * 3s (RA) + 7s (catalogue) + 4s here is 14s, inside the 15s `maxDuration`.
 */
const ARCHIVE_TIMEOUT_MS = 4_000;

// ─── Name matching ──────────────────────────────────────────────────────────

/**
 * Decorations that come *before* a name: `djobjekt`, `theblessedmadonna`.
 *
 * Kept apart from the trailing set because position carries meaning. A trailing
 * `dj` is not a thing anyone writes, and — more to the point — the two sets get
 * different length rules below.
 */
const LEADING_AFFIXES: readonly string[] = [
  "dj", "the", "iam", "itsme", "real", "official",
];

/**
 * Decorations that come *after* one: `objektsound`, `avalonemersonmusic`.
 *
 * The point of the list is that it is *boring*. An artist who is not called
 * "Objekt" does not end up at `objektsound`; someone who is may well. Anything
 * carrying meaning of its own — `naut`, `fanpage`, `archive`, `edits`,
 * `bootlegs` — is deliberately absent, because those are the remainders that
 * signal a different account rather than the same one dressed up.
 *
 * **Nothing here is shorter than three characters, and that is the whole
 * defence.** A two-letter allowance let `ny`, `la`, `us`, `de` and `it` through,
 * and those are not rare geographic tags — they are how ordinary English words
 * end. `Harmony` matched an account called `harmo`; `Cosmo` matched `cosmola`.
 * That is precisely the class of miss this rule exists to stop, arriving via a
 * two-character coincidence instead of an unrestricted suffix.
 *
 * The cost is real and accepted: `objektuk` no longer resolves. An artist who
 * tags their handle with a two-letter country now gets an empty list rather
 * than a wrong one, which is the trade this whole file is built on.
 *
 * Normalisation has already removed spaces, punctuation and case by the time
 * these are compared, so `dj_objekt`, `DJ Objekt` and `djobjekt` are one case.
 */
const TRAILING_AFFIXES: readonly string[] = [
  "official", "music", "musik", "sound", "sounds", "audio",
  "live", "real", "world", "online",
  // Scene cities. The earlier list stopped at nyc and berlin, which quietly
  // said a Chicago or Detroit handle was less legitimate than a Berlin one.
  "nyc", "usa", "brooklyn", "chicago", "detroit", "berlin", "london", "paris",
  "amsterdam", "rotterdam", "tokyo", "osaka", "glasgow", "manchester",
  "bristol", "leeds", "dublin", "lisbon", "madrid", "barcelona", "milan",
  "vienna", "warsaw", "prague", "budapest", "montreal", "toronto", "melbourne",
  "sydney", "oslo", "stockholm", "copenhagen", "helsinki", "hamburg",
  "cologne", "leipzig", "munich", "zurich", "brussels",
];

/**
 * Shortest name allowed to match on anything but equality.
 *
 * Short names collide, so below this the only acceptable answer is an exact
 * match. Four rather than five because the allowlist now does the work the
 * length floor used to: with an unbounded suffix, five was barely enough; with
 * a closed set of decorations, four still rules out the collisions while
 * letting Or:la, DVS1 and every other four-letter name reach `orlamusic`
 * instead of matching nothing but themselves.
 */
const MIN_CORE_LENGTH = 4;

/** Whether `rest` is nothing but stacked decoration, e.g. "" / "music" / "musicofficial". */
function isDecoration(rest: string, affixes: readonly string[]): boolean {
  if (!rest) return true;
  for (const affix of affixes) {
    if (rest === affix) return true;
    // Two is as far as this goes: `objektmusicofficial` is real, a third
    // stacked token is more likely a different word that happens to start alike.
    if (rest.startsWith(affix) && affixes.includes(rest.slice(affix.length))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a candidate account plausibly *is* this artist.
 *
 * Deliberately strict. A confidently wrong result — someone else's sets under a
 * DJ's name — is worse than an empty list.
 *
 * The rule is that one name may contain the other, but everything left over has
 * to be decoration. A bare "starts with" test is not enough on its own and used
 * to be exactly what this did: it accepted `cosmonaut` for Cosmo and
 * `lakutifanpage` for Lakuti, which is not a near miss but a different account
 * entirely. The damage is larger than one bad set, because matching a profile
 * flips `ownUploads` and switches off the per-track filter downstream — one
 * wrong profile adopts a whole catalogue.
 *
 * A length cap would not have fixed it: `cosmonaut` is four characters longer
 * than `cosmo`, shorter than the legitimate suffix in `avalonemersonmusic`. So
 * the test is on *what* the extra characters are, not how many.
 *
 * Symmetric, so it covers both `objektsound` and `djobjekt`.
 */
export function isPlausibleMatch(artistName: string, candidate: string): boolean {
  const a = normalizeName(artistName);
  const b = normalizeName(candidate);
  if (!a || !b) return false;
  if (a === b) return true;

  const [core, whole] = a.length <= b.length ? [a, b] : [b, a];
  if (core.length < MIN_CORE_LENGTH) return false;

  if (whole.startsWith(core)) return isDecoration(whole.slice(core.length), TRAILING_AFFIXES);
  if (whole.endsWith(core)) {
    return isDecoration(whole.slice(0, whole.length - core.length), LEADING_AFFIXES);
  }
  return false;
}

/**
 * The name as it should be *searched for*, parenthetical stripped.
 *
 * "Cosmo (NY)" is RA's way of telling two Cosmos apart; it is not part of
 * anyone's SoundCloud, Mixcloud or Archive listing. Sent as written it made
 * every provider query ask for a literal "(NY)" and, on the Archive, an exact
 * phrase nothing contains. The parenthetical is still read — by
 * `buildArtistContext`, which is where it belongs.
 */
export function searchName(name: string): string {
  const stripped = name.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return stripped || name.trim();
}

interface Word {
  word: string;
  /** Offsets into the original string, so what sits *between* words can be read. */
  start: number;
  end: number;
}

/** Whole words, accent-folded and lowercased, with their positions. */
function wordsOf(value: string): Word[] {
  const out: Word[] = [];
  for (const m of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = normalizeName(m[0]);
    if (word) out.push({ word, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

/**
 * Names this short are ordinary words or fragments of longer names, so merely
 * appearing in a title is not evidence.
 */
const SHORT_NAME_LENGTH = 7;

/** What follows an artist credit: "Cosmo @ Nowadays", "Cosmo - Live", "Cosmo mix". */
const CREDIT_SEPARATOR = /^\s*(?:@|[-\u2013\u2014]\s|presents\b|mix\b)/i;

/**
 * For free-text titles: does the artist's name appear in it as a name?
 *
 * Whole words only. The old test was a substring over the title with every
 * separator removed, so "Cosmo" was "mentioned" by "Cosmos Radio Hour",
 * "Cosmopolitan Brunch Mix" and "Radio Cosmo - Conspiracion", and three of
 * those were adopted as the artist's sets from the Archive.
 *
 * A name of seven letters or fewer must also open the title (an optional "DJ"
 * aside) and be followed by the separator an artist credit uses. Without that,
 * "Lepota Luba Cosmo - Lowest Edge" - someone else with Cosmo in their name -
 * still passed.
 */
export function titleMentions(artistName: string, title: string): boolean {
  const name = wordsOf(searchName(artistName)).map((w) => w.word);
  if (name.join("").length < 4) return false;

  const words = wordsOf(title);
  const at = words.findIndex(
    (_, i) => i + name.length <= words.length && name.every((w, k) => words[i + k]!.word === w),
  );
  if (at < 0) return false;
  if (name.join("").length > SHORT_NAME_LENGTH) return true;

  if (at > 1 || (at === 1 && words[0]!.word !== "dj")) return false;
  return CREDIT_SEPARATOR.test(title.slice(words[at + name.length - 1]!.end));
}

/**
 * The strictest title test: the artist's name is the *first* thing in the title
 * (an optional "DJ" aside) and is followed by a credit separator. "Cosmo @ The
 * Lot Radio" and "Test DJ - Live at Somewhere" pass; "PENELOPE", "Penelope
 * Moro" and "Entrevista a Penelope Moro" do not, which is the point. The
 * Archive's titles are free text from anyone, so for it this is all that a bare
 * name earns.
 */
export function leadingCredit(artistName: string, title: string): boolean {
  const name = wordsOf(searchName(artistName)).map((w) => w.word);
  if (name.join("").length < 4) return false;
  const words = wordsOf(title);
  const at = words[0]?.word === "dj" ? 1 : 0;
  if (!name.every((w, k) => words[at + k]?.word === w)) return false;
  return CREDIT_SEPARATOR.test(title.slice(words[at + name.length - 1]!.end));
}

/**
 * What a fetch can come back as.
 *
 * `null` used to stand for all of: rate-limited, server error, timeout, network
 * failure and a perfectly good empty answer. The caller could not tell "this
 * artist has nothing" from "SoundCloud was having a bad second", and cached
 * both for good. An empty 200 is `ok: true` with whatever it contained.
 */
export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "http" | "timeout" | "network"; status?: number };

/**
 * Whether a failure is worth retrying later rather than remembering.
 *
 * A 404 or 410 is an answer — the handle in a bio does not exist — and treating
 * it as an outage would leave every artist with one stale handle uncached.
 */
export function isTransient(result: FetchResult<unknown>): boolean {
  if (result.ok) return false;
  if (result.reason === "http") return result.status !== 404 && result.status !== 410;
  return true;
}

async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<FetchResult<T>> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ra-nyc/1.0 (+https://ra-nyc.vercel.app)",
        ...headers,
      },
      signal,
    });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (error) {
    // A failed side-source must never fail the whole lookup.
    const name = (error as { name?: string } | null)?.name;
    return {
      ok: false,
      reason: name === "AbortError" || name === "TimeoutError" ? "timeout" : "network",
    };
  }
}

/** One provider's answer, and whether it is complete enough to remember. */
interface Resolved<T> {
  value: T | null;
  /** True when something failed in a way a retry might fix. Not cached long. */
  degraded: boolean;
}

// ─── SoundCloud ─────────────────────────────────────────────────────────────

interface ScUser {
  id?: number;
  username?: string;
  /** The account's real handle; `username` is a free-text display name. */
  permalink?: string;
  permalink_url?: string;
  full_name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  // The fields below are recalled from api-v2 user objects and have not been
  // checked against a live response from here. Each is optional, and ranking
  // reads a field only when it is present.
  city?: string | null;
  country_code?: string | null;
  followers_count?: number;
  track_count?: number;
  verified?: boolean;
}
interface ScTrack {
  id?: number;
  title?: string;
  permalink_url?: string;
  duration?: number;
  playback_count?: number;
  created_at?: string;
  artwork_url?: string | null;
  /** Free text the uploader wrote; searched for evidence terms, never shown. */
  description?: string | null;
  tag_list?: string | null;
  user?: ScUser;
}

/**
 * SoundCloud hands back the `-large` variant, which is 100x100 — visibly soft
 * blown up to lock-screen size. The size is just a filename token, so asking
 * for the 500px one costs nothing. Falls back to the uploader's avatar, since
 * plenty of DJ sets carry no per-track art.
 */
function soundcloudArtwork(track: ScTrack): string | null {
  const raw = track.artwork_url ?? track.user?.avatar_url ?? null;
  return raw ? raw.replace("-large.", "-t500x500.") : null;
}

function soundcloudEmbed(trackUrl: string): string {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(
    trackUrl,
  )}&color=%23ffffff&auto_play=false&hide_related=true&show_comments=false&show_user=true&visual=false`;
}

/**
 * Which SoundCloud credential shape is configured.
 *
 * SoundCloud has two different APIs and the credentials look deceptively alike:
 *
 * - `official` — a client id *and* secret from their developer portal. These
 *   only work against `api.soundcloud.com`, and only after exchanging them for
 *   a bearer token; since 2021 a bare client id is rejected there.
 * - `api-v2` — a lone client id, which is what their own web player uses
 *   against `api-v2.soundcloud.com`.
 *
 * Guessing wrong fails silently — every request 401s and SoundCloud looks like
 * it simply has nothing, which is indistinguishable from no key at all. So we
 * branch on which variables are present rather than probing.
 */
export function soundcloudMode(): "official" | "api-v2" | "off" {
  if (!process.env.SOUNDCLOUD_CLIENT_ID) return "off";
  return process.env.SOUNDCLOUD_CLIENT_SECRET ? "official" : "api-v2";
}

/**
 * Cached client-credentials token.
 *
 * Tokens last an hour, so re-minting one per artist lookup would roughly double
 * the request count for no benefit. Module memory means per-instance rather
 * than global, which is fine — the worst case is a few extra token calls after
 * a cold start.
 */
let scToken: { value: string; expiresAt: number } | null = null;

async function soundcloudAccessToken(signal?: AbortSignal): Promise<string | null> {
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (scToken && scToken.expiresAt > Date.now()) return scToken.value;

  try {
    const res = await fetch("https://secure.soundcloud.com/oauth/token", {
      method: "POST",
      headers: {
        Accept: "application/json; charset=utf-8",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal,
    });
    if (!res.ok) {
      // Worth a log line: a bad secret is otherwise invisible downstream.
      console.warn("[soundcloud] token request failed", res.status);
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;

    // Expire a minute early so a token can't lapse mid-request.
    const ttl = (json.expires_in ?? 3600) * 1000 - 60_000;
    scToken = { value: json.access_token, expiresAt: Date.now() + Math.max(ttl, 0) };
    return scToken.value;
  } catch {
    return null;
  }
}

/** The account's handle: `permalink`, or the last path segment of its URL. */
function soundcloudHandle(user: ScUser | undefined): string | null {
  if (!user) return null;
  if (user.permalink) return user.permalink;
  const tail = user.permalink_url?.replace(/[?#].*$/, "").split("/").filter(Boolean).pop();
  return tail || null;
}

/**
 * The name test, on every field an account can carry its name in.
 *
 * Display name only was the old rule, and it let anyone who typed "Cosmo" into
 * their profile through while rejecting `cosmo_nyc`, whose display name might be
 * anything. The permalink is what the account actually *is*.
 */
function scNameFields(user: ScUser): string[] {
  return [user.username, user.permalink, user.full_name].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
}

function scMatchesName(name: string, user: ScUser): boolean {
  return scNameFields(user).some((field) => isPlausibleMatch(name, field) || isFoldedName(name, field));
}

/** The same name once look-alikes are folded: `h0l0` is `Holo`. */
function isFoldedName(name: string, field: string): boolean {
  const kind = matchName(name, field, "account").kind;
  return kind === "exact" || kind === "folded";
}

/**
 * A keyboard slip or a one-letter miss (`aergio` for `Sergio`). Never enough on
 * its own: the resolver admits such an account only when its own profile
 * corroborates it, because `Cosmo` and `Cosma` are different people.
 */
function scFuzzyName(name: string, user: ScUser): boolean {
  return scNameFields(user).some((field) => matchName(name, field, "account").kind === "fuzzy");
}

/** Exactly the artist's name, not merely a decorated version of it. */
function isExactName(name: string, fields: string[]): boolean {
  const self = fold(bareName(name));
  return Boolean(self) && fields.some((f) => fold(f) === self);
}

/**
 * Chooses among accounts that already passed the name test.
 *
 * Returns `refused` when two or more accounts carry the artist's exact name and
 * nothing separates them: top score no better than zero, and under three points
 * clear of the runner-up. Guessing there is how Cosmo (NY) ended up with a
 * Florida DJ's account, and "wrong is worse than empty" is the rule this file
 * is built on. Callers mark a refusal `degraded` so it is not remembered for a
 * week - a later RA field or a better search may break the tie.
 *
 * A *sole* candidate is dropped when the evidence contradicts it (a bio naming
 * somewhere else, with nothing to corroborate), because there is nothing for it
 * to out-rank and it would otherwise win by default.
 */
export function chooseAccount<T>(
  candidates: T[],
  score: (candidate: T) => number,
  isExact: (candidate: T) => boolean,
  contradicted: (candidate: T) => boolean,
  options: { refuseTies: boolean },
): { pick: T | undefined; refused: boolean } {
  if (candidates.length === 0) return { pick: undefined, refused: false };

  const ranked = candidates
    .map((candidate, index) => ({ candidate, index, score: score(candidate) }))
    // Stable on ties: the provider's own relevance order is the tie-break.
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (ranked.length === 1) {
    return { pick: contradicted(ranked[0]!.candidate) ? undefined : ranked[0]!.candidate, refused: false };
  }

  if (options.refuseTies && ranked.filter((r) => isExact(r.candidate)).length >= 2) {
    const margin = ranked[0]!.score - ranked[1]!.score;
    if (ranked[0]!.score <= 0 && margin < 3) return { pick: undefined, refused: true };
  }
  return { pick: ranked[0]!.candidate, refused: false };
}

// ─── Evidence ───────────────────────────────────────────────────────────────

/** How long the lineup-history read may hold up the resolve. */
const INDEX_TIMEOUT_MS = 1_500;

/**
 * Evidence track searches per cold resolve. Each is one request and all of them
 * run alongside the user search, inside the same 7-second window.
 */
const EVIDENCE_QUERIES = 3;
const EVIDENCE_TRACK_LIMIT = 30;

/**
 * The floor for a set found by name plus evidence on an account that is not the
 * artist's own. Radio shows and club nights routinely run 30 to 40 minutes and
 * the 45-minute floor lost all of them; see `judgeTrack` for what stops a
 * single or an interview getting in at this length.
 */
const MIN_RADIO_SECONDS = 20 * 60;

/** Whether `term` is written in `text` as whole words: "feedbk" in "feedbk w/ Hugo". */
function termIn(term: string, text: string): boolean {
  return Boolean(term) && matchName(term, text, "title").kind !== "none";
}

/** Where a listing title stops being the party's name: "feedbk with Borja S, Hugo". */
const PARTY_BREAK = /\s[-–—]\s|[:,/+|@&]|\s(?:with|w\/|presents|feat\.?|ft\.?|x|b2b|vs\.?)\s/i;

function partyName(title: string): string | null {
  const head = title.split(PARTY_BREAK)[0]?.trim() ?? "";
  const count = head.split(/\s+/).filter(Boolean).length;
  return count >= 1 && count <= 4 ? head : null;
}

/**
 * Venues and party names from the artist's own dates in our index, most
 * frequent first. The point is that the index knows things the biography does
 * not: nothing on RA says Hugo plays feedbk, but he has played it every other
 * week since September, and a set titled "feedbk w/ Hugo" is therefore his.
 *
 * Anything containing the artist's own name is dropped ("Laurel Halo All
 * Night" would otherwise make the name its own evidence), as is a TBA venue.
 */
export function indexEvidence(name: string, appearances: ArtistAppearance[]): string[] {
  const self = fold(bareName(name));
  const tally = new Map<string, { text: string; count: number }>();
  const add = (raw: string | null): void => {
    const text = raw?.replace(/\s+/g, " ").trim();
    if (!text || /^tba\b/i.test(text)) return;
    const key = fold(text);
    if (key.length < 4 || (self && key.includes(self))) return;
    const seen = tally.get(key);
    if (seen) seen.count += 1;
    else tally.set(key, { text, count: 1 });
  };
  for (const row of appearances) {
    add(row.venue);
    add(partyName(row.title));
  }
  return [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .map((entry) => entry.text)
    .slice(0, 6);
}

/** Digits typed for letters, in the order promoters use them. */
const DELEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/**
 * `h0l0` -> `holo`, but only for a word with a digit *inside* it. `DVS1`, `4AM`
 * and `Kode9` carry their digits as part of the name and are left alone.
 */
function deleet(word: string): string {
  return /[a-z][0134578][a-z]/i.test(word)
    ? word.replace(/[0134578]/g, (digit) => DELEET[digit] ?? digit)
    : word;
}

/**
 * What to type into SoundCloud's user search, best first: the bare name, then
 * its de-leeted spelling, or failing that the name without a leading "DJ".
 * Two at most; each is a request.
 */
export function userQueries(name: string): string[] {
  const bare = bareName(name);
  const out = [bare];
  const spelled = bare.split(/\s+/).map(deleet).join(" ");
  if (spelled !== bare) out.push(spelled);
  else {
    const withoutDj = bare.replace(/^dj\s+/i, "");
    if (withoutDj !== bare && fold(withoutDj).length >= 4) out.push(withoutDj);
  }
  return out;
}

/** Track searches: the bare name next to each of the best evidence terms. */
export function evidenceQueries(name: string, evidence: string[]): string[] {
  const bare = bareName(name);
  return evidence
    .filter((term) => fold(term).length >= 4)
    .slice(0, EVIDENCE_QUERIES)
    .map((term) => `${bare} ${term}`);
}

/** A title that is a conversation about the artist rather than a set by them. */
const INTERVIEW = /interview|entrevista|entretien|intervista|\btalk\b|conversation|q\s*&\s*a|lecture|panel|audiobook|\bepisode\b/i;
/** What lets an interview-looking title through: it says it is music. */
const MUSIC_WORD = /\b(?:mix|set|live|b2b|b3b)\b|@/i;
/** What a 20 to 45 minute upload must say to be a set and not a single. */
const SET_WORD = /(?:^|[^\p{L}\p{N}])(?:mix|set|live|show|radio|b2b|b3b|w|with|presents)(?:$|[^\p{L}\p{N}])|@|\bw\//iu;

/** Digits and letters of a name, as one word: a name is "common" when this is short. */
const COMMON_NAME_LENGTH = 8;

/**
 * A single short word names a great many people: Hugo, Holo, Cosmo, Penelope.
 * A match on the display name alone is not evidence for these. Two words, or one
 * long distinctive one, are rarely shared and are taken on the name.
 */
export function isCommonName(name: string): boolean {
  const bare = bareName(name);
  return !/\s/.test(bare) && fold(bare).length <= COMMON_NAME_LENGTH;
}

interface SoundcloudResult {
  user: string | null;
  /** The account's real handle, when known. */
  handle: string | null;
  url: string | null;
  description: string | null;
  sets: ArtistSet[];
  /**
   * Whether the account is believed to be the artist's. A common name matched
   * on its display name alone is not: the profile is still offered as a link,
   * but its description is not used as a bio and its uploads are not trusted.
   */
  confirmed: boolean;
}

async function resolveSoundcloud(
  name: string,
  context: ArtistContext,
  signal?: AbortSignal,
): Promise<Resolved<SoundcloudResult>> {
  const mode = soundcloudMode();
  if (mode === "off") return { value: null, degraded: false };

  let degraded = false;
  /** Unwraps a fetch, remembering whether a failure was worth retrying. */
  const take = <T>(result: FetchResult<T>): T | null => {
    if (result.ok) return result.data;
    if (isTransient(result)) degraded = true;
    return null;
  };
  /** The official API returns bare arrays; api-v2 wraps them in `collection`. */
  const listOf = <T extends object>(raw: T[] | { collection?: T[] } | null): T[] =>
    (Array.isArray(raw) ? raw : (raw?.collection ?? [])).filter(
      // A null element has been seen in these lists; it must not take the lookup down.
      (item): item is T => Boolean(item) && typeof item === "object",
    );

  const clientId = process.env.SOUNDCLOUD_CLIENT_ID as string;
  const bare = bareName(name);
  const evidence = context.evidence ?? [];
  const enc = encodeURIComponent;
  // One request either way; a name as common as Cosmo has far more than five
  // same-named accounts, and the right one was routinely not in the first five.
  const USER_LIMIT = 20;

  // The two APIs differ in host, auth and search paths, but return close enough
  // shapes that everything below this block is shared.
  let auth: Record<string, string> | undefined;
  let userSearch: (query: string) => string;
  let resolveHandle: (handle: string) => string;
  let trackSearch: (query: string, limit: number) => string;
  let userTracks: (userId: number) => string;

  if (mode === "official") {
    const token = await soundcloudAccessToken(signal);
    // A configured-but-broken secret must not silently fall through to api-v2:
    // that would 401 too, just less obviously. It is an outage, not an answer.
    if (!token) return { value: null, degraded: true };
    const base = "https://api.soundcloud.com";
    auth = { Authorization: `OAuth ${token}` };
    userSearch = (query) => `${base}/users?q=${enc(query)}&limit=${USER_LIMIT}`;
    resolveHandle = (handle) => `${base}/resolve?url=${enc(`https://soundcloud.com/${handle}`)}`;
    trackSearch = (query, limit) => `${base}/tracks?q=${enc(query)}&limit=${limit}`;
    userTracks = (userId) => `${base}/users/${userId}/tracks?limit=${CATALOGUE_LIMIT}`;
  } else {
    const base = "https://api-v2.soundcloud.com";
    const credential = `&client_id=${enc(clientId)}`;
    userSearch = (query) => `${base}/search/users?q=${enc(query)}&limit=${USER_LIMIT}${credential}`;
    resolveHandle = (handle) =>
      `${base}/resolve?url=${enc(`https://soundcloud.com/${handle}`)}&client_id=${enc(clientId)}`;
    trackSearch = (query, limit) => `${base}/search/tracks?q=${enc(query)}&limit=${limit}${credential}`;
    userTracks = (userId) => `${base}/users/${userId}/tracks?limit=${CATALOGUE_LIMIT}${credential}`;
  }

  type TrackList = ScTrack[] | { collection?: ScTrack[] };

  // Searches for the name beside each thing we know about the artist start now
  // and overlap everything below: nobody types "Hugo" and gets feedbk's radio
  // show, but "Hugo feedbk" finds it. They are results to be judged, not
  // answers; the account choice below never sees them.
  const evidenceSearches = Promise.all(
    evidenceQueries(name, evidence).map((query) =>
      fetchJson<TrackList>(trackSearch(query, EVIDENCE_TRACK_LIMIT), signal, auth),
    ),
  );

  // A handle the artist gave RA outright beats anything a name search can
  // offer, so it skips the search. Guarded on `kind`, because /resolve happily
  // returns a track or a playlist for the wrong kind of URL.
  //
  // A handle merely *found in a bio* is held to the name test as well: the
  // first soundcloud.com link in prose is as likely a collaborator, a label or
  // a mix host as the artist. One that fails it is demoted to a +5 nudge for
  // any search result that turns out to be that same account.
  let user: ScUser | undefined;
  let givenHandle = false;
  let boostedHandle: string | null = null;
  if (context.handles.soundcloud) {
    const resolved = take(
      await fetchJson<ScUser & { kind?: string }>(
        resolveHandle(context.handles.soundcloud),
        signal,
        auth,
      ),
    );
    if (resolved?.username && (resolved.kind ?? "user") === "user") {
      if (context.handleSource.soundcloud === "structured" || scMatchesName(name, resolved)) {
        user = resolved;
        givenHandle = true;
      } else {
        boostedHandle = context.handles.soundcloud.toLowerCase();
      }
    }
  }

  const profile = (u: ScUser): CandidateProfile => ({
    permalink: u.permalink,
    description: u.description,
    city: u.city,
    countryCode: u.country_code,
    followers: u.followers_count,
    trackCount: u.track_count,
    verified: u.verified,
  });
  /** Whether an account's own description carries something we know about the artist. */
  const echoesEvidence = (u: ScUser): boolean =>
    evidence.some((term) => termIn(term, `${u.description ?? ""} ${u.city ?? ""}`));
  const corroborated = (u: ScUser): boolean => isCorroborated(context, profile(u)) || echoesEvidence(u);

  /** Set once the search below has decided not to run a bare-name track search. */
  let skipScoped = false;

  if (!user) {
    const responses = await Promise.all(
      userQueries(name).map((query) => fetchJson<TrackList>(userSearch(query), signal, auth)),
    );
    // Merged by account id, in query order, so SoundCloud's own ranking is only
    // the tie-break it always was: what decides is our own scoring below.
    const seen = new Set<unknown>();
    const list: ScUser[] = [];
    for (const response of responses) {
      for (const u of listOf(take(response) as unknown as ScUser[] | null)) {
        const key = u.id ?? u.permalink_url ?? u.permalink;
        if (key !== undefined && seen.has(key)) continue;
        seen.add(key);
        list.push(u);
      }
    }

    // Two artists can share a name exactly, and then no amount of string
    // matching separates them — the first search hit used to win by default.
    // What can is how well each account's own description of itself fits what
    // RA says about the artist.
    const matches = list.filter(
      (u) => scMatchesName(name, u) || (scFuzzyName(name, u) && corroborated(u)),
    );
    const { pick, refused } = chooseAccount(
      matches,
      (u) =>
        scoreCandidate(name, context, profile(u)) +
        (boostedHandle && soundcloudHandle(u)?.toLowerCase() === boostedHandle ? 5 : 0),
      (u) => isExactName(name, scNameFields(u)),
      (u) => isContradicted(context, profile(u)),
      { refuseTies: true },
    );
    // No account, and no scoped track search either: that search would adopt
    // any upload whose uploader merely *looks* like the name, which is exactly
    // the wrong-Cosmo case we just declined to guess at.
    if (refused) {
      degraded = true;
      skipScoped = true;
    } else if (!pick && matches.length > 0) {
      skipScoped = true;
    }
    user = pick;
  }

  const readTracks = async (url: string): Promise<ScTrack[]> =>
    listOf(take(await fetchJson<TrackList>(url, signal, auth)));

  const own = user?.id ? await readTracks(userTracks(user.id)) : [];

  const common = isCommonName(name);
  const self = fold(bare);
  const nameInTitle = (title: string): boolean => matchName(name, title, "title").kind !== "none";
  const haystack = (t: ScTrack): string =>
    [t.title, t.user?.username, t.user?.permalink, t.description, t.tag_list].filter(Boolean).join(" ");
  const carriesEvidence = (t: ScTrack): boolean => {
    const text = haystack(t);
    return evidence.some((term) => termIn(term, text));
  };

  // A common name matched on its display name alone is not yet the artist. It
  // needs one thing more: a handle RA or the bio gave, a description or city
  // that fits, a permalink that is the name itself, a verified badge or a real
  // following, or uploads that carry the name beside something we know.
  const confirmed =
    Boolean(user) &&
    (!common ||
      givenHandle ||
      (user !== undefined &&
        (fold(user.permalink ?? "") === self ||
          user.verified === true ||
          (user.followers_count ?? 0) >= 5_000 ||
          corroborated(user))) ||
      own.some((t) => nameInTitle(t.title ?? "") && carriesEvidence(t)));

  const rejected: string[] = [];
  const floor = MIN_SOUNDCLOUD_SECONDS * 1000;
  const trustUploader = !common || confirmed;

  /**
   * Whether a track is one of this artist's sets.
   *
   * `own` tracks come from an account we believe is the artist's, so they pass
   * on length alone. Anything else — search hits, or the uploads of an account
   * we only half believe — has to carry the name. Two routes qualify: the
   * credit form (`Name @ Somewhere`, as before) or the name written in the
   * title beside an evidence term anywhere in the title, uploader or tags, so a
   * radio station's "heads up w penelope" counts when the station is one the
   * biography or the index names.
   *
   * Only that second route may go below 45 minutes, to 20, and only on someone
   * else's account. A single is 3 to 8 minutes and a 20-minute upload without a
   * word that says it is music ("mix", "set", "live", "radio", "@", "w/") is
   * still not admitted; an interview, talk or audiobook is refused at any
   * length unless the title also says mix, set, live, b2b or "@". No list of
   * radio stations is needed: the evidence term is what ties it to the artist.
   */
  const judge = (t: ScTrack, mode: "own" | "search"): boolean => {
    const title = t.title ?? "Untitled";
    const no = (why: string): false => {
      if (rejected.length < 10) rejected.push(`${title.slice(0, 60)} (${why})`);
      return false;
    };
    if (!t.permalink_url) return no("no url");
    const ms = t.duration ?? 0;
    if (mode === "own") return ms >= floor ? true : no("short");

    // A conversation about the artist is not a set by them, however long and
    // however well the name is credited.
    if (INTERVIEW.test(title) && !MUSIC_WORD.test(title)) return no("interview");

    const named = nameInTitle(title);
    const evidenced = named && carriesEvidence(t);
    const credited =
      titleMentions(name, title) ||
      (trustUploader && isPlausibleMatch(name, t.user?.username ?? ""));
    if (!credited && !evidenced) return no(named ? "no evidence term" : "name not in title");

    if (ms >= floor) return true;
    const theirs = user?.id !== undefined && t.user?.id === user.id;
    if (evidenced && !theirs && ms >= MIN_RADIO_SECONDS * 1000 && SET_WORD.test(title)) return true;
    return no("short");
  };

  const kept = new Map<string, ArtistSet>();
  const keep = (t: ScTrack, mode: "own" | "search"): void => {
    if (!judge(t, mode)) return;
    const id = `sc-${t.id ?? t.permalink_url}`;
    if (kept.has(id)) return;
    kept.set(id, {
      provider: "soundcloud" as const,
      id,
      title: t.title ?? "Untitled",
      url: t.permalink_url as string,
      embedUrl: soundcloudEmbed(t.permalink_url as string),
      duration: t.duration ? Math.round(t.duration / 1000) : null,
      plays: t.playback_count ?? null,
      createdAt: t.created_at ?? null,
      artwork: soundcloudArtwork(t),
    });
  };

  // The matched account's own uploads first. Only trusted when the account is.
  for (const t of own) keep(t, confirmed ? "own" : "search");
  const ownKept = kept.size;

  // A matched profile with no *sets* is common, and used to end the search
  // here, which is how a DJ with an obvious SoundCloud page ended up showing
  // none of their sets: plenty of them post through labels, radio shows or
  // playlists rather than uploading to their own account. Falling back to the
  // scoped search picks those up, and re-enters strict filtering since these
  // are search hits rather than the artist's own uploads.
  //
  // Decided on what is left *after* the length filter. It used to test the raw
  // track count, so a profile of fifty four-minute singles - which yields
  // nothing playable - never fell back, and the Lot Radio and NTS sets that
  // were the only ones that DJ had stayed unfound.
  let scoped: ScTrack[] = [];
  if (!skipScoped && ownKept === 0) {
    scoped = await readTracks(trackSearch(bare, CATALOGUE_LIMIT));
  }

  const evidenceTracks = (await evidenceSearches).flatMap((response) =>
    listOf(take(response) as unknown as ScTrack[] | null),
  );
  for (const t of [...evidenceTracks, ...scoped]) keep(t, "search");

  console.info("[sc] resolve", {
    artist: bare,
    mode,
    account: user?.id ?? null,
    confirmed,
    common,
    handle: givenHandle,
    own: own.length,
    ownAtFloor: own.filter((t) => (t.duration ?? 0) >= floor).length,
    scoped: scoped.length,
    evidenceTerms: evidence.length,
    evidenceHits: evidenceTracks.length,
    kept: kept.size,
    rejected,
  });

  if (!user && kept.size === 0) return { value: null, degraded };

  return {
    value: {
      user: user?.username ?? null,
      handle: soundcloudHandle(user),
      url: user?.permalink_url ?? null,
      description: confirmed ? user?.description?.trim() || null : null,
      sets: [...kept.values()],
      confirmed,
    },
    degraded,
  };
}

// ─── Mixcloud ───────────────────────────────────────────────────────────────

interface McSearchUser {
  username?: string;
  name?: string;
  url?: string;
  biog?: string | null;
  // Recalled, not verified against a live response; ranking reads a field only
  // when it is present.
  city?: string | null;
  country?: string | null;
  follower_count?: number;
  cloudcast_count?: number;
}
interface McUserSearch {
  data?: McSearchUser[];
}
interface McUser {
  biog?: string | null;
}
interface McCloudcasts {
  data?: {
    key?: string;
    name?: string;
    url?: string;
    audio_length?: number;
    play_count?: number;
    created_time?: string;
    pictures?: { large?: string; extra_large?: string; "1024wx1024h"?: string };
  }[];
}

interface MixcloudResult {
  user: string;
  url: string;
  biog: string | null;
  sets: ArtistSet[];
}

async function resolveMixcloud(
  name: string,
  context: ArtistContext,
  signal?: AbortSignal,
): Promise<Resolved<MixcloudResult>> {
  let degraded = false;
  const take = <T>(result: FetchResult<T>): T | null => {
    if (result.ok) return result.data;
    if (isTransient(result)) degraded = true;
    return null;
  };

  const searchForUser = async () => {
    const search = take(
      await fetchJson<McUserSearch>(
        `https://api.mixcloud.com/search/?q=${encodeURIComponent(searchName(name))}&type=user&limit=5`,
        signal,
      ),
    );
    const text = (u: McSearchUser): CandidateProfile => ({
      permalink: u.username,
      // `country` is free text on Mixcloud rather than a code, so it is read
      // as a place named, not compared as an ISO code.
      description: [u.biog, u.country].filter(Boolean).join(" . ") || null,
      city: u.city,
      followers: u.follower_count,
      trackCount: u.cloudcast_count,
    });
    // Ranked, never refused: Mixcloud search results carry no follower or
    // location fields we can rely on, so two exact-name matches would always
    // look like a tie and every such artist would lose their Mixcloud sets.
    // The provider's own relevance order is the tie-break, as it always was.
    return chooseAccount(
      (search?.data ?? []).filter(
        (u) =>
          (u?.username && isPlausibleMatch(name, u.username)) ||
          (u?.name && isPlausibleMatch(name, u.name)),
      ),
      (u) => scoreCandidate(name, context, text(u)),
      () => false,
      (u) => isContradicted(context, text(u)),
      { refuseTies: false },
    ).pick;
  };

  const load = async (username: string) => {
    const [profile, casts] = await Promise.all([
      fetchJson<McUser>(`https://api.mixcloud.com/${encodeURIComponent(username)}/`, signal),
      fetchJson<McCloudcasts>(
        `https://api.mixcloud.com/${encodeURIComponent(username)}/cloudcasts/?limit=${CATALOGUE_LIMIT}`,
        signal,
      ),
    ]);
    return { profile, casts };
  };

  // Same as SoundCloud: a handle in the RA bio settles it outright. Mixcloud
  // usernames are the URL path, so there is nothing to resolve.
  let match: McSearchUser | undefined;
  let username = context.handles.mixcloud ?? null;
  let profile: McUser | null = null;
  let casts: McCloudcasts | null = null;

  if (username) {
    const loaded = await load(username);
    profile = loaded.profile.ok ? loaded.profile.data : null;
    casts = loaded.casts.ok ? loaded.casts.data : null;
    // A handle lifted from a bio can be stale, or point at an account Mixcloud
    // has since removed. Falling back to the search rather than giving up is
    // the difference between one dead link costing this artist their sets and
    // costing them nothing. Only a *transient* failure of that lookup counts
    // against caching the result: a 404 is the answer, not an outage.
    if (!profile && !casts?.data?.length) {
      username = null;
      if (isTransient(loaded.profile) || isTransient(loaded.casts)) degraded = true;
    }
  }

  if (!username) {
    match = await searchForUser();
    username = match?.username ?? null;
    if (!username) return { value: null, degraded };
    const loaded = await load(username);
    profile = take(loaded.profile);
    casts = take(loaded.casts);
  }

  const sets: ArtistSet[] = (casts?.data ?? [])
    .filter((c): c is NonNullable<typeof c> & { key: string } => Boolean(c.key))
    // Mixes by construction was wrong in practice: see MIN_MIXCLOUD_SECONDS.
    .filter((c) => c.audio_length == null || c.audio_length >= MIN_MIXCLOUD_SECONDS)
    .map((c) => ({
      provider: "mixcloud" as const,
      id: `mc-${c.key}`,
      title: c.name ?? "Untitled set",
      url: c.url ?? `https://www.mixcloud.com${c.key}`,
      embedUrl: `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(
        c.key,
      )}&hide_cover=1&light=0`,
      duration: c.audio_length ?? null,
      plays: c.play_count ?? null,
      createdAt: c.created_time ?? null,
      artwork:
        c.pictures?.["1024wx1024h"] ??
        c.pictures?.extra_large ??
        c.pictures?.large ??
        null,
    }));

  // Nothing behind the name at all — say so rather than publishing a dead
  // profile link under the artist's.
  if (!profile && sets.length === 0 && !(casts?.data?.length)) return { value: null, degraded };

  return {
    value: {
      user: username,
      url: match?.url ?? `https://www.mixcloud.com/${username}/`,
      biog: profile?.biog?.trim() || null,
      sets,
    },
    degraded,
  };
}

// ─── Internet Archive ───────────────────────────────────────────────────────

interface IaSearch {
  response?: {
    docs?: { identifier?: string; title?: string; downloads?: number; date?: string }[];
  };
}

/**
 * Fully open, no key. A surprising amount of DJ-set archival lives here (radio
 * shows, festival recordings), which is what makes "and other sources" real
 * rather than aspirational.
 *
 * Runs only when SoundCloud and Mixcloud found nothing - a fallback, as
 * `FALLBACK_LIMIT` always said, rather than a peer whose loose matching
 * contributed three other artists' uploads to Cosmo's list.
 */
async function resolveArchive(
  name: string,
  evidence: string[],
  signal?: AbortSignal,
): Promise<Resolved<ArtistSet[]>> {
  const query = `title:("${searchName(name).replace(/"/g, "")}") AND mediatype:(audio)`;
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
    `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=downloads&fl%5B%5D=date` +
    `&rows=${FALLBACK_LIMIT}&page=1&output=json`;

  const result = await fetchJson<IaSearch>(url, signal);
  const json = result.ok ? result.data : null;

  const sets = (json?.response?.docs ?? [])
    .filter(
      (d): d is { identifier: string; title: string; downloads?: number; date?: string } =>
        Boolean(d?.identifier && d.title),
    )
    // Archive titles are free text from anyone, so a bare name is not enough,
    // however long: "PENELOPE" and "Penelope Moro" are not Penelope the DJ. The
    // name has to lead the title as a credit, or sit beside something we know
    // about the artist (a party, a label, a venue from our own index).
    .filter(
      (d) =>
        leadingCredit(name, d.title) ||
        (matchName(name, d.title, "title").kind !== "none" &&
          evidence.some((term) => termIn(term, d.title))),
    )
    .map((d) => ({
      provider: "archive" as const,
      id: `ia-${d.identifier}`,
      title: d.title,
      url: `https://archive.org/details/${d.identifier}`,
      embedUrl: `https://archive.org/embed/${encodeURIComponent(d.identifier)}`,
      artwork: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      duration: null,
      plays: d.downloads ?? null,
      createdAt: d.date ?? null,
    }));
  return { value: sets, degraded: isTransient(result) };
}

/**
 * YouTube and Discogs used to sit here, and are deliberately gone.
 *
 * Both were resolvers that only ran with an API key nobody had set, so in
 * practice YouTube contributed no sets at all and Discogs contributed no
 * profile — while the Discogs *link* was always shown, pointing at a keyless
 * search URL rather than an artist. "Search releases" is a link that makes the
 * reader do the work, on a page whose whole premise is that it already did it.
 *
 * Removed rather than left dormant: dead paths behind unset environment
 * variables are the ones nobody notices have rotted. Both are written up in
 * ROADMAP.md with what they would need to be worth having, and the
 * `discogs_url` column stays in the database — dropping it would need a
 * migration run by hand, and an unused nullable column costs nothing.
 */

// ─── Resident Advisor ───────────────────────────────────────────────────────

interface RAGraphqlBody {
  data?: { artist?: Record<string, unknown> | null } | null;
  errors?: { message?: string }[];
}

type RaFetch =
  | { ok: true; body: RAGraphqlBody }
  | { ok: false; reason: "http" | "timeout" | "network"; status?: number; body?: RAGraphqlBody };

async function raGraphql(
  query: string,
  artistId: string,
  signal?: AbortSignal,
): Promise<RaFetch> {
  try {
    const res = await fetch("https://ra.co/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://ra.co/",
        Origin: "https://ra.co",
      },
      body: JSON.stringify({ query, variables: { id: artistId } }),
      signal,
    });
    if (!res.ok) {
      // GraphQL servers commonly answer a validation error with a 4xx and the
      // reason in the body; reading it is the whole point of logging.
      const body = (await res.json().catch(() => undefined)) as RAGraphqlBody | undefined;
      return { ok: false, reason: "http", status: res.status, body };
    }
    return { ok: true, body: (await res.json()) as RAGraphqlBody };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return {
      ok: false,
      reason: name === "AbortError" || name === "TimeoutError" ? "timeout" : "network",
    };
  }
}

/** One selection against `artist(id)`, and whether its failure was an outage. */
interface RaFieldResult {
  artist: Record<string, unknown> | null;
  transient: boolean;
}

/**
 * Runs `artist(id: $id) { <selection> }` as a query of its own.
 *
 * RA's schema has not been confirmed from here, and in GraphQL one unknown field
 * fails the entire query. So every field we want gets its own request: a wrong
 * guess costs that field and nothing else. Every failure is logged with the
 * field and RA's own message, which is how the right shape gets found - the old
 * single query retried silently, and "RA's biography is never returned" went
 * unnoticed in production because nothing said why.
 */
async function raArtistField(
  selection: string,
  artistId: string,
  signal?: AbortSignal,
): Promise<RaFieldResult> {
  const res = await raGraphql(
    `query GET_ARTIST($id: ID!) { artist(id: $id) { ${selection} } }`,
    artistId,
    signal,
  );
  const body = res.body;
  const message =
    body?.errors?.[0]?.message ??
    (res.ok ? undefined : `${res.reason}${res.status ? ` ${res.status}` : ""}`);
  if (message) console.warn("[ra] artist query", selection, message);

  const transient =
    !res.ok &&
    (res.reason !== "http" || res.status === 429 || (res.status !== undefined && res.status >= 500));
  if (!res.ok || body?.errors?.length) return { artist: null, transient };
  return { artist: body?.data?.artist ?? null, transient: false };
}

function trimmed(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** RA's biography may be HTML; the artist sheet renders text. */
function plainText(value: string): string {
  return value
    .replace(/<\s*(?:br|\/p|\/div|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Either schema shape: a plain string, or `{ blurb, content }`. */
function readBiography(value: unknown): string | null {
  if (typeof value === "string") return trimmed(plainText(value));
  if (value && typeof value === "object") {
    const o = value as { content?: unknown; blurb?: unknown };
    const text = trimmed(o.content) ?? trimmed(o.blurb);
    return text ? trimmed(plainText(text)) : null;
  }
  return null;
}

function readCountry(value: unknown): RaOrigin | null {
  if (!value || typeof value !== "object") return null;
  const c = value as { name?: unknown; urlCode?: unknown };
  const name = trimmed(c.name);
  // `urlCode` is the only code-shaped field we ask for, and it is not known to
  // be an ISO one. Trust it as one only when it looks like one.
  const code = trimmed(c.urlCode);
  const iso2 = code && /^[a-z]{2}$/i.test(code) ? code.toUpperCase() : null;
  return name || iso2 ? { iso2, countryName: name } : null;
}

export interface RaArtist {
  url: string | null;
  biography: string | null;
  /** Only when RA exposed a country. */
  origin?: RaOrigin;
  /** Only when RA exposed one. */
  socials?: { soundcloud?: string };
  /** True when a query failed in a way a retry might fix. */
  degraded: boolean;
}

/**
 * RA profile URL, biography, origin and social handles.
 *
 * Six small queries in parallel rather than one big one - see `raArtistField` -
 * all under the one RA deadline the caller passes. Only `contentUrl` is known to
 * exist. The rest are educated guesses at RA's schema, each optional: with every
 * guess wrong this returns exactly what the old single query did, and logs six
 * lines saying why.
 *
 * Costs about six RA requests per cold resolve instead of one or two. They run
 * only on a cache miss, and the log lines say which to drop once it is known
 * which fields exist.
 */
export async function resolveRa(artistId: string, signal?: AbortSignal): Promise<RaArtist> {
  const queries = [
    "contentUrl",
    "biography { blurb content }",
    "biography",
    "country { name urlCode }",
    "residentCountry { name urlCode }",
    "soundcloud",
  ];
  const settled = await Promise.allSettled(
    queries.map((selection) => raArtistField(selection, artistId, signal)),
  );
  const [url, bioObject, bioScalar, country, resident, soundcloud] = settled.map(
    (r, i): RaFieldResult => {
      if (r.status === "fulfilled") return r.value;
      console.warn("[ra] artist query", queries[i], String(r.reason));
      return { artist: null, transient: true };
    },
  ) as [RaFieldResult, RaFieldResult, RaFieldResult, RaFieldResult, RaFieldResult, RaFieldResult];

  const path = trimmed(url.artist?.contentUrl);
  const biography =
    readBiography(bioObject.artist?.biography) ?? readBiography(bioScalar.artist?.biography);

  // Resident country first: where someone lives now says more about which
  // account is theirs than where they were born.
  const origin = readCountry(resident.artist?.residentCountry) ?? readCountry(country.artist?.country);
  const sc = trimmed(soundcloud.artist?.soundcloud);

  return {
    url: path ? (path.startsWith("http") ? path : `https://ra.co${path}`) : null,
    biography,
    ...(origin ? { origin } : {}),
    ...(sc ? { socials: { soundcloud: sc } } : {}),
    degraded: [url, bioObject, bioScalar, country, resident, soundcloud].some((r) => r.transient),
  };
}

/** Search URLs — always available, never wrong, just less direct. */
function buildFallbackLinks(name: string) {
  const q = encodeURIComponent(name);
  // RA's "(2)" is RA's own tiebreaker; it is in nobody's SoundCloud.
  const bare = encodeURIComponent(bareName(name));
  return {
    soundcloudUrl: `https://soundcloud.com/search?q=${bare}`,
    raUrl: `https://ra.co/search?searchTerm=${q}`,
    // Bandcamp has no keyless artist search API, so this is an honest search
    // link rather than a resolved profile.
    bandcampUrl: `https://bandcamp.com/search?q=${bare}&item_type=b`,
  };
}

/**
 * Builds the link list shown under the bio.
 *
 * Resolved profiles sort ahead of search URLs — an artist's actual SoundCloud
 * is worth more than a name search — and the whole thing is capped so the page
 * stays a short read rather than a link farm.
 */
function buildLinkList(parts: {
  bandcamp: string;
  /** `handle` is the real account name; `user` is the free-text display name. */
  soundcloud: { url: string; user: string | null; handle?: string | null };
  mixcloud: { url: string | null; user: string | null };
  /**
   * Set when SoundCloud gave us nothing to play. The page is then never left
   * with an empty "Elsewhere": the profile (if any) stays, and this search
   * link sits beside it, or stands in for a profile we do not have.
   */
  soundcloudSearch?: { url: string; bare: string } | null;
}): ArtistLink[] {
  const candidates: ArtistLink[] = [
    {
      label: "Bandcamp",
      url: parts.bandcamp,
      detail: "Search releases",
      resolved: false,
    },
    {
      label: "SoundCloud",
      url: parts.soundcloud.url,
      // "@" promises a handle. A SoundCloud display name is not one - it gave
      // "@Colleen Cosmo Murphy" and "@Gianna (US)" - so only a real permalink
      // earns it, and the display name is shown as the plain label it is.
      detail: parts.soundcloud.handle
        ? `@${parts.soundcloud.handle}`
        : (parts.soundcloud.user ?? "Search"),
      resolved: Boolean(parts.soundcloud.user),
    },
    ...(parts.mixcloud.url
      ? [
          {
            label: "Mixcloud",
            url: parts.mixcloud.url,
            detail: parts.mixcloud.user ? `@${parts.mixcloud.user}` : "Search",
            resolved: Boolean(parts.mixcloud.user),
          },
        ]
      : []),
  ];

  if (parts.soundcloudSearch) {
    const search: ArtistLink = {
      label: "SoundCloud search",
      url: parts.soundcloudSearch.url,
      detail: `Search SoundCloud for ${parts.soundcloudSearch.bare}`,
      resolved: false,
    };
    const at = candidates.findIndex((c) => c.label === "SoundCloud");
    // An unresolved "SoundCloud" entry is already a search link; replace it
    // rather than showing two.
    if (at >= 0 && !candidates[at]!.resolved) candidates.splice(at, 1, search);
    else candidates.push(search);
  }

  return candidates
    .sort((a, b) => Number(b.resolved) - Number(a.resolved))
    .slice(0, MAX_LINKS);
}

// ─── What may be shown ──────────────────────────────────────────────────────

/**
 * Hosts that are never shown, whatever stored or fetched data says. YouTube was
 * removed as a source in August, but a row written before that, a link in some
 * future upstream field, or a set whose URL happens to be one must not reach
 * the screen. This is the one place that decides, and it is applied at three
 * doors: when a stored row is read, before a row is written, and before the
 * response is returned.
 */
const BANNED_HOST = /(?:^|[/.@])(?:youtube\.com|youtu\.be|youtube-nocookie\.com)(?![\w-])/i;

/** Whether a URL (or a string holding one) points at a banned host. */
export function isBannedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // A malformed escape is tested as written.
  }
  return BANNED_HOST.test(url) || BANNED_HOST.test(decoded);
}

/**
 * A bare web address in prose: a scheme or `www.` URL, an email, or a
 * hostname on a TLD that bios actually use. `Mari.te` and `St.Louis` are not
 * addresses and are not on the list.
 */
const WEB_ADDRESS =
  /(?:https?:\/\/|www\.)[^\s<>"')\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?<![\w@.-])(?:[a-z0-9-]+\.)+(?:com|net|org|io|fm|co|me|tv|be|ly|to|link|xyz|app|page|site|bio)(?:\/[^\s<>"')\]]*)?(?![\w-])/gi;

/** Words that remain after a bio's links are removed and say nothing: "Instagram:", "Follow me on". */
const BIO_FILLER = new Set([
  "instagram", "ig", "soundcloud", "mixcloud", "facebook", "twitter", "x", "bandcamp",
  "youtube", "spotify", "linktree", "link", "links", "follow", "me", "us", "on", "at",
  "web", "website", "site", "email", "mail", "contact", "booking", "bookings", "book",
  "listen", "here", "and", "or", "for", "more", "info", "find", "online",
]);

/**
 * A biography with its web addresses taken out, or null when nothing worth
 * reading is left. Addresses are stripped rather than linked: the bio is plain
 * text, and a phone browser would otherwise make any URL in it tappable. The
 * handles inside them are not lost to us, since the context is built from the
 * original text; they are simply not shown.
 */
export function cleanBioText(text: string | null | undefined): string | null {
  if (!text) return null;
  const stripped = text
    .replace(WEB_ADDRESS, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const words = stripped
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !BIO_FILLER.has(word));
  return words.length >= 2 && words.join("").length >= 12 ? stripped : null;
}

/**
 * Everything the response may carry, with the banned and the unreadable
 * removed. Idempotent, so it runs at every door without ceremony.
 */
export function scrubArtistLinks(links: ArtistLinks): ArtistLinks {
  const text = links.bio ? cleanBioText(links.bio.text) : null;
  const banned = (url: string | null): boolean => isBannedUrl(url);
  return {
    ...links,
    soundcloudUrl: banned(links.soundcloudUrl) ? null : links.soundcloudUrl,
    mixcloudUrl: banned(links.mixcloudUrl) ? null : links.mixcloudUrl,
    raUrl: banned(links.raUrl) ? null : links.raUrl,
    bio: links.bio && text ? { ...links.bio, text, url: banned(links.bio.url) ? null : links.bio.url } : null,
    sets: (Array.isArray(links.sets) ? links.sets : []).filter(
      (set) => !banned(set.url) && !banned(set.embedUrl),
    ),
    links: (Array.isArray(links.links) ? links.links : []).filter((link) => !banned(link.url)),
  };
}

// ─── Persistence ────────────────────────────────────────────────────────────

/** How long a "found nothing" row is believed before it is looked up again. */
const EMPTY_ROW_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a resolved row is believed. Identities drift: handles change, accounts are deleted. */
const AUTO_ROW_TTL_MS = 90 * 24 * 60 * 60 * 1000;

interface ArtistRow {
  ra_artist_id: string;
  name: string;
  mixcloud_user: string | null;
  mixcloud_url: string | null;
  soundcloud_user: string | null;
  soundcloud_url: string | null;
  ra_url: string | null;
  bio: ArtistBio | null;
  sets: ArtistSet[] | null;
  links: ArtistLink[] | null;
  link_source: "auto" | "manual" | "none";
  resolved_at?: string | Date | null;
}

/**
 * Whether a stored row should be looked up again rather than served.
 *
 * `resolved_at` has been written since the first migration and read by nothing
 * (migration 0006 says as much), so every row was permanent: a lookup that hit a
 * rate limit once was an empty artist page forever. Empty and `none` rows are
 * the likeliest to be an outage rather than an answer, so they expire in a day;
 * resolved rows in ninety. A human's correction (`manual`) never expires.
 */
export function isStaleRow(
  row: Pick<ArtistRow, "link_source" | "sets" | "resolved_at">,
  now: number = Date.now(),
): boolean {
  if (row.link_source === "manual") return false;
  const at = row.resolved_at ? new Date(row.resolved_at).getTime() : Number.NaN;
  if (Number.isNaN(at)) return false;
  const empty = row.link_source === "none" || !row.sets || row.sets.length === 0;
  return now - at > (empty ? EMPTY_ROW_TTL_MS : AUTO_ROW_TTL_MS);
}

async function readCached(artistId: string): Promise<ArtistLinks | null> {
  const sql = getSql();
  if (!sql) return null;

  try {
    const rows = (await sql`
      select ra_artist_id, name, mixcloud_user, mixcloud_url, soundcloud_user,
             soundcloud_url, ra_url, bio, sets, links, link_source, resolved_at
      from artist_links
      where ra_artist_id = ${artistId}
    `) as unknown as ArtistRow[];

    const row = rows[0];
    if (!row) return null;
    if (isStaleRow(row)) return null;

    // Cleaned on the way out: a row written before a source was removed, or a
    // bio with an address in it, is served as if it had been written today.
    return scrubArtistLinks({
      id: row.ra_artist_id,
      name: row.name,
      mixcloudUser: row.mixcloud_user,
      mixcloudUrl: row.mixcloud_url,
      soundcloudUser: row.soundcloud_user,
      soundcloudUrl: row.soundcloud_url,
      raUrl: row.ra_url,
      bio: row.bio,
      sets: row.sets ?? [],
      links: row.links ?? [],
      linkSource: row.link_source,
      cached: true,
    });
  } catch (error) {
    // A missing table or unreachable database degrades to live resolution.
    console.error("[artistLinks] read failed, resolving live", error);
    return null;
  }
}

async function writeCached(links: ArtistLinks): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  try {
    await sql`
      insert into artist_links (
        ra_artist_id, name, mixcloud_user, mixcloud_url, soundcloud_user,
        soundcloud_url, ra_url, bio, sets, links, link_source,
        resolved_at, updated_at
      ) values (
        ${links.id}, ${links.name}, ${links.mixcloudUser}, ${links.mixcloudUrl},
        ${links.soundcloudUser}, ${links.soundcloudUrl},
        ${links.raUrl}, ${links.bio ? JSON.stringify(links.bio) : null}::jsonb,
        ${JSON.stringify(links.sets)}::jsonb,
        ${JSON.stringify(links.links)}::jsonb, ${links.linkSource}, now(), now()
      )
      on conflict (ra_artist_id) do update set
        name            = excluded.name,
        mixcloud_user   = excluded.mixcloud_user,
        mixcloud_url    = excluded.mixcloud_url,
        soundcloud_user = excluded.soundcloud_user,
        soundcloud_url  = excluded.soundcloud_url,
        ra_url          = excluded.ra_url,
        bio             = excluded.bio,
        sets            = excluded.sets,
        links           = excluded.links,
        link_source     = excluded.link_source,
        resolved_at     = now(),
        updated_at      = now()
      -- Never clobber a human correction with an automated re-resolve.
      where artist_links.link_source <> 'manual'
    `;
  } catch (error) {
    console.error("[artistLinks] write failed, continuing", error);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Tie-break only: SoundCloud first, then Mixcloud, then the fallbacks. */
const PROVIDER_RANK: Record<SetProvider, number> = {
  soundcloud: 0,
  mixcloud: 1,
  archive: 2,
};

function releasedAt(set: ArtistSet): number | null {
  if (!set.createdAt) return null;
  const at = Date.parse(set.createdAt);
  return Number.isNaN(at) ? null : at;
}

function compareSets(a: ArtistSet, b: ArtistSet): number {
  const dateA = releasedAt(a);
  const dateB = releasedAt(b);
  if (dateA !== null && dateB !== null && dateA !== dateB) return dateB - dateA;
  if (dateA !== null && dateB === null) return -1;
  if (dateA === null && dateB !== null) return 1;
  const rank = PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider];
  if (rank !== 0) return rank;
  // Undated and same provider: most-played first, a proxy for "the good one".
  return (b.plays ?? 0) - (a.plays ?? 0);
}

/**
 * Newest first, then provider, then plays.
 *
 * Ordering used to be provider-then-plays, which put a decade-old SoundCloud
 * favourite ahead of last weekend's set. Date is what people actually mean by
 * "the newest mix", and it also sorts itself out across providers: SoundCloud
 * and Mixcloud both report a real date, while Archive items usually don't — so
 * undated sets fall to the back and the fallbacks land after the catalogue
 * without needing a rule that says so.
 *
 * Date-first alone let one prolific show crowd out every other provider
 * (fifty weekly episodes filled the whole queue), so each provider's newest
 * `PER_PROVIDER_CAP` are guaranteed a place first. Slots they leave unused go
 * to whichever provider has more, newest first: a DJ with only SoundCloud
 * still gets the full MAX_SETS rather than being cut to the cap.
 */
export function orderSets(sets: ArtistSet[]): ArtistSet[] {
  const byProvider = new Map<SetProvider, ArtistSet[]>();
  for (const set of [...sets].sort(compareSets)) {
    const list = byProvider.get(set.provider) ?? [];
    list.push(set);
    byProvider.set(set.provider, list);
  }

  const kept: ArtistSet[] = [];
  const overflow: ArtistSet[] = [];
  for (const list of byProvider.values()) {
    kept.push(...list.slice(0, PER_PROVIDER_CAP));
    overflow.push(...list.slice(PER_PROVIDER_CAP));
  }
  const room = Math.max(0, MAX_SETS - kept.length);

  return [...kept, ...overflow.sort(compareSets).slice(0, room)]
    .sort(compareSets)
    .slice(0, MAX_SETS);
}

/**
 * The artist's own dates from the lineup index, or nothing. Raced against a
 * short timer rather than a signal because the driver's query cannot be
 * cancelled; the loser is simply ignored. Never throws, never marks the result
 * degraded: an artist the index has not seen is the ordinary case.
 */
async function readAppearances(artistId: string): Promise<ArtistAppearance[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      artistAppearances({ artistId, areaId: NYC_AREA_ID }),
      new Promise<ArtistAppearance[]>((resolve) => {
        timer = setTimeout(() => resolve([]), INDEX_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `degraded` means something upstream failed in a way a retry might fix, so the
 * result was not remembered and should not be cached for long either.
 */
export async function getArtistLinks(
  artistId: string,
  name: string,
  options: { refresh?: boolean } = {},
): Promise<{ links: ArtistLinks; degraded: boolean }> {
  if (!options.refresh) {
    const cachedRow = await readCached(artistId);
    if (cachedRow) return { links: cachedRow, degraded: false };
  }

  /**
   * Each stage gets its own deadline rather than sharing one.
   *
   * A single controller started at entry was fine while every source ran in
   * parallel. It stopped being fine the moment RA became a *prerequisite*: a
   * slow-but-successful RA lookup would hand SoundCloud and Mixcloud an
   * already-aborted signal, their fetches would reject instantly, and the two
   * sources a DJ actually posts to would return nothing — with a *successful*
   * RA call as the cause.
   *
   * RA is held to a shorter budget because it is blocking, and the catalogue
   * stage starts a fresh one. RA's several queries run in parallel under the one
   * RA deadline, not one after another. The Archive, now a fallback that runs
   * after the catalogue stage, gets its own short one. Worst case is
   * 3s + 7s + 4s, inside the 15s `maxDuration` in vercel.json.
   */
  const timers: ReturnType<typeof setTimeout>[] = [];
  const deadline = (ms: number): AbortSignal => {
    const controller = new AbortController();
    timers.push(setTimeout(() => controller.abort(), ms));
    return controller.signal;
  };

  try {
    // Logs instead of swallowing, because a source that fails silently is
    // precisely how the search-window bug hid for three rounds. A throw here is
    // an outage as far as caching is concerned.
    const settle = <T>(work: Promise<Resolved<T>>, label: string): Promise<Resolved<T>> =>
      work.catch((error) => {
        console.error(`[artistLinks] ${label} failed`, error);
        return { value: null, degraded: true };
      });

    // The lineup history is read beside RA, inside RA's own window, and held
    // to a shorter one: it is a nicety and never an outage. With no history,
    // or a slow database, the resolve simply has fewer terms to search with.
    const [ra, appearances] = await Promise.all([
      resolveRa(artistId, deadline(RA_TIMEOUT_MS)),
      readAppearances(artistId),
    ]);
    // A bio-less or failed RA lookup still yields the parenthetical off the
    // name, and with every optional RA field missing matching behaves as it did
    // before any of them were asked for.
    const base = buildArtistContext(name, ra.biography, {
      origin: ra.origin,
      soundcloud: ra.socials?.soundcloud,
    });
    // The biography's named things first, then the venues and parties our own
    // index has seen this artist play.
    const evidence = [
      ...new Map(
        [...(base.evidence ?? []), ...indexEvidence(name, appearances)].map((term) => [
          fold(term),
          term,
        ]),
      ).values(),
    ].slice(0, 10);
    const context = { ...base, evidence };

    const catalogueSignal = deadline(UPSTREAM_TIMEOUT_MS);
    const [soundcloudResult, mixcloudResult] = await Promise.all([
      settle(resolveSoundcloud(name, context, catalogueSignal), "soundcloud"),
      settle(resolveMixcloud(name, context, catalogueSignal), "mixcloud"),
    ]);
    const soundcloud = soundcloudResult.value;
    const mixcloud = mixcloudResult.value;

    // The Archive is the fallback for artists the first two don't cover, so it
    // only runs when they found no sets at all.
    let archiveResult: Resolved<ArtistSet[]> = { value: [], degraded: false };
    if ((soundcloud?.sets.length ?? 0) + (mixcloud?.sets.length ?? 0) === 0) {
      archiveResult = await settle(
        resolveArchive(name, evidence, deadline(ARCHIVE_TIMEOUT_MS)),
        "archive",
      ).then((r) => ({ value: r.value ?? [], degraded: r.degraded }));
    }

    const degraded =
      ra.degraded || soundcloudResult.degraded || mixcloudResult.degraded || archiveResult.degraded;

    const fallback = buildFallbackLinks(name);

    const sets = orderSets([
      ...(soundcloud?.sets ?? []),
      ...(mixcloud?.sets ?? []),
      ...(archiveResult.value ?? []),
    ]);

    // Bio priority: RA is the scene-native source, then the artist's own
    // Mixcloud blurb, then their SoundCloud description. Web addresses come out
    // of all three, and a bio that was only an address is no bio: the next
    // source gets its turn. A SoundCloud description is used only for an
    // account we believe is the artist's; the context above was built from the
    // original text, so the handles in it have already been used as evidence.
    const raBio = cleanBioText(ra.biography);
    const mixcloudBio = cleanBioText(mixcloud?.biog);
    const soundcloudBio = soundcloud?.confirmed ? cleanBioText(soundcloud.description) : null;
    const bio: ArtistBio | null = raBio
      ? { text: raBio, source: "Resident Advisor", url: ra.url }
      : mixcloudBio
        ? { text: mixcloudBio, source: "Mixcloud", url: mixcloud?.url ?? null }
        : soundcloudBio
          ? { text: soundcloudBio, source: "SoundCloud", url: soundcloud?.url ?? null }
          : null;

    const linkList = buildLinkList({
      bandcamp: fallback.bandcampUrl,
      soundcloud: {
        url: soundcloud?.url ?? fallback.soundcloudUrl,
        user: soundcloud?.user ?? null,
        handle: soundcloud?.handle ?? null,
      },
      mixcloud: { url: mixcloud?.url ?? null, user: mixcloud?.user ?? null },
      // Never a blank "Elsewhere": with nothing to play from SoundCloud, offer
      // the search the listener would otherwise have to type.
      soundcloudSearch: sets.some((set) => set.provider === "soundcloud")
        ? null
        : { url: fallback.soundcloudUrl, bare: bareName(name) },
    });

    const links: ArtistLinks = {
      id: artistId,
      name,
      mixcloudUser: mixcloud?.user ?? null,
      mixcloudUrl: mixcloud?.url ?? null,
      soundcloudUser: soundcloud?.user ?? null,
      soundcloudUrl: soundcloud?.url ?? fallback.soundcloudUrl,
      raUrl: ra.url ?? fallback.raUrl,
      bio,
      sets,
      links: linkList,
      linkSource: sets.length > 0 || bio ? "auto" : "none",
      cached: false,
    };

    // Scrubbed before it is written as well as before it is returned: nothing
    // banned is ever stored, so no later read has to remember to remove it.
    const clean = scrubArtistLinks(links);

    // A degraded result is an answer with holes in it. Remembering it would
    // make the holes permanent: one 429 from SoundCloud used to leave an artist
    // with no sets until someone deleted the row by hand.
    if (!degraded) await writeCached(clean);
    return { links: clean, degraded };
  } finally {
    timers.forEach(clearTimeout);
  }
}
