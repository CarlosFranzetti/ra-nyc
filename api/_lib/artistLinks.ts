import { getSql } from "./db.js";

/**
 * Resolves a DJ name to playable sets and profile links.
 *
 * The hard part is that RA gives us a name and an id, and nothing else — no
 * social links. So every link here is either *searched for* (and therefore
 * sometimes wrong) or a search URL we hand off to the user.
 *
 * Sources, and why:
 * - **Mixcloud** — public API, no key, and long DJ sets are its native content.
 *   The only source we can both search *and* embed, so it's the player.
 * - **SoundCloud** — better content, but API registration has been closed for
 *   years. No search possible; we emit a pre-filled search link instead.
 * - **Discogs** — exact page if `DISCOGS_TOKEN` is set (their search endpoint
 *   requires auth), otherwise a search link.
 * - **RA** — tries the GraphQL artist record for a real profile URL, falls back
 *   to RA search.
 *
 * Results are persisted when a database is configured, so each artist costs one
 * round of third-party calls ever rather than one per visitor.
 */

export interface ArtistSet {
  /** Mixcloud key, e.g. "/username/some-set/" — also the embed feed id. */
  key: string;
  title: string;
  url: string;
  /** Seconds. */
  duration: number | null;
  plays: number | null;
  createdAt: string | null;
}

export interface ArtistLinks {
  id: string;
  name: string;
  mixcloudUser: string | null;
  mixcloudUrl: string | null;
  soundcloudUrl: string | null;
  discogsUrl: string | null;
  raUrl: string | null;
  sets: ArtistSet[];
  /** 'auto' | 'manual' | 'none' — 'manual' is never overwritten. */
  linkSource: "auto" | "manual" | "none";
  /** True when this came from the database rather than a live resolve. */
  cached: boolean;
}

const UPSTREAM_TIMEOUT_MS = 6_000;
const MAX_SETS = 8;

/** Strips accents, punctuation and case so "Bjørn" ≈ "bjorn". */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    // RA suffixes disambiguators like "Cosmo (NY)" and "SRI (1)".
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Whether a Mixcloud account plausibly *is* this artist.
 *
 * Deliberately strict. A confidently wrong link — playing someone else's sets
 * under a DJ's name — is worse than showing no player at all, so anything short
 * of a normalised exact match or a clean prefix is rejected.
 */
