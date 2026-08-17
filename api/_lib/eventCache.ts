/**
 * A durable index of listings, so search stops re-deriving one per query.
 *
 * ## Why this exists
 *
 * RA exposes no text predicate this client can rely on, so search means pulling
 * a window of listings and matching them here. Two facts about RA make that a
 * losing trade: a page caps at 100 rows, and NYC generates roughly a *hundred
 * listing rows a day* — every day of a multi-day run is its own row. Three pages
 * forward therefore reached about three days ahead, not sixty, and the past
 * beyond the nearest few days was openly sampled rather than covered.
 *
 * No amount of paging fixes that inside one request. Remembering does. Every
 * listing the app fetches, for a day view or for a search, is written here, so
 * coverage accumulates as the app is used.
 *
 * ## Still a cache
 *
 * Every function below fails soft. No `DATABASE_URL`, a missing table, an
 * unreachable Neon — search falls back to exactly the live-window behaviour it
 * had before this file existed, and day views are unaffected. That property is
 * the whole reason this is safe to add.
 */

import { getSql } from "./db.js";
import { searchKey } from "./normalize.js";
import { expandTerm } from "./vocab.js";
import type { RAEvent } from "./ra.js";

/**
 * Rows pulled for the fuzzy pass when the indexed filter finds nothing.
 *
 * Substring and leet-folding both happen in SQL, which covers almost every
 * query. Edit-distance matching cannot, so a term that only matches by typo
 * needs rows in memory — bounded here, newest first, because a typo'd search
 * for something six weeks old is not worth scanning a year of listings for.
 */
const FUZZY_SCAN_LIMIT = 1200;

/** Never let an index write hold up the listing it was derived from. */
const WRITE_TIMEOUT_MS = 2_500;

interface CacheRow {
  ra_event_id: string;
  event_date: string;
  title: string;
  venue_name: string;
  venue_area: string | null;
  artists: { id: string; name: string }[] | null;
  url: string | null;
  image_url: string | null;
  attending: number | null;
  is_pick: boolean | null;
  pick_blurb: string | null;
  start_time: string | null;
  end_time: string | null;
}

function toEvent(row: CacheRow): RAEvent {
  return {
    id: row.ra_event_id,
    title: row.title,
    // Stored as a `date`, so it comes back either as a bare day or an ISO
    // timestamp depending on the driver. The rest of the app compares the first
    // ten characters of this string and nothing else.
    date: String(row.event_date).slice(0, 10),
    startTime: row.start_time ?? "",
    endTime: row.end_time ?? "",
    url: row.url ?? "",
    imageUrl: row.image_url,
    // No id from the index: the schema predates it, and a migration to add a
    // column the venue sheet can re-derive from a live listing would be a
    // migration for nothing. A cached event's venue simply geocodes by name,
    // which is what every venue did until now anyway.
    venue: { id: null, name: row.venue_name, area: row.venue_area ?? "" },
    artists: row.artists ?? [],
    attending: row.attending ?? 0,
    isPick: row.is_pick ?? false,
    pickBlurb: row.pick_blurb,
  };
}

/** The haystack the matcher searches, folded once at write time. */
function haystack(event: RAEvent): string {
  return searchKey(
    [event.title, event.venue.name, ...event.artists.map((a) => a.name)].join(" "),
  );
}

