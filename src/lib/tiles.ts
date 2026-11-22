/**
 * Slippy-map tile arithmetic, so a map can be a grid of `<img>` tags.
 *
 * The venue map used to be an OpenStreetMap embed iframe. One tag, no key, no
 * SDK — the right weight for something most sessions never open — but it came
 * with OSM's standard raster style, which is a pale grey-and-beige road atlas.
 * In a dark app it had to be inverted to be bearable, and inverted it looked
 * like a photographic negative of a map rather than a map.
 *
 * Composing tiles by hand keeps every property that made the iframe the right
 * call and drops the one that didn't: still no mapping library, still nothing in
 * the bundle beyond this file, but now any tile server will do. The trade is
 * that the map no longer pans or zooms — which the embed barely did either, and
 * "Open in Maps" is one tap away for anyone who wants to actually navigate.
 *
 * The maths is the standard Web Mercator scheme every tile server shares:
 * at zoom `z` the world is a 2^z × 2^z grid of 256px tiles, x running west to
 * east and y north to south.
 */

export const TILE_SIZE = 256;

export interface TilePlacement {
  /** Stable across re-renders, so React reuses the `<img>` and its cache. */
  key: string;
  url: string;
  /** Offset in CSS pixels from the container's top-left corner. */
  left: number;
  top: number;
}

/**
 * Fractional tile coordinates — the whole part identifies the tile, the
 * fraction locates the point inside it.
 */
export function tileCoords(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number } {
  const scale = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      scale,
  };
}

/**
 * OpenStreetMap's own tile server.
 *
 * This used to be CARTO's Voyager basemap, chosen for looking like a phone's
 * map app and for needing no key. In 2026 CARTO began answering every keyless
 * request with a blank tile stamped "API KEY REQUIRED" — as a 200, so nothing
 * failed and nothing logged; the venue sheet simply drew that stamp where the
 * street should be. The owner saw it weeks before anyone here understood what
 * "need the open maps api" meant. A key in the client is against house rules
 * (anything behind `VITE_` is public), so the answer is the keyless source the
 * data comes from anyway.
 *
 * Their tile usage policy is the limit to respect: light, attributed, cached
 * use by a real browser is fine; bulk fetching and heavy traffic are not. This
 * app opens a map when someone taps a venue or the Map chip, which is light.
 * If that stops being true, the fix is a keyed provider behind a function of
 * our own, and only this function changes.
 *
 * There is no `@2x` variant, so `retina` is accepted and ignored: the mosaic
 * is a little soft on a dense screen, which beats a watermark.
 */
export function tileUrl(zoom: number, x: number, y: number, _retina = false): string {
  return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

/**
 * Every tile needed to fill `width × height` with `lat`/`lon` dead centre.
 *
 * Positions are returned rather than computed in the component so the whole
 * thing stays a pure function of five numbers — which is the only reason it can
 * be tested without a browser.
 */
export function tileMosaic(
  lat: number,
  lon: number,
  zoom: number,
  width: number,
  height: number,
  retina = false,
): TilePlacement[] {
  if (width <= 0 || height <= 0) return [];

  const scale = 2 ** zoom;
  const centre = tileCoords(lat, lon, zoom);

  // World-pixel coordinates of the container's top-left corner.
  const originX = centre.x * TILE_SIZE - width / 2;
  const originY = centre.y * TILE_SIZE - height / 2;

  const tiles: TilePlacement[] = [];
  for (
    let ty = Math.floor(originY / TILE_SIZE);
    ty * TILE_SIZE < originY + height;
    ty += 1
  ) {
    // Latitude does not wrap: above the north edge or below the south there is
    // simply no tile, and asking for one returns a 404 rather than sky.
    if (ty < 0 || ty >= scale) continue;

    for (
      let tx = Math.floor(originX / TILE_SIZE);
      tx * TILE_SIZE < originX + width;
      tx += 1
    ) {
      // Longitude does. A container wider than the world at low zoom, or a
      // venue near the antimeridian, both land outside [0, scale).
      const wrapped = ((tx % scale) + scale) % scale;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        url: tileUrl(zoom, wrapped, ty, retina),
        left: tx * TILE_SIZE - originX,
        top: ty * TILE_SIZE - originY,
      });
    }
  }

  return tiles;
}