export function isPlausibleMatch(artistName: string, candidate: string): boolean {
  const a = normalizeName(artistName);
  const b = normalizeName(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  // Allow "djpython" vs "python" style padding, but only for names long enough
  // that a prefix isn't coincidence.
  if (a.length >= 5 && (b.startsWith(a) || a.startsWith(b))) return true;
  return false;
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

interface MixcloudUserSearch {
  data?: { username?: string; name?: string; url?: string }[];
}

interface MixcloudCloudcasts {
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
): Promise<{ user: string; url: string; sets: ArtistSet[] } | null> {
  const search = await fetchJson<MixcloudUserSearch>(
    `https://api.mixcloud.com/search/?q=${encodeURIComponent(name)}&type=user&limit=5`,
    signal,
  );

  const match = search?.data?.find(
    (u) =>
      (u.username && isPlausibleMatch(name, u.username)) ||
      (u.name && isPlausibleMatch(name, u.name)),
  );
  if (!match?.username) return null;

  const casts = await fetchJson<MixcloudCloudcasts>(
    `https://api.mixcloud.com/${encodeURIComponent(match.username)}/cloudcasts/?limit=${MAX_SETS}`,
    signal,
  );

  const sets: ArtistSet[] = (casts?.data ?? [])
    .filter((c): c is NonNullable<typeof c> & { key: string } => Boolean(c.key))
    .map((c) => ({
      key: c.key,
      title: c.name ?? "Untitled set",
      url: c.url ?? `https://www.mixcloud.com${c.key}`,
      duration: c.audio_length ?? null,
      plays: c.play_count ?? null,
      createdAt: c.created_time ?? null,
    }));

  return {
    user: match.username,
    url: match.url ?? `https://www.mixcloud.com/${match.username}/`,
    sets,
  };
}

interface DiscogsSearch {
  results?: { uri?: string; title?: string }[];
}

async function resolveDiscogs(
  name: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const token = process.env.DISCOGS_TOKEN;
  // Discogs' search endpoint requires auth, so without a token the best we can
  // honestly offer is a search URL — see buildFallbackLinks.
  if (!token) return null;

  const json = await fetchJson<DiscogsSearch>(
    `https://api.discogs.com/database/search?type=artist&per_page=5&q=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`,
    signal,
  );

  const hit = json?.results?.find((r) => r.title && isPlausibleMatch(name, r.title));
  if (!hit?.uri) return null;
  return hit.uri.startsWith("http") ? hit.uri : `https://www.discogs.com${hit.uri}`;
}

interface RAArtistQuery {
  data?: { artist?: { id?: string; name?: string; contentUrl?: string } | null };
  errors?: unknown[];
}

/**
 * RA's own profile URL, if the schema cooperates.
 *
 * Wrapped so a schema change can only cost us this one link — it must never
 * affect the listings query, which is the app's actual job.
 */
async function resolveRaUrl(
  artistId: string,
  signal?: AbortSignal,
): Promise<string | null> {
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
      body: JSON.stringify({
        query: `query GET_ARTIST($id: ID!) { artist(id: $id) { id name contentUrl } }`,
        variables: { id: artistId },
      }),
      signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as RAArtistQuery;
    const path = json.data?.artist?.contentUrl;
    if (!path) return null;
    return path.startsWith("http") ? path : `https://ra.co${path}`;
  } catch {
    return null;
  }
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
  soundcloud_url: string | null;
  discogs_url: string | null;
  ra_url: string | null;
  sets: ArtistSet[] | null;
  link_source: "auto" | "manual" | "none";
}

function rowToLinks(row: ArtistRow): ArtistLinks {
  return {
    id: row.ra_artist_id,
    name: row.name,
    mixcloudUser: row.mixcloud_user,
    mixcloudUrl: row.mixcloud_url,
    soundcloudUrl: row.soundcloud_url,
    discogsUrl: row.discogs_url,
    raUrl: row.ra_url,
    sets: row.sets ?? [],
    linkSource: row.link_source,
    cached: true,
  };
}

async function readCached(artistId: string): Promise<ArtistLinks | null> {
  const sql = getSql();
  if (!sql) return null;

  try {
    const rows = (await sql`
      select ra_artist_id, name, mixcloud_user, mixcloud_url, soundcloud_url,
             discogs_url, ra_url, sets, link_source
      from artist_links
      where ra_artist_id = ${artistId}
    `) as unknown as ArtistRow[];

    const row = rows[0];
    return row ? rowToLinks(row) : null;
  } catch (error) {
    // A missing table or an unreachable database degrades to live resolution.
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
        ra_artist_id, name, mixcloud_user, mixcloud_url, soundcloud_url,
        discogs_url, ra_url, sets, link_source, resolved_at, updated_at
      ) values (
        ${links.id}, ${links.name}, ${links.mixcloudUser}, ${links.mixcloudUrl},
        ${links.soundcloudUrl}, ${links.discogsUrl}, ${links.raUrl},
        ${JSON.stringify(links.sets)}::jsonb, ${links.linkSource}, now(), now()
      )
      on conflict (ra_artist_id) do update set
        name           = excluded.name,
        mixcloud_user  = excluded.mixcloud_user,
        mixcloud_url   = excluded.mixcloud_url,
        soundcloud_url = excluded.soundcloud_url,
        discogs_url    = excluded.discogs_url,
        ra_url         = excluded.ra_url,
        sets           = excluded.sets,
        link_source    = excluded.link_source,
        resolved_at    = now(),
        updated_at     = now()
      -- Never clobber a human correction with an automated re-resolve.
      where artist_links.link_source <> 'manual'
    `;
  } catch (error) {
    console.error("[artistLinks] write failed, continuing", error);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

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
    // All three in parallel — they're independent, and the slowest one shouldn't
    // stack on the others.
    const [mixcloud, discogs, raUrl] = await Promise.all([
      resolveMixcloud(name, controller.signal),
      resolveDiscogs(name, controller.signal),
      resolveRaUrl(artistId, controller.signal),
    ]);

    const fallback = buildFallbackLinks(name);

    const links: ArtistLinks = {
      id: artistId,
      name,
      mixcloudUser: mixcloud?.user ?? null,
      mixcloudUrl: mixcloud?.url ?? null,
      soundcloudUrl: fallback.soundcloudUrl,
      discogsUrl: discogs ?? fallback.discogsUrl,
      raUrl: raUrl ?? fallback.raUrl,
      sets: mixcloud?.sets ?? [],
      linkSource: mixcloud ? "auto" : "none",
      cached: false,
    };

    await writeCached(links);
    return links;
  } finally {
    clearTimeout(timeout);
  }
}
