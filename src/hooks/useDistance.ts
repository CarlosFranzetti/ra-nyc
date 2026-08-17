import { useEffect, useState } from "react";

/**
 * How far the venue is from wherever you are.
 *
 * ## Why this asks for a location permission when nothing else here does
 *
 * The ride links deliberately do not: `pickup=my_location` hands the question
 * to Uber and Lyft, who are going to ask anyway and are better placed to
 * answer. Asking ourselves purely to fill in a parameter they can fill in
 * themselves would be a permission prompt for nothing, and that reasoning still
 * stands — see `lib/rideLinks.ts`.
 *
 * "How far is it" is different, because nothing else can answer it. A distance
 * is the one thing that turns an address into a decision: *Ridgewood* means
 * nothing until you know it is four miles away and *Bushwick* means nothing
 * until you know it is one. So this asks, once, and only from the venue sheet —
 * the screen where the question is already on your mind.
 *
 * ## What it does when the answer is no
 *
 * Nothing. Denied, unavailable, insecure origin, a browser without the API, a
 * timeout: every one of them resolves to `null`, and the sheet renders without
 * the parenthesis. There is no prompt to reconsider and no explanation of what
 * you are missing, because a permission you declined is a decision, not an
 * error state.
 *
 * The result is cached for the session in a module-level promise. A phone does
 * not move far between opening two venue sheets, and re-asking on every open
 * would burn battery to re-answer a question whose answer has not changed.
 */

interface Coords {
  lat: number;
  lon: number;
}

/**
 * One in-flight request at most, shared by every caller.
 *
 * Module-level rather than in a context because there is nothing to configure
 * and nothing to reset — it is a fact about the device, not app state.
 */
let pending: Promise<Coords | null> | null = null;

function locate(): Promise<Coords | null> {
  if (pending) return pending;

  pending = new Promise<Coords | null>((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        }),
      // Includes the user saying no, which is not a failure worth reporting.
      () => resolve(null),
      {
        // A city-block answer is all a "3.2 mi" readout can show, and the
        // low-accuracy fix comes from wifi rather than the GPS radio.
        enableHighAccuracy: false,
        timeout: 8_000,
        // Anything from the last five minutes is close enough for this.
        maximumAge: 300_000,
      },
    );
  });

  return pending;
}

const EARTH_RADIUS_MILES = 3958.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance, in miles.
 *
 * Straight-line rather than driving distance, which is a deliberate limit and
 * not an approximation of one: routing needs an API key and a request per
 * venue, and the number is being read as "is this near me or across town",
 * where the two answers differ by a rounding error at NYC scale.
 */
export function haversineMiles(a: Coords, b: Coords): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/**
 * Under a tenth of a mile reads as "you are basically there" rather than as a
 * number, and two decimal places on a straight-line estimate would be claiming
 * a precision this does not have.
 */
export function formatMiles(miles: number): string {
  if (miles < 0.1) return "right here";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/**
 * Distance to a destination, or null while unknown, refused or unanswerable.
 *
 * Only asks when `enabled` and a destination exist, so opening the app never
 * prompts and neither does a venue the geocoder could not place.
 */
export function useDistance(
  destination: { lat: number; lon: number } | null,
  enabled: boolean,
): string | null {
  const [miles, setMiles] = useState<number | null>(null);

  const lat = destination?.lat ?? null;
  const lon = destination?.lon ?? null;

  useEffect(() => {
    if (!enabled || lat == null || lon == null) {
      setMiles(null);
      return undefined;
    }
    let cancelled = false;
    void locate().then((here) => {
      if (cancelled || !here) return;
      setMiles(haversineMiles(here, { lat, lon }));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, lat, lon]);

  return miles === null ? null : formatMiles(miles);
}
