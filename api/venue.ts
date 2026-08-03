import type { IncomingMessage, ServerResponse } from "http";
import { clientIp, rateLimit, rateLimitHeaders } from "./_lib/rateLimit.js";

/**
 * Resolves a venue name to coordinates.
 *
 * RA's API gives us a venue *name* and nothing else — no address, no lat/lon —
 * so a map means geocoding. Nominatim is OpenStreetMap's own geocoder: keyless,
 * and free provided you identify yourself and don't hammer it. Both of those are
 * why this is a server function rather than a browser call: the browser cannot
 * set a meaningful `User-Agent`, and a per-visitor call would be exactly the
 * hammering their policy asks you to avoid. One edge-cached response serves
 * everyone.
 *
 * Cached for a month. A venue's location is the least volatile thing in this
 * entire app.
 */

export interface VenueResponse {
  name: string;
  /** Null when the geocoder found nothing — the UI then offers a plain search. */
  lat: number | null;
  lon: number | null;
  /** Nominatim's own label, so the sheet can show what it actually matched. */
  label: string | null;
  /** Always present: opens the platform's map app, coordinates or not. */
  mapsUrl: string;
}

const UPSTREAM_TIMEOUT_MS = 6_000;
const RATE_LIMIT = { limit: 40, windowMs: 60_000 };
const MAX_NAME_LENGTH = 120;

/** Everything here is New York; biasing the query stops "Signal" landing abroad. */
const CITY_SUFFIX = "New York, NY, USA";

/** Roughly the five boroughs plus a margin, as Nominatim's viewbox order. */
const NYC_VIEWBOX = "-74.30,40.90,-73.65,40.45";

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
}

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

/**
 * A maps link that works everywhere.
 *
 * `geo:` is the correct scheme but desktop browsers do nothing with it, and
 * Apple's `maps.apple.com` handles both platforms: iOS opens Apple Maps, and
 * everything else gets a usable web map.
 */
function mapsLink(name: string, lat: number | null, lon: number | null): string {
  const label = encodeURIComponent(`${name}, ${CITY_SUFFIX}`);
  return lat !== null && lon !== null
    ? `https://maps.apple.com/?q=${label}&ll=${lat},${lon}`
    : `https://maps.apple.com/?q=${label}`;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    if (req.method !== "GET") {
      return send(res, 405, { error: "Method not allowed" });
    }

    const limit = rateLimit(`venue:${clientIp(req)}`, RATE_LIMIT);
    if (!limit.ok) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      for (const [key, value] of Object.entries(rateLimitHeaders(limit))) {
        res.setHeader(key, value);
      }
      return send(
        res,
        429,
        { error: "Too many requests. Please try again shortly." },
        "no-store",
      );
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const name = url.searchParams.get("name")?.trim();

    if (!name) {
      return send(res, 400, { error: "Query param `name` is required" });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return send(res, 400, { error: "Query param `name` is too long" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const query = new URLSearchParams({
        q: `${name}, ${CITY_SUFFIX}`,
        format: "jsonv2",
        limit: "1",
        viewbox: NYC_VIEWBOX,
        // Bias towards the box without hard-failing when a venue sits just
        // outside it — a Jersey warehouse should still resolve.
        bounded: "0",
      });

      const upstream = await fetch(
        `https://nominatim.openstreetmap.org/search?${query.toString()}`,
        {
          headers: {
            Accept: "application/json",
            // Nominatim's usage policy requires a real identifier. Sending a
            // browser-shaped UA here would be both a lie and a policy breach.
            "User-Agent": "ra-nyc/1.0 (+https://ra-nyc.vercel.app)",
          },
          signal: controller.signal,
        },
      );

      // A geocoder failure is not an error the user needs to see: the map is a
      // nicety, and the maps link works without coordinates.
      const hit: NominatimHit | undefined = upstream.ok
        ? ((await upstream.json()) as NominatimHit[])[0]
        : undefined;

      const lat = hit?.lat ? Number(hit.lat) : null;
      const lon = hit?.lon ? Number(hit.lon) : null;
      const usable = lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon);

      return send(
        res,
        200,
        {
          name,
          lat: usable ? lat : null,
          lon: usable ? lon : null,
          label: hit?.display_name ?? null,
          mapsUrl: mapsLink(name, usable ? lat : null, usable ? lon : null),
        } satisfies VenueResponse,
        // A month. Venues do not move, and this is the politest thing we can do
        // for a free geocoder.
        "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000",
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return send(res, 504, { error: "Geocoder timed out" });
    }
    console.error("[api/venue] unexpected failure", error);
    return send(res, 500, { error: "Failed to locate venue" });
  }
}
