import { getSql } from "./db.js";
import { normalizeName } from "./normalize.js";

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
 * | YouTube | Data API v3 | `/embed/` | optional — `YOUTUBE_API_KEY` |
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

export type SetProvider = "soundcloud" | "mixcloud" | "archive" | "youtube";

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
  source: "Resident Advisor" | "SoundCloud" | "Mixcloud" | "Discogs";
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
export const MAX_LINKS = 5;

export interface ArtistLinks {
  id: string;
  name: string;
  mixcloudUser: string | null;
  mixcloudUrl: string | null;
  soundcloudUser: string | null;
  soundcloudUrl: string | null;
  discogsUrl: string | null;
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
 * SoundCloud and Mixcloud are where a DJ actually posts, so we pull their
 * catalogue rather than a sample — that is what makes `next` keep working.
 */
const CATALOGUE_LIMIT = 50;

/**
 * Archive and YouTube are fallbacks for artists the first two don't cover, and
 * their matching is the loosest of the four. Pulling fifty guesses would bury a
 * real catalogue under near-misses, so they stay small.
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
 * Archive and YouTube fallbacks are already filtered hard on title.
 */
const MIN_SOUNDCLOUD_SECONDS = 45 * 60;

// ─── Name matching ──────────────────────────────────────────────────────────

/**
 * Whether a candidate account plausibly *is* this artist.
 *
 * Deliberately strict. A confidently wrong result — someone else's sets under a
 * DJ's name — is worse than an empty list, so anything short of a normalised
 * exact match or a clean prefix on a long-enough name is rejected.
 */
export function isPlausibleMatch(artistName: string, candidate: string): boolean {
  const a = normalizeName(artistName);
  const b = normalizeName(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && (b.startsWith(a) || a.startsWith(b))) return true;
  return false;
}

/** For free-text titles: does the artist's name appear in it at all? */
function titleMentions(artistName: string, title: string): boolean {
  const a = normalizeName(artistName);
  return a.length >= 4 && normalizeName(title).includes(a);
}

async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ra-nyc/1.0 (+https://ra-nyc.vercel.app)",
        ...headers,
      },
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // A failed side-source must never fail the whole lookup.
    return null;
  }
}

// ─── SoundCloud ─────────────────────────────────────────────────────────────

