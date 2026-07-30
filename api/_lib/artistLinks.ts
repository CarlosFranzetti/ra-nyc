import { getSql } from "./db.js";

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
 * | SoundCloud | api-v2 via client id | widget, keyless | **yes** — `SOUNDCLOUD_CLIENT_ID` |
 * | Mixcloud | public API | widget | no |
 * | Internet Archive | advancedsearch | `/embed/` | no |
 * | YouTube | Data API v3 | `/embed/` | optional — `YOUTUBE_API_KEY` |
 *
 * SoundCloud is first because it has the most DJ sets, but its API registration
 * has been closed to new apps for years. Rather than scrape a `client_id` out of
 * their web bundle — which works around an access control on purpose and breaks
 * constantly — SoundCloud search is enabled only when a key is supplied. Without
 * one it degrades to a search link, and Mixcloud + Archive still fill the list.
 *
 * Embedding a *known* SoundCloud URL needs no key, so once a track is resolved
 * playback works the same either way.
 */

export type SetProvider = "soundcloud" | "mixcloud" | "archive" | "youtube";

/** How many sets we show per artist. */
export const MAX_SETS = 4;

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
}

export interface ArtistBio {
  text: string;
  /** Where the prose came from, so the UI can attribute it. */
  source: "Resident Advisor" | "SoundCloud" | "Mixcloud" | "Discogs";
  url: string | null;
}

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
  linkSource: "auto" | "manual" | "none";
  cached: boolean;
}

const UPSTREAM_TIMEOUT_MS = 7_000;
/** Fetch a few extra per provider so the cap can prefer better sources. */
const PER_PROVIDER = 4;

// ─── Name matching ──────────────────────────────────────────────────────────

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

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ra-nyc/1.0 (+https://ra-nyc.vercel.app)",
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
}
interface ScTrack {
  id?: number;
  title?: string;
  permalink_url?: string;
  duration?: number;
  playback_count?: number;
  created_at?: string;
  user?: ScUser;
}

function soundcloudEmbed(trackUrl: string): string {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(
    trackUrl,
  )}&color=%23ffffff&auto_play=false&hide_related=true&show_comments=false&show_user=true&visual=false`;
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
  const clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  if (!clientId) return null;

  const base = "https://api-v2.soundcloud.com";
  const q = encodeURIComponent(name);

  const users = await fetchJson<{ collection?: ScUser[] }>(
    `${base}/search/users?q=${q}&limit=5&client_id=${encodeURIComponent(clientId)}`,
    signal,
  );
  const user = users?.collection?.find(
    (u) => u.username && isPlausibleMatch(name, u.username),
  );

  // Prefer the matched user's own tracks; fall back to a scoped track search so
  // a DJ without a profile match can still surface a set.
  const trackUrl = user?.id
    ? `${base}/users/${user.id}/tracks?limit=${PER_PROVIDER}&client_id=${encodeURIComponent(clientId)}`
    : `${base}/search/tracks?q=${q}&limit=${PER_PROVIDER}&client_id=${encodeURIComponent(clientId)}`;

  const raw = await fetchJson<ScTrack[] | { collection?: ScTrack[] }>(trackUrl, signal);
  const tracks = Array.isArray(raw) ? raw : (raw?.collection ?? []);

  const sets: ArtistSet[] = tracks
    .filter((t): t is ScTrack & { permalink_url: string } => Boolean(t.permalink_url))
    .filter(
      (t) =>
        // Trust the user's own uploads; be strict about search hits.
        Boolean(user?.id) ||
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
      `https://api.mixcloud.com/${encodeURIComponent(username)}/cloudcasts/?limit=${PER_PROVIDER}`,
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
    `&rows=${PER_PROVIDER}&page=1&output=json`;

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
      duration: null,
      plays: d.downloads ?? null,
      createdAt: d.date ?? null,
    }));
}

// ─── YouTube (optional) ─────────────────────────────────────────────────────

interface YtSearch {
  items?: {
    id?: { videoId?: string };
    snippet?: { title?: string; publishedAt?: string; channelTitle?: string };
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
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=long&maxResults=${PER_PROVIDER}&q=${q}&key=${encodeURIComponent(key)}`,
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
  };
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
  link_source: "auto" | "manual" | "none";
}

async function readCached(artistId: string): Promise<ArtistLinks | null> {
  const sql = getSql();
  if (!sql) return null;

  try {
    const rows = (await sql`
      select ra_artist_id, name, mixcloud_user, mixcloud_url, soundcloud_user,
             soundcloud_url, discogs_url, ra_url, bio, sets, link_source
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
        soundcloud_url, discogs_url, ra_url, bio, sets, link_source,
        resolved_at, updated_at
      ) values (
        ${links.id}, ${links.name}, ${links.mixcloudUser}, ${links.mixcloudUrl},
        ${links.soundcloudUser}, ${links.soundcloudUrl}, ${links.discogsUrl},
        ${links.raUrl}, ${links.bio ? JSON.stringify(links.bio) : null}::jsonb,
        ${JSON.stringify(links.sets)}::jsonb, ${links.linkSource}, now(), now()
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

/** SoundCloud first, then Mixcloud, then the rest — capped at MAX_SETS. */
const PROVIDER_RANK: Record<SetProvider, number> = {
  soundcloud: 0,
  mixcloud: 1,
  archive: 2,
  youtube: 3,
};

export function orderSets(sets: ArtistSet[]): ArtistSet[] {
  return [...sets]
    .sort((a, b) => {
      const rank = PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider];
      if (rank !== 0) return rank;
      // Within a provider, most-played first — a proxy for "the good one".
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
      linkSource: sets.length > 0 || bio ? "auto" : "none",
      cached: false,
    };

    await writeCached(links);
    return links;
  } finally {
    clearTimeout(timeout);
  }
}
