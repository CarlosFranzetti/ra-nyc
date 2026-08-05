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
 * Lyft's documented universal link.
 *
 * `id=lyft` picks the standard ride type. Pickup is omitted rather than set,
 * which is Lyft's way of saying "wherever the rider is" — the same reasoning as
 * Uber's `pickup=my_location`, and the same reason this app never asks for a
 * geolocation permission it would only hand straight back.
 *
 * No `partner`: that parameter is a Lyft developer Client ID used for
 * attribution, and the link deep-links correctly without one.
 *
 * This replaced Empower, which publishes no deep-link scheme at all and so
 * could never carry the destination.
 */
export function lyftLink(destination: RideDestination): string {
  const params = new URLSearchParams({
    id: "lyft",
    "destination[latitude]": String(destination.lat),
    "destination[longitude]": String(destination.lon),
  });
  return `https://lyft.com/ride?${params.toString()}`;
}