interface ScUser {
  id?: number;
  username?: string;
  permalink_url?: string;
  description?: string | null;
  avatar_url?: string | null;
}
interface ScTrack {
  id?: number;
  title?: string;
  permalink_url?: string;
  duration?: number;
  playback_count?: number;
  created_at?: string;
  artwork_url?: string | null;
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

async function resolveSoundcloud(
  name: string,
  signal?: AbortSignal,
): Promise<{
  user: string | null;
  url: string | null;
  description: string | null;
  sets: ArtistSet[];
} | null> {
  const mode = soundcloudMode();
  if (mode === "off") return null;

  const clientId = process.env.SOUNDCLOUD_CLIENT_ID as string;
  const q = encodeURIComponent(name);

  // The two APIs differ in host, auth and search paths, but return close enough
  // shapes that everything below this block is shared.
  let auth: Record<string, string> | undefined;
  let userSearch: string;
  let trackSearch: (userId: number | undefined) => string;

  if (mode === "official") {
    const token = await soundcloudAccessToken(signal);
    // A configured-but-broken secret must not silently fall through to api-v2:
    // that would 401 too, just less obviously.
    if (!token) return null;
    const base = "https://api.soundcloud.com";
    auth = { Authorization: `OAuth ${token}` };
    userSearch = `${base}/users?q=${q}&limit=5`;
    trackSearch = (userId) =>
      userId
        ? `${base}/users/${userId}/tracks?limit=${CATALOGUE_LIMIT}`
        : `${base}/tracks?q=${q}&limit=${CATALOGUE_LIMIT}`;
  } else {
    const base = "https://api-v2.soundcloud.com";
    const credential = `&client_id=${encodeURIComponent(clientId)}`;
    userSearch = `${base}/search/users?q=${q}&limit=5${credential}`;
    trackSearch = (userId) =>
      userId
        ? `${base}/users/${userId}/tracks?limit=${CATALOGUE_LIMIT}${credential}`
        : `${base}/search/tracks?q=${q}&limit=${CATALOGUE_LIMIT}${credential}`;
  }

  // The official API returns bare arrays; api-v2 wraps them in `collection`.
  const rawUsers = await fetchJson<ScUser[] | { collection?: ScUser[] }>(
    userSearch,
    signal,
    auth,
  );
  const candidates = Array.isArray(rawUsers) ? rawUsers : (rawUsers?.collection ?? []);
  const user = candidates.find(
    (u) => u.username && isPlausibleMatch(name, u.username),
  );

  const readTracks = async (userId: number | undefined): Promise<ScTrack[]> => {
    const raw = await fetchJson<ScTrack[] | { collection?: ScTrack[] }>(
      trackSearch(userId),
      signal,
      auth,
    );
    return Array.isArray(raw) ? raw : (raw?.collection ?? []);
  };

  // Prefer the matched user's own uploads.
  let ownUploads = Boolean(user?.id);
  let tracks = await readTracks(user?.id);

  // A matched profile with no uploads is common and used to end the search
  // here, which is how a DJ with an obvious SoundCloud page ended up showing
  // none of their sets: plenty of them post through labels, radio shows or
  // playlists rather than uploading to their own account. Falling back to the
  // scoped search picks those up. It re-enters strict filtering, since these
  // are search hits rather than the artist's own uploads.
  if (ownUploads && tracks.length === 0) {
    ownUploads = false;
    tracks = await readTracks(undefined);
  }

  const sets: ArtistSet[] = tracks
    .filter((t): t is ScTrack & { permalink_url: string } => Boolean(t.permalink_url))
    // Length first: it is the cheapest filter and removes most of the list.
    // A missing duration is treated as too short rather than kept — an unknown
    // length is far more often a single than an unlabelled two-hour set.
    .filter((t) => (t.duration ?? 0) >= MIN_SOUNDCLOUD_SECONDS * 1000)
    .filter(
      (t) =>
        // Trust the user's own uploads; be strict about search hits.
        ownUploads ||
        titleMentions(name, t.title ?? "") ||
        isPlausibleMatch(name, t.user?.username ?? ""),
    )
    .map((t) => ({
      provider: "soundcloud" as const,
      id: `sc-${t.id ?? t.permalink_url}`,
      title: t.title ?? "Untitled",
      url: t.permalink_url,
      embedUrl: soundcloudEmbed(t.permalink_url),
      duration: t.duration ? Math.round(t.duration / 1000) : null,
      plays: t.playback_count ?? null,
      createdAt: t.created_at ?? null,
      artwork: soundcloudArtwork(t),
    }));

  if (!user && sets.length === 0) return null;

  return {
    user: user?.username ?? null,
    url: user?.permalink_url ?? null,
    description: user?.description?.trim() || null,
    sets,
  };
}

// ─── Mixcloud ───────────────────────────────────────────────────────────────

interface McUserSearch {
  data?: { username?: string; name?: string; url?: string }[];
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

async function resolveMixcloud(
  name: string,
  signal?: AbortSignal,
): Promise<{
  user: string;
  url: string;
  biog: string | null;
  sets: ArtistSet[];
} | null> {
  const search = await fetchJson<McUserSearch>(
    `https://api.mixcloud.com/search/?q=${encodeURIComponent(name)}&type=user&limit=5`,
    signal,
  );

  const match = search?.data?.find(
    (u) =>
      (u.username && isPlausibleMatch(name, u.username)) ||
      (u.name && isPlausibleMatch(name, u.name)),
  );
  if (!match?.username) return null;

  const username = match.username;
  const [profile, casts] = await Promise.all([
    fetchJson<McUser>(`https://api.mixcloud.com/${encodeURIComponent(username)}/`, signal),
    fetchJson<McCloudcasts>(
      `https://api.mixcloud.com/${encodeURIComponent(username)}/cloudcasts/?limit=${CATALOGUE_LIMIT}`,
      signal,
    ),
  ]);

  const sets: ArtistSet[] = (casts?.data ?? [])
    .filter((c): c is NonNullable<typeof c> & { key: string } => Boolean(c.key))
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

  return {
    user: username,
    url: match.url ?? `https://www.mixcloud.com/${username}/`,
    biog: profile?.biog?.trim() || null,
    sets,
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
 */
async function resolveArchive(
  name: string,
  signal?: AbortSignal,
): Promise<ArtistSet[]> {
  const query = `title:("${name.replace(/"/g, "")}") AND mediatype:(audio)`;
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}` +
    `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=downloads&fl%5B%5D=date` +
    `&rows=${FALLBACK_LIMIT}&page=1&output=json`;

  const json = await fetchJson<IaSearch>(url, signal);

  return (json?.response?.docs ?? [])
    .filter(
      (d): d is { identifier: string; title: string; downloads?: number; date?: string } =>
        Boolean(d.identifier && d.title),
    )
    // Archive titles are free text, so require the name to actually appear.
    .filter((d) => titleMentions(name, d.title))
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
}

// ─── YouTube (optional) ─────────────────────────────────────────────────────

interface YtSearch {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      publishedAt?: string;
      channelTitle?: string;
      thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
    };
  }[];
}

async function resolveYouTube(
  name: string,
  signal?: AbortSignal,
): Promise<ArtistSet[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];

  const q = encodeURIComponent(`${name} dj set`);
  const json = await fetchJson<YtSearch>(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=long&maxResults=${FALLBACK_LIMIT}&q=${q}&key=${encodeURIComponent(key)}`,
    signal,
  );

  return (json?.items ?? [])
    .filter((i) => i.id?.videoId && i.snippet?.title)
    .filter((i) => titleMentions(name, i.snippet!.title!))
    .map((i) => ({
      provider: "youtube" as const,
      id: `yt-${i.id!.videoId!}`,
      title: i.snippet!.title!,
      url: `https://www.youtube.com/watch?v=${i.id!.videoId!}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${i.id!.videoId!}`,
      artwork:
        i.snippet?.thumbnails?.high?.url ??
        i.snippet?.thumbnails?.medium?.url ??
        null,
      duration: null,
      plays: null,
      createdAt: i.snippet?.publishedAt ?? null,
    }));
}

// ─── Discogs ────────────────────────────────────────────────────────────────

interface DiscogsSearch {
  results?: { id?: number; uri?: string; title?: string; resource_url?: string }[];
}
interface DiscogsArtist {
  profile?: string | null;
  uri?: string;
}

async function resolveDiscogs(
  name: string,
  signal?: AbortSignal,
): Promise<{ url: string; profile: string | null } | null> {
  const token = process.env.DISCOGS_TOKEN;
  // Discogs' search endpoint requires auth, so without a token the honest
  // offering is a search URL — see buildFallbackLinks.
  if (!token) return null;

  const json = await fetchJson<DiscogsSearch>(
    `https://api.discogs.com/database/search?type=artist&per_page=5&q=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`,
    signal,
  );

  const hit = json?.results?.find((r) => r.title && isPlausibleMatch(name, r.title));
  if (!hit) return null;

  const url = hit.uri?.startsWith("http")
    ? hit.uri
    : `https://www.discogs.com${hit.uri ?? ""}`;

  let profile: string | null = null;
  if (hit.resource_url) {
    const detail = await fetchJson<DiscogsArtist>(
      `${hit.resource_url}?token=${encodeURIComponent(token)}`,
      signal,
    );
    // Discogs profiles are full of [a=Artist] and [l=Label] markup.
    profile =
      detail?.profile?.replace(/\[\/?[abl](?:=[^\]]*)?\]/gi, "").trim() || null;
  }

