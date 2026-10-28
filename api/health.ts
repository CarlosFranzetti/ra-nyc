import type { IncomingMessage, ServerResponse } from "http";
import { historyStatus, indexStatus } from "./_lib/eventCache.js";
import { soundcloudMode } from "./_lib/artistLinks.js";
import {
  HISTORY_BEHIND_DAYS,
  newYorkDay,
  NYC_AREA_ID,
  SEARCH_AHEAD_DAYS,
  SEARCH_BEHIND_DAYS,
  shiftDay,
} from "./_lib/ra.js";

/**
 * What is actually configured and working in this deployment.
 *
 * Exists because every optional dependency in this app degrades *silently* by
 * design — that is the property that makes them safe to add, and it is also
 * what makes "is the database even connected?" unanswerable from the outside.
 * A missing `DATABASE_URL` looks exactly like a database with nothing in it,
 * which looks exactly like a city with no events. That ambiguity has cost real
 * debugging time here more than once: a SoundCloud key that was set but never
 * deployed, and four migrations that appeared to invalidate a cache and did not.
 *
 * Deliberately says whether things are configured, never what they are set to.
 * No connection strings, no keys, no hostnames.
 */

export interface HealthResponse {
  ok: boolean;
  database: {
    configured: boolean;
    reachable: boolean;
    /** Which migrations have actually been applied, by the tables they create. */
    tables: { artist_links: boolean; event_cache: boolean };
  };
  search: {
    /** Days of the window the index holds, out of how many it spans. */
    indexed: number;
    window: number;
    oldest: string | null;
    newest: string | null;
  };
  /**
   * What the index holds beyond the search window, back to the five-year edge:
   * distinct days, the oldest day, and rows. Null when there is no database or
   * the query failed. This is the history people have browsed into the index,
   * which nothing preloads — so it growing is the feature working.
   */
  history: { days: number; oldest: string | null; rows: number } | null;
  soundcloud: "official" | "api-v2" | "off";
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  // Never cached: the entire point is to report the state of *this* moment.
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body, null, 2));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return send(res, 405, { error: "Method not allowed" });
    }

    const configured = Boolean(process.env.DATABASE_URL);
    const today = newYorkDay();
    const [status, history] = await Promise.all([
      indexStatus({
        areaId: NYC_AREA_ID,
        behindDays: SEARCH_BEHIND_DAYS,
        aheadDays: SEARCH_AHEAD_DAYS,
        today,
      }),
      // The band behind the search window, so `search` and `history` never count
      // the same row twice.
      historyStatus({
        areaId: NYC_AREA_ID,
        from: shiftDay(today, -HISTORY_BEHIND_DAYS),
        to: shiftDay(today, -(SEARCH_BEHIND_DAYS + 1)),
      }),
    ]);

    const body: HealthResponse = {
      // A missing database is a supported configuration, not a failure — so
      // `ok` is about whether anything is *broken*, which means configured but
      // unreachable, or reachable with its tables missing.
      ok: !configured || (status.reachable && status.tables.event_cache),
      database: {
        configured,
        reachable: status.reachable,
        tables: status.tables,
      },
      search: {
        indexed: status.daysCovered,
        window: SEARCH_AHEAD_DAYS + SEARCH_BEHIND_DAYS + 1,
        oldest: status.oldest,
        newest: status.newest,
      },
      history,
      soundcloud: soundcloudMode(),
    };

    return send(res, 200, body);
  } catch (error) {
    // Nothing may escape: an uncaught throw here is a FUNCTION_INVOCATION_FAILED
    // with no message, which is the exact opposite of what this endpoint is for.
    console.error("[api/health] unexpected failure", error);
    return send(res, 500, { ok: false, error: "Health check failed" });
  }
}