/** The night an event belongs to — its start, falling back to its listed date. */
function eventDay(event: RAEvent): string | null {
  const day = (event.startTime || event.date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Records everything the app has just seen.
 *
 * Awaited rather than fired and forgotten: a Vercel invocation can be frozen the
 * moment its response is sent, so a dangling promise is not reliably a write.
 * It is bounded by its own timeout and can only ever resolve — the listing the
 * caller is about to return must not depend on this succeeding.
 */
export async function cacheEvents(events: RAEvent[], areaId: number): Promise<void> {
  const sql = getSql();
  if (!sql || events.length === 0) return;

  const rows = events
    .map((event) => ({ event, day: eventDay(event) }))
    .filter((row): row is { event: RAEvent; day: string } => row.day !== null);
  if (rows.length === 0) return;

  // One tuple of placeholders per row, numbered straight off the values array
  // as it is built. Anything cleverer here is a chance to number them wrongly,
  // and a mis-numbered placeholder is a silent column swap rather than an error.
  const values: unknown[] = [];
  const tuples = rows.map(({ event, day }) => {
    const cells = [
      event.id,
      areaId,
      day,
      event.title,
      event.venue.name,
      event.venue.area || null,
      JSON.stringify(event.artists ?? []),
      event.url || null,
      event.imageUrl,
      event.attending ?? 0,
      event.isPick ?? false,
      event.pickBlurb,
      event.startTime || null,
      event.endTime || null,
      // Derived rather than passed in, so it cannot disagree with the columns
      // it summarises.
      haystack(event),
    ];
    const start = values.length;
    values.push(...cells);
    const casts: Record<number, string> = { 2: "::date", 6: "::jsonb" };
    return `(${cells
      .map((_, i) => `$${start + i + 1}${casts[i] ?? ""}`)
      .join(",")})`;
  });

  const text = `
    insert into event_cache (
      ra_event_id, area_id, event_date, title, venue_name, venue_area,
      artists, url, image_url, attending, is_pick, pick_blurb,
      start_time, end_time, search_key
    ) values ${tuples.join(",")}
    on conflict (ra_event_id) do update set
      area_id    = excluded.area_id,
      event_date = excluded.event_date,
      title      = excluded.title,
      venue_name = excluded.venue_name,
      venue_area = excluded.venue_area,
      artists    = excluded.artists,
      url        = excluded.url,
      image_url  = excluded.image_url,
      attending  = excluded.attending,
      is_pick    = excluded.is_pick,
      pick_blurb = excluded.pick_blurb,
      start_time = excluded.start_time,
      end_time   = excluded.end_time,
      search_key = excluded.search_key,
      seen_at    = now()
  `;

  try {
    await Promise.race([
      sql.query(text, values),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), WRITE_TIMEOUT_MS),
      ),
    ]);
  } catch (error) {
    // Logged, not swallowed: a silently failing index looks exactly like a
    // city with no events in it, which cost three rounds of debugging once.
    console.warn("[eventCache] write failed, continuing", error);
  }
}

export interface CachedWindow {
  events: RAEvent[];
  /** Distinct days the index actually holds inside the requested window. */
  daysCovered: number;
}

const EMPTY: CachedWindow = { events: [], daysCovered: 0 };

/**
 * Events in the index matching `term`, between two days.
 *
 * The SQL filter is a substring test on `search_key`, which covers the
 * matcher's first two passes at once: both sides go through the same folding,
 * so "holo" finds **h0l0** and "bjork" finds Björk without the query needing to
 * know which spelling it is looking at.
 *
 * It cannot cover the third pass — edit distance — so `fuzzy` returns a bounded
 * slice of the window for the caller to match in memory instead. That path only
 * runs when the indexed one came back empty.
 */
export async function searchCachedEvents(options: {
  term: string;
  areaId: number;
  from: string;
  to: string;
  limit: number;
}): Promise<CachedWindow> {
  const sql = getSql();
  if (!sql) return EMPTY;

  // Every key the vocabulary offers, ORed. An ordinary term expands to itself
  // alone and the predicate collapses to the single `like` it always was; a
  // vibe word like "after" becomes the handful of words promoters use for it.
  const keys = expandTerm(options.term);
  if (keys.length === 0) return EMPTY;

  // Built rather than interpolated: the number of keys is data-dependent, so
  // the placeholders have to be too. The values still go through the driver —
  // nothing from the query string is ever concatenated into SQL.
  const predicate = keys
    .map((_, i) => `search_key like '%' || $${i + 5} || '%'`)
    .join(" or ");

  try {
    const rows = (await sql.query(
      `select ra_event_id, event_date, title, venue_name, venue_area, artists,
              url, image_url, attending, is_pick, pick_blurb, start_time, end_time
         from event_cache
        where area_id = $1
          and event_date between $2::date and $3::date
          and (${predicate})
        order by event_date desc
        limit $4`,
      [options.areaId, options.from, options.to, options.limit, ...keys],
    )) as unknown as CacheRow[];

    return { events: rows.map(toEvent), daysCovered: await coverage(options) };
  } catch (error) {
    console.warn("[eventCache] read failed, falling back to live", error);
    return EMPTY;
  }
}

/**
 * One day's listings, straight from the index.
 *
 * The fallback for when `ra.co` is unreachable or blocking. A day view has
 * always been all-or-nothing — RA answers or the page shows an error — and
 * "RA may block Vercel's egress IPs" has been an open risk in memorystate since
 * the migration. Serving what we last saw turns that from an outage into
 * slightly-old listings, which for a listings app is the difference between
 * useless and fine.
 *
 * Ordered busiest-first to match the live path exactly, so the fallback is
 * indistinguishable from a normal response apart from the flag on it.
 */
export async function cachedEventsForDay(options: {
  areaId: number;
  date: string;
}): Promise<RAEvent[]> {
  const sql = getSql();
  if (!sql) return [];

  try {
    const rows = (await sql.query(
      `select ra_event_id, event_date, title, venue_name, venue_area, artists,
              url, image_url, attending, is_pick, pick_blurb, start_time, end_time
         from event_cache
        where area_id = $1 and event_date = $2::date
        order by attending desc`,
      [options.areaId, options.date],
    )) as unknown as CacheRow[];
    return rows.map(toEvent);
  } catch (error) {
    console.warn("[eventCache] day read failed", error);
    return [];
  }
}