  return { url, profile };
}

// ─── Resident Advisor ───────────────────────────────────────────────────────

interface RAArtistQuery {
  data?: { artist?: { contentUrl?: string; biography?: string | null } | null };
  errors?: unknown[];
}

async function raGraphql(
  query: string,
  artistId: string,
  signal?: AbortSignal,
): Promise<RAArtistQuery | null> {
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
    if (!res.ok) return null;
    return (await res.json()) as RAArtistQuery;
  } catch {
    return null;
  }
}

/**
 * RA profile URL and biography.
 *
 * `biography` is an educated guess at their schema, so this asks for it first
 * and retries without it on a GraphQL error — one unknown field fails an entire
 * query. Kept well away from the listings query, which is the app's actual job.
 */
async function resolveRa(
  artistId: string,
  signal?: AbortSignal,
): Promise<{ url: string | null; biography: string | null }> {
  const withBio = await raGraphql(
    `query GET_ARTIST($id: ID!) { artist(id: $id) { contentUrl biography } }`,
    artistId,
    signal,
  );

  const usable =
    withBio && !withBio.errors?.length
      ? withBio
      : await raGraphql(
          `query GET_ARTIST($id: ID!) { artist(id: $id) { contentUrl } }`,
          artistId,
          signal,
        );

  const artist = usable?.data?.artist;
  if (!artist) return { url: null, biography: null };

  const path = artist.contentUrl;
  return {
    url: path ? (path.startsWith("http") ? path : `https://ra.co${path}`) : null,
    biography: artist.biography?.trim() || null,
  };
}

