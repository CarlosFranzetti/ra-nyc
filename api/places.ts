import type { IncomingMessage, ServerResponse } from "http";
import { clientIp, rateLimit, rateLimitHeaders } from "./_lib/rateLimit.js";
import { STUB_SHOPS, STUB_VENUES } from "./_lib/placesStub.js";

/**
 * PROTOTYPE of `/api/places`: every located venue and every record shop, in one
 * response the browser can hold. The real version swaps the stub import for the
 * `venues` table and the committed shops file; the shape and headers stay.
 *
 * The data moves in days, not minutes, so it is edge-cached for a day and
 * served stale for a week while it revalidates.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  const limit = rateLimit(`places:${clientIp(req)}`, { limit: 30, windowMs: 60_000 });
  if (!limit.ok) {
    res.statusCode = 429;
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    for (const [k, val] of Object.entries(rateLimitHeaders(limit))) res.setHeader(k, val);
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Too many requests. Please try again shortly." }));
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  res.end(JSON.stringify({ venues: STUB_VENUES, shops: STUB_SHOPS, shopsAsOf: "stub", attribution: "OpenStreetMap contributors (ODbL)" }));
}
