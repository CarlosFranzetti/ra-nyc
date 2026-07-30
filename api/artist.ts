import type { IncomingMessage, ServerResponse } from "http";
import { getArtistLinks, type ArtistLinks } from "./_lib/artistLinks.js";
import { isDbEnabled } from "./_lib/db.js";
import { clientIp, rateLimit, rateLimitHeaders } from "./_lib/rateLimit.js";

export interface ArtistResponse extends ArtistLinks {
  /** Whether a database is configured — surfaced so the UI can be honest. */
  persisted: boolean;
}

/**
 * Third-party lookups are the expensive part, so the budget is tighter than
 * /api/events. With the database on, a given artist is resolved once ever.
 */
const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

const MAX_NAME_LENGTH = 120;

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

    const limit = rateLimit(`artist:${clientIp(req)}`, RATE_LIMIT);
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      for (const [k, v] of Object.entries(rateLimitHeaders(limit))) {
        res.setHeader(k, v);
      }
      return send(
        res,
        429,
        { error: "Too many requests. Please try again shortly." },
        "no-store",
      );
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const id = url.searchParams.get("id")?.trim();
    const name = url.searchParams.get("name")?.trim();

    if (!id || !name) {
      return send(res, 400, {
        error: "Query params `id` and `name` are both required",
      });
    }
    // RA ids are numeric strings; anything else is not a real lookup.
    if (!/^\d{1,12}$/.test(id)) {
      return send(res, 400, { error: "Query param `id` must be an RA artist id" });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return send(res, 400, { error: "Query param `name` is too long" });
    }

    const links = await getArtistLinks(id, name);

    // Very long edge cache: a DJ's Mixcloud/SoundCloud identity effectively
    // never changes, and this is the layer that protects those APIs from our
    // traffic when there's no database configured.
    return send(
      res,
      200,
      { ...links, persisted: isDbEnabled() } satisfies ArtistResponse,
      "public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000",
    );
  } catch (error) {
    console.error("[api/artist] unexpected failure", error);
    return send(res, 500, { error: "Failed to load artist" });
  }
}
