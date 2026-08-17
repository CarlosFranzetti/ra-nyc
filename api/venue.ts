import type { IncomingMessage, ServerResponse } from "http";
import { clientIp, rateLimit, rateLimitHeaders } from "./_lib/rateLimit.js";
import { RA_GRAPHQL_URL } from "./_lib/ra.js";

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
  /**
   * The address, from whichever source produced one.
   *
   * Nominatim's `display_name` when it geocoded, RA's own venue record when it
   * did not. Those are the two halves of "some venues have no address": a
   * warehouse party or a one-off loft is exactly what a street-address geocoder
   * cannot place, and exactly what RA does know, because a promoter typed it in.
   */
  address: string | null;
  /** Which of the two answered, so the sheet can be honest about precision. */
  addressSource: "geocoder" | "ra" | null;
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

const VENUE_QUERY = `
  query GET_VENUE($id: ID!) {
    venue(id: $id) {
      id
      name
      address
    }
  }
`;

/**
 * RA's own address for a venue, or null.
 *
 * The geocoder answers for anywhere with a street address in OpenStreetMap,
 * which is most clubs and none of the interesting ones — a warehouse in
 * Ridgewood, a loft with a buzzer code, a boat. RA has an address for those
 * because a promoter typed one in, and it is displayed right under the venue
 * name on their page. This asks for it.
 *
 * **Every failure here is silent and expected.** The address is an enhancement
 * on a map that already works, and this function is the only thing in the app
 * calling a part of RA's schema nothing else touches — if the field is renamed,
 * or the query shape is wrong, the sheet must lose one line rather than the
 * venue lookup returning 500. Hence the catch-all rather than a rethrow, and
 * hence this being a second request instead of a field added to the listings
 * query, where a schema mismatch would take down every event in the app.
 */
async function raAddress(id: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(RA_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // Same browser-shaped headers the listings client sends; RA rejects
        // requests that do not look like one.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://ra.co/events/us/newyork",
        Origin: "https://ra.co",
      },
      body: JSON.stringify({
        operationName: "GET_VENUE",
        query: VENUE_QUERY,
        variables: { id },
      }),
      signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: { venue?: { address?: string | null } | null };
      errors?: unknown[];
    };
    if (json.errors?.length) return null;

    const address = json.data?.venue?.address?.trim();
    return address ? address : null;
  } catch {
    return null;
  }
}

/**
 * One Nominatim lookup.
 *
 * Factored out because it is now called twice — once for the venue's name and,
 * when that misses, once for RA's street address.
 *
 * `ok` separates "the geocoder answered, and has nothing for this" from "the
 * geocoder did not answer", which look identical to the sheet and are very
 * different to the cache. This response is cached for a month, so a transient
 * timeout that returned a coordinate-less body would pin a venue as unmappable
 * for thirty days — a five-second blip becoming a month-long bug. The handler
 * uses this flag to decline the long cache on a degraded answer.
 */
interface GeocodeResult {
  ok: boolean;
  hit?: NominatimHit;
}