/** A bounded slice of the window, for the in-memory fuzzy pass. */
export async function recentCachedEvents(options: {
  areaId: number;
  from: string;
  to: string;
}): Promise<RAEvent[]> {
  const sql = getSql();
  if (!sql) return [];

  try {
    const rows = (await sql.query(
      `select ra_event_id, event_date, title, venue_name, venue_area, artists,
              url, image_url, attending, is_pick, pick_blurb, start_time, end_time
         from event_cache
        where area_id = $1
          and event_date between $2::date and $3::date
        order by event_date desc
        limit $4`,
      [options.areaId, options.from, options.to, FUZZY_SCAN_LIMIT],
    )) as unknown as CacheRow[];
    return rows.map(toEvent);
  } catch (error) {
    console.warn("[eventCache] scan failed", error);
    return [];
  }
}

export interface IndexStatus {
  /** False means no `DATABASE_URL`, or Neon refused the connection. */
  reachable: boolean;
  /** Which migrations have actually run, judged by what they create. */
  tables: { artist_links: boolean; event_cache: boolean };
  daysCovered: number;
  oldest: string | null;
  newest: string | null;
}

/**
 * What the index actually is right now.
 *
 * Everything optional in this app degrades silently, which is what makes it
 * safe to add and also what makes its state invisible: no `DATABASE_URL` looks
 * exactly like an empty table, which looks exactly like a city with no events.
 * `to_regclass` answers the question that matters — did the migration run? —
 * without needing to know anything about the connection but whether it works.
 */
export async function indexStatus(options: {
  areaId: number;
  behindDays: number;
  aheadDays: number;
}): Promise<IndexStatus> {
  const sql = getSql();
  const unreachable: IndexStatus = {
    reachable: false,
    tables: { artist_links: false, event_cache: false },
    daysCovered: 0,
    oldest: null,
    newest: null,
  };
  if (!sql) return unreachable;

  try {
    const tables = (await sql.query(
      `select to_regclass('public.artist_links') is not null as artist_links,
              to_regclass('public.event_cache')  is not null as event_cache`,
    )) as unknown as { artist_links: boolean; event_cache: boolean }[];

    const present = tables[0] ?? { artist_links: false, event_cache: false };
    if (!present.event_cache) {
      return { ...unreachable, reachable: true, tables: present };
    }

    const shift = (days: number) =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    const stats = (await sql.query(
      `select count(distinct event_date)::int as days,
              min(event_date)::text as oldest,
              max(event_date)::text as newest
         from event_cache
        where area_id = $1 and event_date between $2::date and $3::date`,
      [options.areaId, shift(-options.behindDays), shift(options.aheadDays)],
    )) as unknown as { days: number; oldest: string | null; newest: string | null }[];

    return {
      reachable: true,
      tables: present,
      daysCovered: stats[0]?.days ?? 0,
      oldest: stats[0]?.oldest ?? null,
      newest: stats[0]?.newest ?? null,
    };
  } catch (error) {
    console.warn("[eventCache] status check failed", error);
    return { ...unreachable, tables: { artist_links: false, event_cache: false } };
  }
}

/** Days inside a window that the index has nothing at all for. */
export async function missingDays(options: {
  areaId: number;
  from: string;
  to: string;
}): Promise<string[]> {
  const sql = getSql();
  if (!sql) return [];

  try {
    const rows = (await sql.query(
      `select to_char(d, 'YYYY-MM-DD') as day
         from generate_series($2::date, $3::date, interval '1 day') as d
        where not exists (
          select 1 from event_cache
           where area_id = $1 and event_date = d::date
        )
        order by d desc`,
      [options.areaId, options.from, options.to],
    )) as unknown as { day: string }[];
    return rows.map((row) => row.day);
  } catch (error) {
    console.warn("[eventCache] gap scan failed", error);
    return [];
  }
}

/**
 * How many distinct days the index holds in a window.
 *
 * This is what makes `truncated` honest. A search over ninety days that only
 * has forty of them indexed is not a complete answer, and the response should
 * not imply otherwise.
 */
async function coverage(options: {
  areaId: number;
  from: string;
  to: string;
}): Promise<number> {
  const sql = getSql();
  if (!sql) return 0;
  try {
    const rows = (await sql.query(
      `select count(distinct event_date)::int as days
         from event_cache
        where area_id = $1 and event_date between $2::date and $3::date`,
      [options.areaId, options.from, options.to],
    )) as unknown as { days: number }[];
    return rows[0]?.days ?? 0;
  } catch {
    return 0;
  }
}
