import type { IncomingMessage, ServerResponse } from "http";
import {
  NYC_AREA_ID,
  RAError,
  searchRAEvents,
  type RAEvent,
} from "./_lib/ra.js";
import { clientIp, rateLimit, rateLimitHeaders } from "./_lib/rateLimit.js";

export interface SearchResponse {
  q: string;
  upcoming: RAEvent[];
  past: RAEvent[];
  /** The search window was full, so there may be more beyond it. */
  truncated: boolean;
  /** Days of the window the durable index holds, out of how many it spans. */
  coverage: { indexed: number; window: number };
}

/** Six pages of listings per search, so this is the most expensive endpoint. */
const UPSTREAM_TIMEOUT_MS = 12_000;

/**
 * Tighter than /api/events. Typing is debounced client-side, but a search costs
 * several upstream requests where a day listing costs one.
 */
const RATE_LIMIT = { limit: 20, windowMs: 60_000 };

const MIN_TERM = 2;
const MAX_TERM = 80;

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

    const limit = rateLimit(`search:${clientIp(req)}`, RATE_LIMIT);
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      for (const [key, value] of Object.entries(rateLimitHeaders(limit))) {
        res.setHeader(key, value);
      }
      return send(
        res,
        429,
        { error: "Too many searches. Please try again shortly." },
        "no-store",
      );
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const q = url.searchParams.get("q")?.trim() ?? "";

    if (q.length < MIN_TERM) {
      return send(res, 400, {
        error: `Query param \`q\` must be at least ${MIN_TERM} characters`,
      });
    }
    if (q.length > MAX_TERM) {
      return send(res, 400, { error: "Query param `q` is too long" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const { upcoming, past, truncated, coverage } = await searchRAEvents({
        term: q,
        areaId: NYC_AREA_ID,
        signal: controller.signal,
      });

      // Long edge cache: the listings behind a search barely move within an
      // hour, and this is the endpoint where a cache miss is most expensive.
      // Repeated searches for the same DJ cost RA nothing after the first.
      return send(
        res,
        200,
        { q, upcoming, past, truncated, coverage } satisfies SearchResponse,
        "public, max-age=120, s-maxage=900, stale-while-revalidate=86400",
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
    console.error("[api/search] unexpected failure", error);
    return send(res, 500, { error: "Search failed" });
  }
}