async function geocode(q: string, signal: AbortSignal): Promise<GeocodeResult> {
  const query = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "1",
    viewbox: NYC_VIEWBOX,
    // Bias towards the box without hard-failing when a venue sits just outside
    // it — a Jersey warehouse should still resolve.
    bounded: "0",
  });

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${query.toString()}`,
      {
        headers: {
          Accept: "application/json",
          // Nominatim's usage policy requires a real identifier. Sending a
          // browser-shaped UA here would be both a lie and a policy breach.
          "User-Agent": "ra-nyc/1.0 (+https://ra-nyc.vercel.app)",
        },
        signal,
      },
    );
    if (!res.ok) return { ok: false };
    return { ok: true, hit: ((await res.json()) as NominatimHit[])[0] };
  } catch {
    return { ok: false };
  }
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
    // RA's numeric venue id, when the caller has one. Digits only, and capped:
    // it is interpolated into a GraphQL variable rather than a string, but the
    // cheapest place to reject junk is before it leaves this process.
    const rawId = url.searchParams.get("id")?.trim() ?? "";
    const venueId = /^\d{1,12}$/.test(rawId) ? rawId : null;

    if (!name) {
      return send(res, 400, { error: "Query param `name` is required" });
    }
    if (name.length > MAX_NAME_LENGTH) {
      return send(res, 400, { error: "Query param `name` is too long" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      // Both at once. The RA lookup is the fallback for venues the geocoder
      // cannot place, but running it only *after* a miss would put a second
      // round trip on exactly the venues that already took the longest — and
      // its result is discarded cheaply when the geocoder does answer.
      const [byName, fromRA] = await Promise.all([
        geocode(`${name}, ${CITY_SUFFIX}`, controller.signal),
        venueId ? raAddress(venueId, controller.signal) : Promise.resolve(null),
      ]);

      /**
       * Second pass: geocode RA's address when the venue's *name* got nowhere.
       *
       * This is the whole point of having asked RA at all. A geocoder knows
       * street addresses, not party venues, so "Bossa Nova Civic Club" resolves
       * and "Paragon Warehouse" does not — but the promoter typed a street
       * address into RA for the second one, and a street address is precisely
       * what Nominatim is good at. Handing it back turns an unplaceable venue
       * into a pin, a distance, and a ride with a real drop-off rather than a
       * name the driver has to guess at.
       *
       * Skipped entirely when the name already resolved, so the common case
       * still costs one geocoder request.
       */
      const byAddress =
        !byName.hit && fromRA
          ? await geocode(`${fromRA}, ${CITY_SUFFIX}`, controller.signal)
          : null;

      const hit = byName.hit ?? byAddress?.hit;
      const lat = hit?.lat ? Number(hit.lat) : null;
      const lon = hit?.lon ? Number(hit.lon) : null;
      const usable = lat !== null && lon !== null && !Number.isNaN(lat) && !Number.isNaN(lon);

      /**
       * Which address to show.
       *
       * When the *name* geocoded, the geocoder's label wins: it is the address
       * of the point the pin is actually on, and showing RA's instead would
       * caption a pin with a different address than the pin.
       *
       * When the name did not, RA's is what got us here — including the case
       * where it then geocoded successfully, because in that case RA's address
       * is the query the coordinates came from and the geocoder's own label for
       * it is a reformatted version of the same place, often more verbose and
       * occasionally snapped to a neighbouring building.
       */
      // Any leg that did not answer makes this a provisional result. RA's
      // lookup is excluded on purpose: it is an enhancement, and a venue the
      // geocoder placed by name is fully answered without it.
      const degraded = !byName.ok || (byAddress !== null && !byAddress.ok);

      const label = hit?.display_name ?? null;
      const preferRA = !byName.hit && Boolean(fromRA);
      const address = preferRA ? fromRA : (label ?? fromRA);
      const addressSource: VenueResponse["addressSource"] = !address
        ? null
        : preferRA
          ? "ra"
          : "geocoder";

      return send(
        res,
        200,
        {
          name,
          lat: usable ? lat : null,
          lon: usable ? lon : null,
          label,
          address,
          addressSource,
          mapsUrl: mapsLink(name, usable ? lat : null, usable ? lon : null),
        } satisfies VenueResponse,
        // A month when the answer is real: venues do not move, and a long cache
        // is the politest thing we can do for a free geocoder.
        //
        // Five minutes when any lookup failed rather than merely came up empty.
        // The two are indistinguishable in the body — both give a venue with no
        // coordinates — and caching the second for a month would turn a
        // five-second Nominatim blip into a venue that is unmappable until
        // September.
        degraded
          ? "public, max-age=60, s-maxage=300"
          : "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=2592000",
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    // No AbortError branch any more, and its absence is the design rather than
    // an oversight. Both upstream calls now swallow their own failures and
    // report them through `ok`, so a timeout produces a usable sheet — the
    // venue's name, working ride links, a maps search — on a five-minute cache,
    // instead of a 504 and an error message. Nothing here should reach this
    // catch; if something does it is a bug in this file, not upstream.
    console.error("[api/venue] unexpected failure", error);
    return send(res, 500, { error: "Failed to locate venue" });
  }
}