/** Search URLs — always available, never wrong, just less direct. */
function buildFallbackLinks(name: string) {
  const q = encodeURIComponent(name);
  return {
    soundcloudUrl: `https://soundcloud.com/search?q=${q}`,
    discogsUrl: `https://www.discogs.com/search/?type=artist&q=${q}`,
    raUrl: `https://ra.co/search?searchTerm=${q}`,
    // Bandcamp has no keyless artist search API, so this is an honest search
    // link rather than a resolved profile.
    bandcampUrl: `https://bandcamp.com/search?q=${q}&item_type=b`,
  };
}

/**
 * Builds the link list shown under the bio.
 *
 * Resolved profiles sort ahead of search URLs — a real Discogs page is worth
 * more than a name search — and the whole thing is capped so the page stays a
 * short read rather than a link farm.
 */
function buildLinkList(parts: {
  discogs: { url: string; resolved: boolean };
  bandcamp: string;
  soundcloud: { url: string; user: string | null };
  mixcloud: { url: string | null; user: string | null };
}): ArtistLink[] {
  const candidates: ArtistLink[] = [
    {
      label: "Discogs",
      url: parts.discogs.url,
      detail: parts.discogs.resolved ? "Discography" : "Search releases",
      resolved: parts.discogs.resolved,
    },
    {
      label: "Bandcamp",
      url: parts.bandcamp,
      detail: "Search releases",
      resolved: false,
    },
    {
      label: "SoundCloud",
      url: parts.soundcloud.url,
      detail: parts.soundcloud.user ? `@${parts.soundcloud.user}` : "Search",
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

  return candidates
    .sort((a, b) => Number(b.resolved) - Number(a.resolved))
    .slice(0, MAX_LINKS);
}

// ─── Persistence ────────────────────────────────────────────────────────────

interface ArtistRow {
  ra_artist_id: string;
  name: string;
  mixcloud_user: string | null;
  mixcloud_url: string | null;
  soundcloud_user: string | null;
  soundcloud_url: string | null;
  discogs_url: string | null;
  ra_url: string | null;
  bio: ArtistBio | null;
  sets: ArtistSet[] | null;
  links: ArtistLink[] | null;
  link_source: "auto" | "manual" | "none";
}

async function readCached(artistId: string): Promise<ArtistLinks | null> {
  const sql = getSql();
  if (!sql) return null;

  try {
    const rows = (await sql`
      select ra_artist_id, name, mixcloud_user, mixcloud_url, soundcloud_user,
             soundcloud_url, discogs_url, ra_url, bio, sets, links, link_source
      from artist_links
      where ra_artist_id = ${artistId}
    `) as unknown as ArtistRow[];

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.ra_artist_id,
      name: row.name,
      mixcloudUser: row.mixcloud_user,
      mixcloudUrl: row.mixcloud_url,
      soundcloudUser: row.soundcloud_user,
      soundcloudUrl: row.soundcloud_url,
      discogsUrl: row.discogs_url,
      raUrl: row.ra_url,
      bio: row.bio,
      sets: row.sets ?? [],
      links: row.links ?? [],
      linkSource: row.link_source,
      cached: true,
    };
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
        soundcloud_url, discogs_url, ra_url, bio, sets, links, link_source,
        resolved_at, updated_at
      ) values (
        ${links.id}, ${links.name}, ${links.mixcloudUser}, ${links.mixcloudUrl},
        ${links.soundcloudUser}, ${links.soundcloudUrl}, ${links.discogsUrl},
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
        discogs_url     = excluded.discogs_url,
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
  youtube: 3,
};

function releasedAt(set: ArtistSet): number | null {
  if (!set.createdAt) return null;
  const at = Date.parse(set.createdAt);
  return Number.isNaN(at) ? null : at;
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
 */
export function orderSets(sets: ArtistSet[]): ArtistSet[] {
  return [...sets]
    .sort((a, b) => {
      const dateA = releasedAt(a);
      const dateB = releasedAt(b);
      if (dateA !== null && dateB !== null && dateA !== dateB) return dateB - dateA;
      if (dateA !== null && dateB === null) return -1;
      if (dateA === null && dateB !== null) return 1;
      const rank = PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider];
      if (rank !== 0) return rank;
      // Undated and same provider: most-played first, a proxy for "the good one".
      return (b.plays ?? 0) - (a.plays ?? 0);
    })
    .slice(0, MAX_SETS);
}

export async function getArtistLinks(
  artistId: string,
  name: string,
  options: { refresh?: boolean } = {},
): Promise<ArtistLinks> {
  if (!options.refresh) {
    const cachedRow = await readCached(artistId);
    if (cachedRow) return cachedRow;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    // All independent — run together so the slowest doesn't stack on the rest.
    const [soundcloud, mixcloud, archive, youtube, discogs, ra] = await Promise.all([
      resolveSoundcloud(name, controller.signal),
      resolveMixcloud(name, controller.signal),
      resolveArchive(name, controller.signal),
      resolveYouTube(name, controller.signal),
      resolveDiscogs(name, controller.signal),
      resolveRa(artistId, controller.signal),
    ]);

    const fallback = buildFallbackLinks(name);

    const sets = orderSets([
      ...(soundcloud?.sets ?? []),
      ...(mixcloud?.sets ?? []),
      ...archive,
      ...youtube,
    ]);

    // Bio priority: RA is the scene-native source, then the artist's own
    // Mixcloud blurb, then Discogs prose.
    const bio: ArtistBio | null = ra.biography
      ? { text: ra.biography, source: "Resident Advisor", url: ra.url }
      : mixcloud?.biog
        ? { text: mixcloud.biog, source: "Mixcloud", url: mixcloud.url }
        : soundcloud?.description
          ? { text: soundcloud.description, source: "SoundCloud", url: soundcloud.url }
          : discogs?.profile
            ? { text: discogs.profile, source: "Discogs", url: discogs.url }
            : null;

    const linkList = buildLinkList({
      discogs: {
        url: discogs?.url ?? fallback.discogsUrl,
        resolved: Boolean(discogs?.url),
      },
      bandcamp: fallback.bandcampUrl,
      soundcloud: {
        url: soundcloud?.url ?? fallback.soundcloudUrl,
        user: soundcloud?.user ?? null,
      },
      mixcloud: { url: mixcloud?.url ?? null, user: mixcloud?.user ?? null },
    });

    const links: ArtistLinks = {
      id: artistId,
      name,
      mixcloudUser: mixcloud?.user ?? null,
      mixcloudUrl: mixcloud?.url ?? null,
      soundcloudUser: soundcloud?.user ?? null,
      soundcloudUrl: soundcloud?.url ?? fallback.soundcloudUrl,
      discogsUrl: discogs?.url ?? fallback.discogsUrl,
      raUrl: ra.url ?? fallback.raUrl,
      bio,
      sets,
      links: linkList,
      linkSource: sets.length > 0 || bio ? "auto" : "none",
      cached: false,
    };

    await writeCached(links);
    return links;
  } finally {
    clearTimeout(timeout);
  }
}
