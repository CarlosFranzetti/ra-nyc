import type { IncomingMessage, ServerResponse } from "http";
import {
  fetchRAEvents,
  isValidDate,
  NYC_AREA_ID,
  RAError,
  type RAEvent,
} from "./_lib/ra.js";

export interface EventsResponse {
  date: string;
  events: RAEvent[];
  count: number;
}

const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Written against Node's IncomingMessage/ServerResponse rather than the web
 * standard Request/Response.
 *
 * Vercel invokes a default export in `api/` with Node's (req, res) — the
 * `Request`/`Response` signature applies only to *named* method exports
 * (`export function GET(request: Request)`). Node's types are also exactly
 * what Vite's dev middleware hands us, so the same handler runs unmodified in
 * both places.
 */

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  cacheControl?: string,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cacheControl) res.setHeader("Cache-Control", cacheControl);
  res.end(JSON.stringify(body));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.method !== "GET") {
      return send(res, 405, { error: "Method not allowed" });
    }

    // req.url is a path, not an absolute URL, so URL needs a base. The base is
    // never used — we only read searchParams off it.
    const url = new URL(req.url ?? "/", "http://localhost");
    const date = url.searchParams.get("date");
    const areaParam = url.searchParams.get("area");

    if (!date || !isValidDate(date)) {
      return send(res, 400, { error: "Query param `date` must be YYYY-MM-DD" });
    }

    const areaId = areaParam ? Number(areaParam) : NYC_AREA_ID;
    if (!Number.isInteger(areaId) || areaId <= 0) {
      return send(res, 400, {
        error: "Query param `area` must be a positive integer",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const events = await fetchRAEvents({
        date,
        areaId,
        signal: controller.signal,
      });

      // Listings barely move within a day, so let the Vercel edge cache absorb
      // the traffic and keep serving stale data while it revalidates.
      return send(
        res,
        200,
        { date, events, count: events.length } satisfies EventsResponse,
        "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof RAError) {
      return send(res, error.status, { error: error.message });
    }
    if (error instanceof Error && error.name === "AbortError") {
      return send(res, 504, { error: "Resident Advisor timed out" });
    }
    // Nothing may escape this handler — an uncaught throw is a
    // FUNCTION_INVOCATION_FAILED with no useful message for the client.
    console.error("[api/events] unexpected failure", error);
    return send(res, 500, { error: "Failed to load events" });
  }
}
