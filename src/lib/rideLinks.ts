/**
 * Hand-off links to the ride apps, built from a venue's coordinates.
 *
 * Both are plain https links rather than custom `uber://` schemes on purpose: a
 * universal link opens the installed app when there is one and the mobile site
 * when there isn't, where a custom scheme on a phone without the app does
 * nothing at all and leaves the tap looking broken.
 */

export interface RideDestination {
  name: string;
  lat: number;
  lon: number;
  /** Full postal address, when the geocoder produced one. */
  address?: string | null;
}

/**
 * Uber's documented universal link.
 *
 * `pickup=my_location` lets Uber resolve where the rider is rather than this app
 * asking for geolocation — the destination is the only half we actually know,
 * and asking for a location permission to fill in the other half would be a
 * permission prompt for nothing.
 *
 * No `client_id`: that parameter exists for affiliate attribution, and without
 * one the link still deep-links correctly.
 */
export function uberLink(destination: RideDestination): string {
  const params = new URLSearchParams({
    action: "setPickup",
    pickup: "my_location",
    "dropoff[latitude]": String(destination.lat),
    "dropoff[longitude]": String(destination.lon),
    "dropoff[nickname]": destination.name,
  });
  if (destination.address) {
    params.set("dropoff[formatted_address]", destination.address);
  }
  return `https://m.uber.com/ul/?${params.toString()}`;
}

/**
 * Empower.
 *
 * Empower publishes no deep-link scheme — no developer documentation, no
 * documented URL parameters — so unlike Uber this cannot carry the destination
 * and deliberately does not pretend to. Inventing query parameters that their
 * app does not read would produce a link that looks precise and silently
 * arrives at nothing. It opens the app or their site, and the rider enters the
 * venue themselves.
 *
 * If they ever publish a scheme, this function is the only thing that changes.
 */
export function empowerLink(_destination: RideDestination): string {
  return "https://www.driveempower.com/";
}
