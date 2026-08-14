import type { IncomingMessage, ServerResponse } from "http";
import { cacheEvents, missingDays } from "./_lib/eventCache.js";
import {
  fetchRAEvents,
  NYC_AREA_ID,
  SEARCH_AHEAD_DAYS,
  SEARCH_BEHIND_DAYS,
} from "./_lib/ra.js";

/**
 * Fills the gaps in the search index.
 *
 * The index otherwise only learns about days somebody browsed or searched, so
 * coverage tracks traffic rather than the calendar — and with few visitors a
 * quiet Tuesday six weeks ago never gets indexed at all. This walks the window
 * and fetches the days that are missing.
 *
 * ## Why it is chunked
 *
 * One day is one request to RA. Sixty of them in a single invocation would be
 * both slow enough to hit the function's own ceiling and rude enough to matter
 * to RA. So each run takes a bounded slice, **nearest days first** — the recent
 * past is what "when did they last play" is actually asking about — and reports
 * what is left. Run it again, or let the daily cron do it, and the window fills
 * in a few passes.
 *
 * ## Why it is not public
 *
 * It causes upstream requests on demand, which is the definition of something
 * worth abusing. It requires a bearer token and **refuses to run without one
 * configured** rather than falling open, which is the failure mode that matters:
 * an endpoint that quietly becomes public when an env var is missing is worse
 * than one that stops working.
 */

/**
 * Days per run.
 *
 * Was 14, which is fine arithmetic and a bad experience: the window is 181 days
 * (150 back, 30 ahead), so a cold index took a fortnight of nightly runs to
 * become useful, and for that fortnight search answers "nothing found" for
 * anything older than a week. Filling it in three nights instead is the
 * difference between a feature that works and one you have to be told to wait
 * for.
 *
 * The real limit is the time budget below, not this number — a run stops when
 * the clock says so and reports what it managed.
 */
const DEFAULT_DAYS = 60;
const MAX_DAYS = 90;

/** Concurrent RA requests. Deliberately gentle — this is a background job. */
const CONCURRENCY = 6;

/**
 * Leaves headroom under the `maxDuration` in vercel.json rather than being
 * killed mid-run.
 *
 * That duration went from 15s to 60s specifically for this job. The earlier
 * note here argued against it on the grounds that a background job can simply
 * take another pass tomorrow — true, but "tomorrow" times thirteen is how long
 * a cold index took to become searchable, and the endpoint is bearer-gated and
 * runs once a day, so the longer ceiling costs nothing anyone shares.
 *
 * Two things about `vercel.json` that this cost a deploy each to learn, and
 * which belong here because `vercel.json` cannot hold a comment:
 *
 * 1. Every function is listed individually rather than as an `api/*.ts` glob.
 *    A pattern that overlaps an earlier one is not merged or overridden — it is
 *    a hard error, reported as *"doesn't match any Serverless Functions"*,
 *    which reads as though the file is missing.
 * 2. The schema rejects unknown keys outright, so there is no `_comment` to
 *    hang an explanation on. Hence this paragraph.
 */
const TIME_BUDGET_MS = 50_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

export interface BackfillResponse {
  ok: boolean;
  /** Days that had nothing indexed when this run started. */
  missing: number;
  attempted: number;
  indexed: number;
  events: number;
  failed: string[];
  /** Still missing after this run. Zero means the window is covered. */
  remaining: number;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body, null, 2));
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that variable is
 * set, so the same check serves both the schedule and a manual run.
 */
function authorised(req: IncomingMessage): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${secret}`;
}

function shift(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, { error: "Method not allowed" });
    }

    if (!process.env.CRON_SECRET) {
      return send(res, 503, {
        error:
          "Backfill is disabled: set CRON_SECRET in the project's environment " +
          "variables and redeploy. Changing an environment variable does not " +
          "redeploy on its own.",
      });
    }

    if (!authorised(req)) {
      // No detail, and no hint about which half was wrong.
      return send(res, 401, { error: "Unauthorized" });
    }

    if (!process.env.DATABASE_URL) {
      return send(res, 503, {
        error: "No DATABASE_URL configured, so there is no index to fill.",
      });
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const requested = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
    const days =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), MAX_DAYS)
        : DEFAULT_DAYS;

    const gaps = await missingDays({
      areaId: NYC_AREA_ID,
      from: shift(-SEARCH_BEHIND_DAYS),
      // Ahead as well as behind. Future days do get indexed by anyone browsing
      // them, but "anyone browsed it" is not coverage — a quiet Wednesday three
      // weeks out is exactly the day nobody opens and search then cannot answer
      // for it.
      to: shift(SEARCH_AHEAD_DAYS),
    });

    // `missingDays` returns newest first, so slicing takes the recent past.
    const targets = gaps.slice(0, days);
    const startedAt = Date.now();
    const failed: string[] = [];
    let indexed = 0;
    let events = 0;

    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      // Out of time. Reporting what was done beats being killed mid-write.
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;

      const batch = targets.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (day) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
          try {
            const fetched = await fetchRAEvents({
              date: day,
              areaId: NYC_AREA_ID,
              signal: controller.signal,
            });
            await cacheEvents(fetched, NYC_AREA_ID);
            indexed += 1;
            events += fetched.length;
          } catch (error) {
            // One bad day must not end the run; the next pass retries it,
            // because it will still be missing.
            failed.push(day);
            console.warn(`[backfill] ${day} failed`, error);
          } finally {
            clearTimeout(timer);
          }
        }),
      );
    }

    // A day RA genuinely has no events for stays "missing" forever and will be
    // retried on every run. Cheap at this volume, and the alternative — a
    // sentinel row — would mean inventing an event that does not exist.
    return send(res, 200, {
      ok: failed.length === 0,
      missing: gaps.length,
      attempted: targets.length,
      indexed,
      events,
      failed,
      remaining: Math.max(gaps.length - indexed, 0),
    } satisfies BackfillResponse);
  } catch (error) {
    console.error("[api/backfill] unexpected failure", error);
    return send(res, 500, { ok: false, error: "Backfill failed" });
  }
}
