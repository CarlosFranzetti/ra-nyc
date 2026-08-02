import type { IncomingMessage, ServerResponse } from "http";
import { clientIp, rateLimit, rateLimitHeaders } from "./_lib/rateLimit.js";

/**
 * Same-origin proxy for RA flyer images.
 *
 * Loading `images.ra.co` directly from the browser can fail — the CDN applies
 * hotlink protection based on `Referer`/`Origin`, and a browser cannot forge
 * either (both are forbidden headers). The same problem, and the same fix, as
 * `api/events.ts`: do it server-side.
 *
 * This is a *fallback*, not the default path. `EventImage` tries the CDN
 * directly first, so in the common case no bytes flow through this function.
 */

/** Strict allowlist. Without it this is an open proxy anyone could abuse. */
const ALLOWED_HOSTS = new Set(["images.ra.co", "ra.co", "www.ra.co"]);

const MAX_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Higher than the events limit: one screen of listings can ask for ~50 flyers,
 * and if the CDN is blocking direct loads every one of them arrives here. Still
 * bounded, because this endpoint moves real bytes.
 */
const RATE_LIMIT = { limit: 200, windowMs: 60_000 };

function fail(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: message }));
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.method !== "GET") return fail(res, 405, "Method not allowed");

    const limit = rateLimit(`image:${clientIp(req)}`, RATE_LIMIT);
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      for (const [k, v] of Object.entries(rateLimitHeaders(limit))) {
        res.setHeader(k, v);
      }
      // no-store, or the edge serves this 429 to everyone.
      res.setHeader("Cache-Control", "no-store");
      return fail(res, 429, "Too many requests. Please try again shortly.");
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const target = url.searchParams.get("u");
    if (!target) return fail(res, 400, "Query param `u` is required");

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return fail(res, 400, "Query param `u` must be an absolute URL");
    }

    if (parsed.protocol !== "https:") {
      return fail(res, 400, "Only https URLs are allowed");
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return fail(res, 400, `Host ${parsed.hostname} is not allowed`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const upstream = await fetch(parsed.toString(), {
        // The host allowlist above is checked once, against the URL the caller
        // supplied. Node follows redirects by default, and the hop target is
        // never re-checked — so an open redirect on an allowed host would walk
        // this proxy straight off the allowlist and relay whatever it landed
        // on, from our origin, under our immutable cache header. Refusing to
        // follow keeps the allowlist meaning what it says.
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          Referer: "https://ra.co/",
        },
        signal: controller.signal,
      });

      // `manual` surfaces the 3xx rather than throwing, so reject it explicitly.
      // RA serves flyers directly; a redirect here means something changed and
      // is worth failing loudly over rather than chasing.
      if (upstream.status >= 300 && upstream.status < 400) {
        return fail(res, 502, "Upstream redirected; refusing to follow");
      }
      if (!upstream.ok) {
        return fail(res, 502, `Upstream responded with ${upstream.status}`);
      }

      const contentType = upstream.headers.get("content-type") ?? "";
      // Never let this endpoint relay non-images; that turns an image proxy
      // into a general-purpose content relay.
      if (!contentType.startsWith("image/")) {
        return fail(res, 502, "Upstream did not return an image");
      }

      const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_BYTES) {
        return fail(res, 413, "Image too large");
      }

      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.byteLength > MAX_BYTES) {
        return fail(res, 413, "Image too large");
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(body.byteLength));
      // RA flyer URLs are content-addressed, so the bytes behind a given URL
      // never change — cache them hard at the edge and in the browser.
      res.setHeader(
        "Cache-Control",
        "public, max-age=86400, s-maxage=2592000, immutable",
      );
      res.end(body);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return fail(res, 504, "Upstream timed out");
    }
    console.error("[api/image] unexpected failure", error);
    return fail(res, 500, "Failed to load image");
  }
}
